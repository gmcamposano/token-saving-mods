import type { EngineInterface, Register } from 'claude-code'
import { addShots, closePane, loadTotals, openPane, registerPane, resetPane, restoreShots, setBusy, setOff, setSwitchHidden, setThumb, setTotals } from './pane.tsx'
import type { ShotCard } from '../types'
import { parseShrink, SHRINK, type Shrunk, shrinkPlan, sniff, THUMB } from './scripts.ts'

// Efficient Browser Use: during a browser task Claude takes a screenshot after almost every click, and
// each one costs about width x height / 750 tokens. This mod shrinks each screenshot before Claude
// reads it, with `sips` on macOS or Pillow elsewhere (see scripts.ts).
// It owns every tool result with an image block (TOKEN-MODS-SPEC section 6): browser pane and Chrome
// screenshots, Read on a picture, any connector that returns one. It was called Image Offload.

const NAME = 'efficient-browser-use'
const LABEL = 'Efficient Browser Use'

type Settings = { scale: number; min: number }

// Half of each side is a quarter of the tokens. Never below 512 px on the long side.
const DEFAULTS: Settings = { scale: 0.5, min: 512 }
// The API scales a picture down to 1568 px on its long side before the model sees it,
// so a bigger one never costs more than that.
const API_LONG = 1568

// Module variables reset on a reload; the settings live in $.store.
let home = ''
let session = ''
let off = false
let settings: Settings = { ...DEFAULTS }
// /efficient-browser full: how many tool results may still pass at full size.
let fullPasses = 0
let seq = 0
let toolWarned = false
// Who has read the zoom hint already: 'main' or a subagent's id. Each context reads it once, not under every picture.
const hinted = new Set<string>()
const totals = { seen: 0, images: 0, before: 0, after: 0, pasted: 0 }
// "efficient-browser-use:hidden" in switches.json: the pane never opens by itself.
let hidden = false
let switchError = ''

const logPath = () => `${home}/.claude/mods-logs/${NAME}.log`
const ledgerPath = () => `${home}/.claude/mods-logs/savings.jsonl`
const tmpDir = () => `${home}/.claude/mods-logs/${NAME}/tmp`

// The /mods switchboard: "efficient-browser-use": false turns the mod off in every chat, and
// "efficient-browser-use:hidden": true keeps the pane shut until it is asked for. Read only.
async function readSwitch($: EngineInterface) {
  let now = off
  let nowHidden = hidden
  try {
    const path = `${home}/.claude/mods/switches.json`
    const json = (await $.fs.exists(path)) ? (JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>) : {}
    now = json[NAME] === false
    nowHidden = json[`${NAME}:hidden`] === true
    switchError = ''
  } catch (err) {
    // A broken file changes nothing. Logged once, not every 3 seconds.
    const said = err instanceof Error ? err.message : String(err)
    if (said !== switchError) void log($, `switches.json not read, nothing changed: ${said}`)
    switchError = said
  }
  if (nowHidden !== hidden) {
    hidden = nowHidden
    setSwitchHidden(hidden)
    if (hidden) await closePane($)
  }
  if (now === off) return
  off = now
  if (off) fullPasses = 0
  await setOff($, off).catch(() => undefined)
  if (off) await closePane($)
  try {
    $.ui.status(off ? undefined : statusLine())
  } catch {
    // The next shrink sets it again.
  }
}

// Open in /mods writes an empty file named for this mod and this chat: open the pane, remove the file.
async function checkOpen($: EngineInterface) {
  if (!session || !home) return
  const path = `${home}/.claude/mods/.open-${NAME}-${session}`
  if (!(await $.fs.exists(path).catch(() => false))) return
  await $.process.run(['/bin/rm', '-f', path])
  if (!off) await showPane($)
}

/** The person asked for the pane: open it with every card from this chat, the ledger's too. */
async function showPane($: EngineInterface): Promise<number> {
  await openPane($, true)
  const added = await restoreShots($, await ledgerCards($)).catch(err => {
    void log($, `pane restore: ${String(err)}`)
    return 0
  })
  if (added > 0) void log($, `pane: ${added} card(s) the pane had lost were added back from the ledger`)
  return added
}

