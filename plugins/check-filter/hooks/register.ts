import type { EngineInterface, Register } from 'claude-code'

// check-filter: long output from test runners and linters reaches Claude as the exact failures plus the
// summary line, and the full output is saved to a file. Deterministic: plain patterns, no model call.
// Anything it does not recognise passes through whole. The command always runs once, untouched.

const NAME = 'check-filter'
const MIN_LINES = 60 // under this, the output passes whole
const MAX_RATIO = 0.7 // a filtered text over 70% of the original is not worth it: pass whole
const BLOCK_MAX_LINES = 40
const READ_MAX_BYTES = 20_000_000

type Section = { name: string; summary: string[]; items: string[]; total: number }
type Filter = { id: string; command: RegExp; parse: (lines: string[]) => Section | null }

// ---------- parsers ----------

const MT_START = /^\s*(\d+\) )?(Failure|Error):\s*$/
const MT_RERUN = /^(bin\/)?rails test \S+:\d+\s*$/
const MT_SUMMARY = /^\d+ (runs|tests), \d+ assertions/

function minitest(lines: string[]): Section | null {
  const summary = lines.filter(l => MT_SUMMARY.test(l))
  if (summary.length === 0) return null
  const seed = lines.find(l => /^Run options: .*--seed \d+/.test(l))
  const finished = lines.filter(l => /^Finished in [\d.]+s/.test(l))
  const items: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!MT_START.test(lines[i]!)) continue
    const block: string[] = [lines[i]!]
    let j = i + 1
    for (; j < lines.length; j++) {
      const l = lines[j]!
      if (MT_START.test(l) || MT_SUMMARY.test(l) || /^Finished in /.test(l)) break
      block.push(l)
      if (MT_RERUN.test(l)) {
        j++
        break
      }
    }
    while (block.length && block[block.length - 1]!.trim() === '') block.pop()
    const cut = block.length > BLOCK_MAX_LINES
    items.push([...block.slice(0, BLOCK_MAX_LINES), ...(cut ? [`  … (${block.length - BLOCK_MAX_LINES} líneas más de este bloque en el archivo)`] : [])].join('\n'))
    i = j - 1
  }
  return { name: 'minitest', summary: [...(seed ? [seed] : []), ...finished, ...summary], items, total: items.length }
}

function rubocop(lines: string[]): Section | null {
  const summary = lines.filter(l => /^\d+ files? inspected, /.test(l))
  if (summary.length === 0) return null
  const items = lines.filter(l => /^\S.*:\d+:\d+: [CWEFR]: /.test(l))
  return { name: 'rubocop', summary, items, total: items.length }
}

function i18nTasks(lines: string[]): Section | null {
  const summary = lines.filter(l => /^(Missing|Unused|Inconsistent|Normalized|Unnormalized)\b.*\(\d+\)/i.test(l) || /Good job|No translations are missing|No unused keys/i.test(l))
  if (summary.length === 0) return null
  const items = lines.filter(l => /^\|/.test(l) && !/^\|\s*(Locale|Key)\s*\|/i.test(l))
  return { name: 'i18n-tasks', summary, items, total: items.length }
}

// Blocks of "Field: value" lines separated by blank lines, kept to the fields that matter.
function fieldBlocks(lines: string[], start: RegExp, keep: RegExp): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!start.test(lines[i]!)) continue
    const block: string[] = []
    let j = i
    for (; j < lines.length && lines[j]!.trim() !== ''; j++) if (keep.test(lines[j]!)) block.push(lines[j]!)
    out.push(block.join('\n'))
    i = j
  }
  return out
}

function bundleAudit(lines: string[]): Section | null {
  const summary = lines.filter(l => /^(No vulnerabilities found|Vulnerabilities found!)/.test(l))
  if (summary.length === 0) return null
  const items = fieldBlocks(lines, /^Name: /, /^(Name|Version|CVE|GHSA|Criticality|Title|Solution):/)
  return { name: 'bundle-audit', summary, items, total: items.length }
}

