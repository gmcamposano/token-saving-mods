// Real-model eval of the effort judge. `claude plugin test` cannot reach a model (the kit stands in for the
// engine), so this runs the exact judge prompt from hooks/framework.ts through `claude -p` on your login.
//
//   node --experimental-strip-types judge-eval/judge-eval.ts [--models haiku,sonnet] [--runs 1] [-j 4]
//
// Run from the effort-optimizer folder. Exits 1 when the first model misses the bar:
// accuracy >= 80% and no severe miss (two steps off, e.g. low for a high case). Cost: well under a cent
// per Haiku run of all cases.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capPick, JUDGE_EFFORT, parsePick, pickPrompt } from '../hooks/framework.ts'

type Case = { id: string; prompt: string; lastReply?: string; ok: string[] }
type Row = { id: string; got: string; ok: string[]; pass: boolean; severe: boolean; usd: number }

const NOW = 'medium' as const
const MIN_ACCURACY = 0.8
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }

const here = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')) as Case[]

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const models = arg('--models', 'haiku,sonnet').split(',')
const runs = Number(arg('--runs', '1'))
const jobs = Number(arg('-j', '4'))

// No settings, plugins, MCP or tools: the judge sees only its prompt, as $.model.complete sends it.
function ask(model: string, prompt: string): Promise<{ text: string; usd: number }> {
  const argv = [
    '-p', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '',
    '--no-session-persistence', '--output-format', 'json', '--model', model, '--effort', JUDGE_EFFORT,
    '--system-prompt', 'You are a classifier. Follow the instructions in the message.', prompt,
  ]
  return new Promise((resolve, reject) => {
    execFile('claude', argv, { maxBuffer: 4 << 20, timeout: 60_000 }, (err, stdout) => {
      if (err) return reject(err)
      try {
        const d = JSON.parse(stdout) as { result?: string; total_cost_usd?: number; terminal_reason?: string }
        if (d.terminal_reason && d.terminal_reason !== 'completed') return reject(new Error(d.terminal_reason))
        resolve({ text: d.result ?? '', usd: d.total_cost_usd ?? 0 })
      } catch (e) {
        reject(e)
      }
    })
  })
}

async function judge(model: string, c: Case): Promise<Row> {
  const { text, usd } = await ask(model, pickPrompt(c.prompt.slice(0, 4000), c.lastReply ?? '', NOW))
  const p = parsePick(text)
  // What the mod would act on: null (keep or unreadable) leaves the level alone.
  const got = p ? capPick(p, NOW).level : /"keep"/.test(text) ? 'keep' : 'unreadable'
  const pass = c.ok.includes(got)
  const want = Math.min(...c.ok.map(l => RANK[l] ?? 1))
  const wantTop = Math.max(...c.ok.map(l => RANK[l] ?? 1))
  const severe = got in RANK && (RANK[got]! <= want - 2 || RANK[got]! >= wantTop + 2)
  return { id: c.id, got, ok: c.ok, pass, severe, usd }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

let exit = 0
const table: Record<string, Record<string, string>> = {}
for (const [index, model] of models.entries()) {
  const work = Array.from({ length: runs }, () => cases).flat()
  const rows = await pool(work, jobs, c =>
    judge(model, c).catch(e => ({ id: c.id, got: `error: ${(e as Error).message.slice(0, 40)}`, ok: c.ok, pass: false, severe: false, usd: 0 })),
  )
  const passed = rows.filter(r => r.pass).length
  const severe = rows.filter(r => r.severe)
  const usd = rows.reduce((s, r) => s + r.usd, 0)
  const accuracy = passed / rows.length
  const ok = accuracy >= MIN_ACCURACY && severe.length === 0
  for (const r of rows) (table[r.id] ??= {})[model] = (table[r.id]![model] ? `${table[r.id]![model]},` : '') + (r.pass ? r.got : `✗${r.got}`)
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${model}: ${passed}/${rows.length} (${(accuracy * 100).toFixed(0)}%), severe ${severe.length}, $${usd.toFixed(4)}` +
      (severe.length ? `  severe: ${severe.map(r => `${r.id}=${r.got}`).join(' ')}` : ''),
  )
  if (index === 0 && !ok) exit = 1
}

console.log(`\n${'case'.padEnd(16)} ${'want'.padEnd(13)} ${models.map(m => m.padEnd(16)).join(' ')}`)
for (const c of cases) console.log(`${c.id.padEnd(16)} ${c.ok.join('/').padEnd(13)} ${models.map(m => (table[c.id]?.[m] ?? '').padEnd(16)).join(' ')}`)
process.exit(exit)