// $.fs has no append, and a read-then-write can drop another mod's line, so the shell appends.
async function append($: EngineInterface, path: string, line: string) {
  await $.process.run(['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'sh', path], {
    stdin: line.endsWith('\n') ? line : `${line}\n`,
  })
}

async function log($: EngineInterface, line: string) {
  try {
    await append($, logPath(), `${new Date(await $.clock.now()).toISOString()} ${line}`)
  } catch {
    // Nowhere left to report it.
  }
}

// TOKEN-MODS-SPEC section 4: image estimate is width x height / 750.
export function imageTokens(w: number, h: number): number {
  const long = Math.max(w, h)
  const f = long > API_LONG ? API_LONG / long : 1
  return Math.ceil((Math.round(w * f) * Math.round(h * f)) / 750)
}

const fmt = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function statusLine() {
  if (totals.images === 0) return undefined
  return `${LABEL}: ${totals.images} picture${totals.images === 1 ? '' : 's'}, ~${fmt(totals.before - totals.after)} tokens saved`
}

// ---- finding pictures in a result ----

type Obj = Record<string, unknown>
type Hit = { block: Obj; label?: Obj }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function isImage(v: unknown): v is Obj {
  if (!isObj(v) || v.type !== 'image') return false
  // MCP block { data, mimeType }, API block { source: { data } }, Read's { file: { base64 } }.
  return typeof v.data === 'string' || (isObj(v.source) && typeof v.source.data === 'string') || (isObj(v.file) && typeof v.file.base64 === 'string')
}

const isText = (v: unknown): v is Obj => isObj(v) && v.type === 'text' && typeof v.text === 'string'

export function findImages(node: unknown, hits: Hit[] = []): Hit[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      if (isImage(item)) {
        const prev = node[i - 1]
        hits.push({ block: item, label: isText(prev) ? prev : undefined })
      } else findImages(item, hits)
    })
  } else if (isObj(node)) {
    if (isImage(node)) hits.push({ block: node })
    else for (const v of Object.values(node)) findImages(v, hits)
  }
  return hits
}

export function bytesOf(b: Obj): { base64: string; mime: string } {
  if (typeof b.data === 'string') return { base64: b.data, mime: String(b.mimeType ?? '') }
  if (isObj(b.source)) return { base64: String(b.source.data), mime: String(b.source.media_type ?? '') }
  const file = b.file as Obj
  return { base64: String(file.base64), mime: String(file.type ?? '') }
}

export function setBytes(b: Obj, base64: string, mime: string, w: number, h: number, nw: number, nh: number) {
  if (typeof b.data === 'string') {
    b.data = base64
    b.mimeType = mime
  } else if (isObj(b.source)) {
    b.source = { ...b.source, data: base64, media_type: mime }
  } else {
    const file = b.file as Obj
    const dims = isObj(file.dimensions) ? file.dimensions : {}
    // The original size stays the real one, so a click mapped from the picture lands right.
    b.file = {
      ...file,
      base64,
      type: mime,
      dimensions: { ...dims, originalWidth: dims.originalWidth ?? w, originalHeight: dims.originalHeight ?? h, displayWidth: nw, displayHeight: nh },
    }
  }
}

// The browser pane's own line, after the picture: `Screenshot size: 800x600` when unscaled,
// `Screenshot size: 240x180 0.3-scale view; coordinate frame: 800x600.` when scaled.
// Its coordinate frame must never change: clicks use it.
const SIZE = /Screenshot size: (\d+)x(\d+)(?: [\d.]+-scale view)?(?:; coordinate frame: (\d+)x(\d+))?/g

export function findTexts(node: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(node)) for (const v of node) findTexts(v, out)
  else if (isText(node)) out.push(node)
  else if (isObj(node)) for (const v of Object.values(node)) findTexts(v, out)
  return out
}