function brakeman(lines: string[]): Section | null {
  const summary = lines.filter(l => /^(Security Warnings|Errors|Ignored Warnings): \d+/.test(l) || /^No warnings found/.test(l))
  if (summary.length === 0) return null
  const items = fieldBlocks(lines, /^Confidence: /, /^(Confidence|Category|Check|Message|File|Line):/)
  return { name: 'brakeman', summary, items, total: items.length }
}

const FILTERS: readonly Filter[] = [
  { id: 'minitest', command: /\brails\s+test\b|\brake\s+test\b/, parse: minitest },
  { id: 'rubocop', command: /\brubocop\b/, parse: rubocop },
  { id: 'i18n-tasks', command: /\bi18n-tasks\b/, parse: i18nTasks },
  { id: 'bundle-audit', command: /\bbundle(r)?[- ]audit\b|\bbundle\s+exec\s+bundle-audit\b/, parse: bundleAudit },
  { id: 'brakeman', command: /\bbrakeman\b/, parse: brakeman },
]

const ITEM_CAP: Record<string, number> = { minitest: 5, rubocop: 20, 'i18n-tasks': 20, 'bundle-audit': 10, brakeman: 10 }

// A run that died before its summary (boot error, pending migration, bad config): head, the app's own
// backtrace frames, tail. Gem frames are dropped; the full output stays in the file.
const APP_FRAME = /^\s*(\/\S*\/)?(app|test|config|db|lib)\/\S+:\d+/
function crash(lines: string[], exitCode: number, fullPath: string): string | null {
  const head = lines.slice(0, 15)
  const tail = lines.slice(-10)
  const middle = lines.slice(15, -10).filter(l => APP_FRAME.test(l) && !/\/gems\//.test(l)).slice(0, 20)
  const dropped = lines.length - head.length - tail.length - middle.length
  return [
    `[${NAME}] ${lines.length} líneas, sin línea de resumen (se cayó antes de terminar) → cabeza, frames de la app y cola. Exit code: ${exitCode}. Salida completa: ${fullPath}`,
    '',
    ...head,
    ...(middle.length ? ['…', ...middle] : []),
    `… (${dropped} líneas omitidas, sobre todo frames de gemas)`,
    ...tail,
    '',
    'Para el detalle: grep o Read con offset/limit sobre el archivo completo. /check-filter full deja pasar entera la próxima salida.',
  ].join('\n')
}

// ---------- pure core (exported for the test) ----------

export function matchFilters(command: string): Filter[] {
  return FILTERS.filter(f => f.command.test(command))
}

export function condense(command: string, output: string, exitCode: number | null, fullPath: string): string | null {
  const filters = matchFilters(command)
  if (filters.length === 0) return null
  const lines = output.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length < MIN_LINES) return null
  const sections = filters.map(f => f.parse(lines)).filter((s): s is Section => s !== null)
  if (sections.length === 0) return exitCode ? crash(lines, exitCode, fullPath) : null
  const parts: string[] = [
    `[${NAME}] ${lines.length} líneas → resumen. Exit code: ${exitCode ?? 'desconocido'}. Salida completa: ${fullPath}`,
  ]
  for (const s of sections) {
    const cap = ITEM_CAP[s.name] ?? 10
    parts.push('', `## ${s.name}`, ...s.summary)
    if (s.items.length) parts.push('', s.items.slice(0, cap).join(s.name === 'minitest' || s.items[0]!.includes('\n') ? '\n\n' : '\n'))
    if (s.total > cap && s.name === 'minitest') {
      // One line per remaining failure: the test name and its rerun line.
      const rest = s.items.slice(cap).map(b => {
        const ls = b.split('\n')
        const who = (ls[1] ?? '').replace(/\s*\[.*$/, '').replace(/:$/, '')
        const rerun = ls.find(l => MT_RERUN.test(l)) ?? ''
        return `- ${ls[0]!.trim().replace(/:$/, '')} ${who}${rerun ? ` → ${rerun.trim()}` : ''}`
      })
      parts.push('', `Otros ${s.total - cap} (bloque completo en el archivo):`, ...rest.slice(0, 30))
      if (rest.length > 30) parts.push(`(y ${rest.length - 30} más)`)
    } else if (s.total > cap) parts.push('', `(y ${s.total - cap} más en el archivo completo)`)
  }
  parts.push('', `Para el detalle: grep o Read con offset/limit sobre el archivo completo. /check-filter full deja pasar entera la próxima salida.`)
  const text = parts.join('\n')
  return text.length > output.length * MAX_RATIO ? null : text
}

// ---------- engine glue ----------

// The log keeps its last LOG_MAX bytes (as effort-optimizer's does), trimmed once per session start.
export const LOG_MAX = 20_000
export const TRIM_LOG = '[ -f "$1" ] && [ "$(wc -c < "$1")" -gt "$2" ] && tail -c "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; true'
// /mods on/off is read this often; nothing else rides on this poll.
export const SWITCH_POLL_MS = 10_000

let home = ''
let off = false
let polling = false
const fullNext = new Set<string>()
const chatOff = new Set<string>()
const counts = new Map<string, { runs: number; before: number; after: number }>()

const tokens = (s: string) => Math.round(s.length / 4)

async function sid($: EngineInterface) {
  return String(await $.session.id().catch(() => ''))
}

async function sh($: EngineInterface, script: string, args: string[], stdin?: string) {
  return $.process.run(['/bin/sh', '-c', script, 'sh', ...args], { stdin, timeoutMs: 10_000 })
}

async function append($: EngineInterface, path: string, line: string) {
  await sh($, 'mkdir -p "$(dirname "$1")" && cat >> "$1"', [path], `${line}\n`).catch(() => undefined)
}

async function log($: EngineInterface, msg: string) {
  try {
    await append($, `${home}/.claude/mods-logs/${NAME}.log`, `${new Date().toISOString()} ${msg}`)
  } catch {
    // logging never breaks the hook
  }
}

async function readSwitch($: EngineInterface) {
  try {
    const path = `${home}/.claude/mods/switches.json`
    const json = (await $.fs.exists(path)) ? (JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>) : {}
    off = json[NAME] === false
  } catch {
    // keep the last value
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} …` : s)

// The text the model would read: from the tool's record on success, from core's error text on a failure.
// A huge output core saved to disk is read back from that file.
async function fullText($: EngineInterface, text: string, persisted?: string) {
  const path = persisted ?? /(\/[^\s'"]*\/tool-results\/[^\s'"]+)/.exec(text)?.[1]
  if (!path) return text
  const st = await $.fs.stat(path).catch(() => null)
  if (!st || st.size > READ_MAX_BYTES) return text
  return String(await $.fs.read(path))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    try {
      await $.command.register({
        name: NAME,
        description: 'Check Filter. No argument: what it did in this chat. full: let the next test/lint output through whole. off/on: this chat',
        argumentHint: '[full | off | on]',
        immediate: true,
      })
    } catch (err) {
      await log($, `command not registered: ${String(err)}`)
    }
    await readSwitch($)
    void sh($, 'find "$1" -type f -mtime +7 -delete 2>/dev/null; true', [`${home}/.claude/mods-logs/${NAME}`]).catch(() => undefined)
    void sh($, TRIM_LOG, [`${home}/.claude/mods-logs/${NAME}.log`, String(LOG_MAX)]).catch(() => undefined)
    if (!polling) {
      polling = true
      $.clock.every(SWITCH_POLL_MS, () => void readSwitch($).catch(() => undefined))
    }
    return next(e)
  })

  on('command.run', { command: NAME }, async ($, e) => {
    const id = await sid($)
    const arg = String((e as { args?: string }).args ?? '').trim()
    if (arg === 'full') {
      fullNext.add(id)
      return { text: `${NAME}: the next test/lint output in this chat passes through whole.` }
    }
    if (arg === 'off') {
      chatOff.add(id)
      return { text: `${NAME}: off in this chat.` }
    }
    if (arg === 'on') {
      chatOff.delete(id)
      return { text: `${NAME}: on in this chat.` }
    }
    const c = counts.get(id)
    const state = off ? 'off in every chat ("check-filter": false in switches.json)' : chatOff.has(id) ? 'off in this chat' : 'on'
    return {
      text: `${NAME}: ${state}. This chat: ${c?.runs ?? 0} outputs condensed, ~${c?.before ?? 0} → ~${c?.after ?? 0} tokens. Full outputs: ${home}/.claude/mods-logs/${NAME}/`,
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (off || e.run_in_background || ran.deny !== undefined) return ran
    if (matchFilters(e.command).length === 0) return ran
    const id = await sid($)
    if (chatOff.has(id)) return ran
    try {
      let output: string
      let exitCode: number | null
      if (ran.isError === true) {
        const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')
        const m = /^Exit code (\d+)/.exec(text)
        if (!m) return ran // interrupted, timed out or threw: leave it alone
        exitCode = Number(m[1])
        output = await fullText($, text)
      } else {
        const r = ran.result as { stdout?: string; stderr?: string; interrupted?: boolean; isImage?: boolean; backgroundTaskId?: string; persistedOutputPath?: string }
        if (!r || typeof r.stdout !== 'string' || r.interrupted || r.isImage || r.backgroundTaskId) return ran
        exitCode = 0
        output = r.persistedOutputPath ? await fullText($, r.stdout, r.persistedOutputPath) : [r.stdout, r.stderr].filter(Boolean).join('\n')
      }
      if (fullNext.delete(id)) {
        await log($, `pass (full requested): ${clip(e.command, 160)}`)
        return ran
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const slug = matchFilters(e.command).map(f => f.id).join('+')
      const path = `${home}/.claude/mods-logs/${NAME}/${stamp}-${slug}.txt`
      const text = condense(e.command, output, exitCode, path)
      if (text === null) {
        await log($, `pass (${output.split('\n').length} lines, short or no pattern): ${clip(e.command, 160)}`)
        return ran
      }
      const saved = await sh($, 'mkdir -p "$(dirname "$1")" && cat > "$1"', [path], `$ ${e.command}\n\n${output}`)
      if (saved.exitCode !== 0) {
        await log($, `pass (could not save full output): ${clip(e.command, 160)}`)
        return ran
      }
      const before = tokens(output)
      const after = tokens(text)
      const c = counts.get(id) ?? { runs: 0, before: 0, after: 0 }
      counts.set(id, { runs: c.runs + 1, before: c.before + before, after: c.after + after })
      await log($, `condensed ~${before} → ~${after} tokens, exit ${exitCode}: ${clip(e.command, 160)}`)
      await append(
        $,
        `${home}/.claude/mods-logs/savings.jsonl`,
        JSON.stringify({
          ts: new Date().toISOString(),
          session: id || null,
          tool_use_id: e.tool_use_id ?? null,
          mod: NAME,
          part: 'bash',
          tool: 'Bash',
          action: `condensed output of ${clip(e.command, 100)}`,
          before,
          after,
          helper: null,
          measured: 'estimated',
          detail: path,
        }),
      )
      if (ran.isError === true) return { deny: text }
      const r = ran.result as Record<string, unknown>
      return { result: { ...r, stdout: text, stderr: '', persistedOutputPath: undefined, persistedOutputSize: undefined, rawOutputPath: undefined } } as typeof ran
    } catch (err) {
      await log($, `error, plain output sent: ${String(err)}`)
      return ran
    }
  }).catch(($, e, next) => (next.called ? { deny: `${NAME}: the command ran but the filter broke; run it again with /check-filter full.` } : next(e)))
}
