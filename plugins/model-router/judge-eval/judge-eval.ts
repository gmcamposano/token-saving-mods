// Real-model eval of the model-router judge. `claude plugin test` cannot reach a model (the kit stands in for the
// engine), so this sends JUDGE_SYSTEM + judgePrompt from hooks/policy.ts through `claude -p` on your login, then
// routes the answer exactly as a subagent spawn does (effort dropped, parent on Opus) and grades the model it lands on.
//
//   node --experimental-strip-types judge-eval/judge-eval.ts [--models haiku,sonnet] [--runs 1] [-j 4]
//
// Run from the model-router folder. Exits 1 when the first model misses the bar: accuracy >= 80% and no severe
// miss. Severe: a code edit or a deep task lands on the fast tier, or a risky task lands below deep.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JUDGE_SYSTEM, judgePrompt, type PolicyConfig, rankOf, readJudgement, route, TIER_ORDER } from '../hooks/policy.ts'

type Case = { id: string; prompt: string; agentType?: string; description?: string; ok: string[]; edit?: boolean; risky?: boolean }
type Row = { id: string; got: string; pass: boolean; severe: boolean; usd: number }

// The defaults model-router.ts reads when no option is set.
const CFG: PolicyConfig = {
  tiers: { fast: 'claude-haiku-5-5', balanced: 'claude-sonnet-5-5', deep: 'claude-opus-5-5' },
  minUpgradeConfidence: 0.3,
  minDowngradeConfidence: 0.6,
}
const PARENT = 'claude-opus-5-5'
const MIN_ACCURACY = 0.8

const here = dirname(fileURLToPath(import.meta.url))
const cases = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')) as Case[]

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const models = arg('--models', 'haiku,sonnet').split(',')
const runs = Number(arg('--runs', '1'))
const jobs = Number(arg('-j', '4'))

// No settings, plugins, MCP or tools: the judge sees only its system prompt and the task, as $.model.complete sends them.
function ask(model: string, prompt: string): Promise<{ text: string; usd: number }> {
  const argv = [
    '-p', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '',
    '--no-session-persistence', '--output-format', 'json', '--model', model, '--effort', 'low',
    '--system-prompt', JUDGE_SYSTEM, prompt,
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
  const { text, usd } = await ask(model, judgePrompt({ prompt: c.prompt, description: c.description, agentType: c.agentType }))
  const decision = readJudgement(text)
  const modelOnly = decision ? { ...decision, effort: null, effortConfidence: null } : null
  const landed = route(modelOnly, { model: PARENT }, CFG).model ?? PARENT
  const got = TIER_ORDER[rankOf(landed, CFG.tiers) ?? -1] ?? landed
  const pass = c.ok.includes(got)
  const severe = (got === 'fast' && (c.edit || c.ok.includes('deep'))) || (Boolean(c.risky) && got !== 'deep')
  // Show what Haiku said when routing kept the parent, so a near miss is visible.
  const said = decision && decision.tier !== got ? `${got}(${decision.tier} ${decision.confidence ?? 'n/d'})` : got
  return { id: c.id, got: said, pass, severe, usd }
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
    judge(model, c).catch(e => ({ id: c.id, got: `error: ${(e as Error).message.slice(0, 40)}`, pass: false, severe: false, usd: 0 })),
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

console.log(`\n${'case'.padEnd(16)} ${'want'.padEnd(15)} ${models.map(m => m.padEnd(22)).join(' ')}`)
for (const c of cases) console.log(`${c.id.padEnd(16)} ${c.ok.join('/').padEnd(15)} ${models.map(m => (table[c.id]?.[m] ?? '').padEnd(22)).join(' ')}`)
process.exit(exit)