// Rewrites the first line that names this picture's size into the tool's own scaled form.
export function relabel(texts: Obj[], w: number, h: number, nw: number, nh: number): boolean {
  for (const t of texts) {
    const text = String(t.text)
    for (const m of text.matchAll(SIZE)) {
      if (Number(m[1]) !== w || Number(m[2]) !== h || m.index === undefined) continue
      const fw = m[3] ? Number(m[3]) : w
      const fh = m[4] ? Number(m[4]) : h
      const scale = Number((nw / fw).toFixed(2))
      t.text = `${text.slice(0, m.index)}Screenshot size: ${nw}x${nh} ${scale}-scale view; coordinate frame: ${fw}x${fh}${text.slice(m.index + m[0].length)}`
      return true
    }
  }
  return false
}

// A short picture of the result's shape for the log, never the bytes.
function shape(node: unknown, depth = 0): string {
  if (depth > 3) return '…'
  if (Array.isArray(node)) return `[${node.slice(0, 8).map(v => (isObj(v) && typeof v.type === 'string' ? v.type : shape(v, depth + 1))).join(',')}${node.length > 8 ? ',…' : ''}]`
  if (isObj(node)) return `{${Object.keys(node).slice(0, 10).map(k => `${k}:${typeof node[k] === 'string' ? 's' : shape(node[k], depth + 1)}`).join(',')}}`
  return typeof node === 'string' ? 's' : String(typeof node)
}

// ---- shrinking ----

type Shrink = Shrunk & { mime: string }

async function shrink($: EngineInterface, base64: string, mime: string): Promise<Shrink> {
  seq += 1
  const kind = sniff(base64, mime)
  const plan = shrinkPlan(kind)
  const stem = `${tmpDir()}/${Date.now()}-${seq}`
  const r = await $.process.run(
    ['/bin/sh', '-c', SHRINK, 'sh', `${stem}-in.${kind.split('/')[1] ?? 'png'}`, `${stem}-out.${plan.ext}`, String(settings.scale), String(settings.min), plan.fmt],
    { stdin: base64, timeoutMs: 20_000 },
  )
  if (r.exitCode !== 0) throw new Error(`image tool exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`)
  return { ...parseShrink(r.stdout), mime: plan.mime }
}

// ---- the pane's small picture ----

async function thumbnail($: EngineInterface, cardId: string, base64: string) {
  const stem = `${tmpDir()}/thumb-${Date.now()}-${cardId}`
  const r = await $.process.run(['/bin/sh', '-c', THUMB, 'sh', `${stem}-in`, `${stem}.jpg`], { stdin: base64, timeoutMs: 10_000 })
  const out = r.stdout.replace(/\s+/g, '')
  if (r.exitCode !== 0) throw new Error(`exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`)
  // Over this size it is no thumbnail: the pane goes without.
  if (out && out.length < 60_000) await setThumb($, cardId, out)
}

// ---- the ledger ----

type Line = { tool_use_id: string | null; action: string; before: number; after: number; helper: Obj | null; detail?: string }

async function ledger($: EngineInterface, line: Line) {
  const ts = new Date(await $.clock.now()).toISOString().replace(/\.\d+Z$/, 'Z')
  const row = { ts, session, tool_use_id: line.tool_use_id, mod: NAME, action: line.action, before: line.before, after: line.after, helper: line.helper, measured: 'estimated', ...(line.detail ? { detail: line.detail } : {}) }
  await append($, ledgerPath(), JSON.stringify(row))
}

// ---- pictures Claude sized itself ----

function sizedBy(a: Obj): string | null {
  if (a.action === 'zoom') return 'a zoom, Claude picked its size'
  if (typeof a.scale === 'number') return `Claude set scale ${a.scale}`
  return null
}

/**
 * For each picture, why it stays as it is, or null to shrink it. A zoom, or a screenshot Claude
 * gave its own scale, stays as Claude asked. In a batch the scale sits on each action, so the
 * pictures are matched to the screenshot and zoom actions in order. When the counts differ, each
 * picture's own label line says it: "[computer:zoom]", or "0.6-scale view" for a scale.
 */
export const HINT = 'For small text, use zoom or read the page as text. The user can type /efficient-browser full to let one full-size picture through.'

// Adds the hint under the first shrunk picture a context sees; later ones carry only their own size line.
export function hint(notes: string[], seen: Set<string>, who: string) {
  if (notes.length === 0 || seen.has(who)) return
  seen.add(who)
  notes.push(HINT)
}

export function ownSizes(input: Obj, labels: string[], text: string, min: number, warn: (said: string) => void): Array<string | null> {
  const n = labels.length
  let why: Array<string | null>
  if (!Array.isArray(input.actions)) why = labels.map(() => sizedBy(input))
  else {
    const shots = input.actions
      .map(a => (isObj(a) && isObj(a.input) ? a.input : {}))
      .filter(a => a.action === 'screenshot' || a.action === 'zoom')
    if (shots.length === n) why = shots.map(sizedBy)
    else {
      warn(`batch with ${n} picture(s) and ${shots.length} screenshot or zoom action(s): matched by label instead`)
      why = labels.map(l => (/:zoom\]/.test(l) ? 'a zoom, Claude picked its size' : /[\d.]+-scale view/.test(l) ? 'Claude set its own scale' : null))
    }
  }
  // A picture Claude sized that is no bigger than the floor: say so, it is the main reason.
  return why.map((w, i) => {
    if (!w) return w
    const m = /Screenshot size: (\d+)x(\d+)/.exec(labels[i] || text)
    return m && Math.max(Number(m[1]), Number(m[2])) <= min ? `already small (${w})` : w
  })
}

// ---- the ledger, read back ----

const SHRANK = /^shrank (\S+) picture (\d+)x(\d+) to (\d+)x(\d+)$/

/** This chat's shrunk pictures, as the ledger has them. */
async function ledgerCards($: EngineInterface): Promise<Array<Omit<ShotCard, 'id'>>> {
  if (!session) return []
  const r = await $.process.run(['/usr/bin/grep', '-F', `"session":"${session}"`, ledgerPath()])
  const out: Array<Omit<ShotCard, 'id'>> = []
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue
    let row: Obj
    try {
      row = JSON.parse(line) as Obj
    } catch {
      continue
    }
    if (row.mod !== NAME) continue
    const at = Date.parse(String(row.ts)) || 0
    const base = {
      at,
      before: Number(row.before) || 0,
      after: Number(row.after) || 0,
      note: 'Rebuilt from the ledger (savings.jsonl). The note Claude got was not kept.',
      ...(typeof row.tool_use_id === 'string' ? { toolUseId: row.tool_use_id } : {}),
    }
    const a = String(row.action)
    const s = SHRANK.exec(a)
    if (s) out.push({ ...base, tool: s[1]!, action: 'shrank', w: Number(s[2]), h: Number(s[3]), nw: Number(s[4]), nh: Number(s[5]) })
  }
  return out
}

// ---- the hooks ----

export const register: Register = on => {
  resetPane()
  registerPane(on)

  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    // A reload starts the module over; the chat's totals live on in $.state.
    Object.assign(totals, await loadTotals($).catch(() => totals))
    await $.command.register({
      name: 'efficient-browser',
      description: 'Efficient Browser Use. pane: open the pane. full: let the next picture through at full size. scale 0.5, min 512',
      argumentHint: '[pane|full|scale <0.2-0.9>|min <px>]',
      immediate: true,
    })
    const stored = await $.store.get('settings').catch(() => undefined)
    if (isObj(stored)) {
      settings = {
        scale: typeof stored.scale === 'number' ? stored.scale : DEFAULTS.scale,
        min: typeof stored.min === 'number' ? stored.min : DEFAULTS.min,
      }
    }
    session = await $.session.id().catch(() => '')
    await readSwitch($).catch(() => undefined)
    $.clock.every(3000, () => {
      void readSwitch($)
        .then(() => checkOpen($))
        .catch(err => log($, `switch poll: ${String(err)}`))
    })
    return next(e)
  })

  // Pasted pictures: a mod sees that they exist, never their bytes, and cannot drop or swap them.
  on('prompt.submit', async ($, e, next) => {
    if (!off) {
      const pics = (e.attachments ?? []).filter(a => a.type === 'image').length
      if (pics > 0) {
        totals.pasted += pics
        void setTotals($, totals).catch(() => undefined)
        void log($, `prompt carries ${pics} pasted picture(s): left as they are (mods cannot read or change pasted pictures)`)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (off) return next(e)
    const input = e as unknown as Obj
    const r = await next(e)
    if (off || r.deny !== undefined || r.isError) return r
    const hits = findImages(r.result)
    // A screenshot call that comes back with no picture found: the shape says why.
    const watched = /screenshot|browser_batch/i.test(e.tool) || input.action === 'screenshot'
    if (watched || hits.length > 0) void log($, `${e.tool} result shape ${shape(r.result)}, ${hits.length} picture(s)`)
    if (hits.length === 0) return r

    const id = typeof e.tool_use_id === 'string' ? e.tool_use_id : null
    // Every card of this call is written once, at the end: see addShots.
    const cards: Array<Omit<ShotCard, 'id' | 'at'>> = []
    const alone = new Map<string, number>()
    const leave = (i: number, reason: string) => {
      alone.set(reason, (alone.get(reason) ?? 0) + 1)
      void log($, `${e.tool}: picture ${i + 1} of ${hits.length} left alone: ${reason}`)
    }
    totals.seen += hits.length

    // Which pictures Claude sized itself: a zoom, or a screenshot with its own scale.
    const own = ownSizes(
      input,
      hits.map(h => (h.label ? String(h.label.text) : '')),
      hits.length === 1 ? findTexts(r.result).map(t => String(t.text)).join('\n') : '',
      settings.min,
      said => void log($, `${e.tool}: ${said}`),
    )
    let full = false
    if (fullPasses > 0 && own.some(o => o === null)) {
      fullPasses -= 1
      full = true
      $.ui.toast(`${LABEL}: full-size picture let through`)
    }

    // A fresh object without `ref`: returning core's own would make it send its own messages.
    const result = JSON.parse(JSON.stringify(r.result)) as unknown
    const mine = findImages(result)
    const texts = findTexts(result)
    const notes: string[] = []
    let changed = false
    let newest: { card: number; base64: string } | null = null

    const work = mine.map((hit, i) => ({ hit, i, why: own[i] ?? (full ? 'let through at full size (/efficient-browser full)' : null) }))
    const todo = work.filter(w => !w.why)
    for (const w of work) if (w.why) leave(w.i, w.why)

    // The mod acts now: show the pane, and the camera moves until 2 s after the last picture.
    if (todo.length > 0) {
      void openPane($)
      await setBusy($, true).catch(() => undefined)
    }
    try {
      for (const { hit, i } of todo) {
        const { base64, mime } = bytesOf(hit.block)
        let s: Shrink
        try {
          s = await shrink($, base64, mime)
        } catch (err) {
          const said = err instanceof Error ? err.message : String(err)
          leave(i, 'could not be shrunk')
          void log($, `${e.tool}: could not shrink, left as is: ${said}`)
          // No image tool on this machine: say it once per load, not on every screenshot.
          if (said.includes('no image tool') && !toolWarned) {
            toolWarned = true
            $.ui.toast(`${LABEL} is not shrinking: ${said.replace(/^image tool exit \d+: /, '').trim()}`)
          }
          continue
        }
        const before = imageTokens(s.w, s.h)

        if (s.nw === undefined || s.nh === undefined || !s.base64) {
          leave(i, `already small (${s.w}x${s.h}, at most ${settings.min} px on the long side)`)
          continue
        }
        setBytes(hit.block, s.base64, s.mime, s.w, s.h, s.nw, s.nh)
        const after = imageTokens(s.nw, s.nh)
        const framed = relabel(texts, s.w, s.h, s.nw, s.nh)
        const f = Number((s.w / s.nw).toFixed(3))
        const said = notes.push(
          framed
            ? `${LABEL} shrank this screenshot from ${s.w}x${s.h} to ${s.nw}x${s.nh}. Its coordinate frame is unchanged, as the screenshot line says.`
            : `${LABEL} shrank this picture from ${s.w}x${s.h} to ${s.nw}x${s.nh}. A point (x, y) on it is (x*${f}, y*${f}) on the original.`,
        )
        changed = true
        totals.images += 1
        totals.before += before
        totals.after += after
        newest = { card: cards.length, base64: s.base64 }
        cards.push({ tool: e.tool, action: 'shrank', w: s.w, h: s.h, nw: s.nw, nh: s.nh, before, after, note: notes[said - 1], ...(id ? { toolUseId: id } : {}) })
        await ledger($, { tool_use_id: id, action: `shrank ${e.tool} picture ${s.w}x${s.h} to ${s.nw}x${s.nh}`, before, after, helper: null }).catch(err => log($, `ledger: ${String(err)}`))
        void log($, `${e.tool}: ${s.w}x${s.h} -> ${s.nw}x${s.nh} (${before} -> ${after} tokens)`)
        $.ui.toast(`${LABEL}: ${s.w}x${s.h} to ${s.nw}x${s.nh}, ~${fmt(before - after)} tokens saved`)
      }
    } finally {
      if (todo.length > 0) await setBusy($, false).catch(() => undefined)
    }

    for (const [reason, count] of alone) cards.push({ tool: e.tool, action: 'left alone', w: 0, h: 0, before: 0, after: 0, count, reason, ...(id ? { toolUseId: id } : {}) })
    await setTotals($, totals).catch(err => log($, `pane totals: ${String(err)}`))
    const ids = await addShots($, cards).catch(err => {
      void log($, `pane cards not saved (${cards.length}): ${String(err)}`)
      return [] as string[]
    })
    // The small picture comes after the result: Claude never waits on it.
    const thumbId = newest ? ids[newest.card] : undefined
    if (newest && thumbId) void thumbnail($, thumbId, newest.base64).catch(err => log($, `thumbnail: ${String(err)}`))

    if (!changed) return r
    $.ui.status(statusLine())
    hint(notes, hinted, (e as { agentId?: string }).agentId ?? 'main')
    return { result: result as never, ...(notes.length > 0 ? { context: [notes.join('\n')] } : {}) }
  // If anything above throws, the tool's own result stands: next(e) replays it, nothing runs twice.
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'efficient-browser' }, async ($, e) => {
    if (off) return { text: `${LABEL} is off. Turn it on with /mods.` }
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const added = await showPane($)
    if (word === 'pane') {
      return {
        text: `${LABEL}: pane open. This chat: ${totals.seen} picture${totals.seen === 1 ? '' : 's'} seen, ${totals.images} shrunk.${added > 0 ? ` ${added} card(s) came back from the ledger.` : ''}`,
      }
    }
    const save = () => $.store.set('settings', settings)
    if (word === 'full') {
      fullPasses = 1
      return { text: `${LABEL}: the next picture comes through at full size. Then shrinking starts again.` }
    }
    if (word === 'scale' || word === 'min') {
      const n = Number(value)
      const ok = word === 'scale' ? n >= 0.2 && n <= 0.9 : Number.isInteger(n) && n >= 256 && n <= 1568
      if (!ok) return { text: word === 'scale' ? 'Give a scale from 0.2 to 0.9, for example /efficient-browser scale 0.5' : 'Give a size from 256 to 1568 px, for example /efficient-browser min 512' }
      settings = { ...settings, [word]: n }
      await save()
      return { text: `${LABEL}: ${word} is now ${n}.` }
    }
    return {
      text: [
        `${LABEL} is on, scale ${settings.scale}, never under ${settings.min} px.`,
        `This chat: ${totals.seen} picture${totals.seen === 1 ? '' : 's'} seen, ${totals.images} shrunk, ~${fmt(totals.before)} tokens before, ~${fmt(totals.after)} after.`,
        ...(totals.pasted > 0 ? [`${totals.pasted} pasted picture(s) went through as they were: mods cannot shrink pasted pictures.`] : []),
        'Type /efficient-browser pane, full, scale 0.5 or min 512.',
      ].join('\n'),
    }
  })
}
