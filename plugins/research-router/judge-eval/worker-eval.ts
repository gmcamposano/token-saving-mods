// Real-model eval of research-router's five Haiku calls. `claude plugin test` cannot reach a model (the kit stands
// in for the engine), so this sends the exact prompts from hooks/prompts.ts through `claude -p` on your login, with
// each call's own effort (none sent = the model's default, medium), reads the answer with the mod's own parser,
// and checks:
//   - cut:   the answer used at least the call's output cap, so the real call would stop there, silently;
//   - parse: the mod's parser got what it needs (a plan, a keep list, closed tags), not its fallback;
//   - facts: what the answer must say, and claims it must not make.
// The pages are about a made-up product, so nothing can come from memory.
//
//   node --experimental-strip-types judge-eval/worker-eval.ts [--runs 2] [-j 4] [--case plan-window]
//
// Run from the research-router folder. Exits 1 when any check fails.
import { spawn } from 'node:child_process'
import {
  CAPS,
  type Call,
  EFFORTS,
  joinPrompt,
  parseJoin,
  parseKeep,
  parsePlan,
  parseWriteUp,
  planPrompt,
  relevantPrompt,
  shortenPrompt,
  type Source,
  SYSTEM,
  writeUpPrompt,
} from '../hooks/prompts.ts'

const TODAY = '2026-11-17'

const PAGES: Source[] = [
  {
    title: 'Tidepool DB 4.2 release notes',
    url: 'https://tidepooldb.dev/releases/4.2',
    via: 'fetch',
    newest: '2026-10-28',
    text: [
      'Tidepool DB 4.2 was released on 2026-10-28.',
      'Highlights: write throughput is up to 35% faster in our own internal benchmark on a 16-core machine.',
      'The v1 HTTP API is removed. Clients must move to the v2 API, introduced in 3.0.',
      'New: point-in-time recovery to any second in the last 7 days.',
      'Known issue: replication lag can grow past 30 s under heavy bulk loads; a fix is planned for 4.2.1.',
      ...Array.from({ length: 60 }, (_, i) => `Changelog item ${i + 1}: internal refactor of module ${i + 1}.`),
    ].join('\n'),
  },
  {
    title: 'Tidepool: surf forecasts for every beach',
    url: 'https://tidepool-surf.app/blog/new-maps',
    via: 'fetch',
    newest: '2026-11-02',
    text: 'Tidepool, the surf forecasting app, adds new swell maps for 1,200 beaches. Version 4.2 of the app brings offline mode.\n'.repeat(8),
  },
  {
    title: 'Why we moved to Tidepool DB (customer story)',
    url: 'https://blog.examplecorp.io/tidepool-db',
    via: 'fetch',
    newest: '2026-11-05',
    text: [
      'ExampleCorp moved its event store to Tidepool DB 4.2 in November 2026.',
      'In our tests writes were about 20% faster than on 4.1, less than the 35% the vendor reports.',
      'Removing the v1 API cost us two weeks of client changes.',
      ...Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} about our migration timeline and team.`),
    ].join('\n'),
  },
]

const COMMENTARY = [
  'Here is what I found about Tidepool DB 4.2 across the results.',
  ...Array.from({ length: 50 }, (_, i) => `Result ${i + 4} (https://forum.tidepooldb.dev/t/${1000 + i}) is a forum thread about an unrelated install question number ${i + 1}, with no release information, mostly people asking about docker images and ports.`),
  'The official release notes (https://tidepooldb.dev/releases/4.2) say 4.2 came out on 2026-10-28, with up to 35% faster writes in the vendor benchmark and the v1 HTTP API removed.',
  'A customer story (https://blog.examplecorp.io/tidepool-db) measured about 20% faster writes, and says dropping v1 cost two weeks.',
  ...Array.from({ length: 30 }, (_, i) => `Another listing (https://news.example.net/item/${i}) repeats the release title with no details.`),
].join('\n\n')

type Check = { must?: RegExp[]; mustNot?: RegExp[] }
type Case = { id: string; call: Call; prompt: string; read: (text: string) => { ok: boolean; why?: string; shown: string } } & Check

const CASES: Case[] = [
  {
    id: 'plan-window',
    call: 'plan',
    prompt: planPrompt('¿Qué cambió en Tidepool DB en los últimos 7 días?', false, TODAY),
    read: t => {
      try {
        const p = parsePlan(t, '', false, TODAY)
        return { ok: p.since === '2026-11-10' && p.mode === 'quick', why: `since ${p.since}, mode ${p.mode}`, shown: JSON.stringify(p) }
      } catch (e) {
        return { ok: false, why: `fallback: ${(e as Error).message}`, shown: t }
      }
    },
  },
  {
    id: 'plan-deep',
    call: 'plan',
    prompt: planPrompt('Compare Postgres, MySQL and SQLite for a multi-tenant SaaS: licensing, performance, managed hosting options and backup tooling', false, TODAY),
    read: t => {
      try {
        const p = parsePlan(t, '', false, TODAY)
        return { ok: p.mode === 'deep' && p.parts.length >= 2, why: `mode ${p.mode}, ${p.parts.length} parts`, shown: JSON.stringify(p) }
      } catch (e) {
        return { ok: false, why: `fallback: ${(e as Error).message}`, shown: t }
      }
    },
  },
  {
    id: 'relevant',
    call: 'relevant',
    prompt: relevantPrompt('What changed in Tidepool DB 4.2?', PAGES, null, TODAY),
    read: t => {
      try {
        const { keep } = parseKeep(t)
        return { ok: keep.has(1) && keep.has(3) && !keep.has(2), why: `keep ${[...keep].join(',')}`, shown: t }
      } catch (e) {
        return { ok: false, why: `every page kept: ${(e as Error).message}`, shown: t }
      }
    },
  },
  {
    id: 'writeUp',
    call: 'writeUp',
    prompt: writeUpPrompt('What changed in Tidepool DB 4.2, and is it really faster?', PAGES.filter((_, i) => i !== 1), [], TODAY, null),
    read: t => {
      const closed = /<\/notes>/i.test(t)
      const w = parseWriteUp(t)
      return { ok: closed, why: closed ? undefined : 'no </notes>: notes fall back to the whole answer', shown: `BRIEF: ${w.brief}\nNOTES: ${w.notes}` }
    },
    must: [/2026-10-28|October 28/i, /35\s?%/, /20\s?%/, /v1/, /\[1\]/, /\[2\]/, /vendor|own (internal )?benchmark|its own/i],
    mustNot: [/independent (test|benchmark)[^.]{0,40}35|35\s?%[^.]{0,60}independent/i, /surf/i],
  },
  {
    id: 'join',
    call: 'join',
    prompt: joinPrompt(
      'How do Postgres, MySQL and SQLite compare for multi-tenant SaaS?',
      [
        { title: 'Postgres row level security', url: 'https://pg.example/rls' },
        { title: 'MySQL 9 licensing FAQ', url: 'https://mysql.example/license' },
      ],
      ['Postgres supports row level security for tenant isolation since 9.5 [1].', 'MySQL Community is GPLv2; a commercial license exists for embedding [2].'],
      ['SQLite hosting options'],
    ),
    read: t => ({ ok: /<\/brief>/i.test(t), why: /<\/brief>/i.test(t) ? undefined : 'no </brief>: brief falls back to the head of the answer', shown: parseJoin(t) }),
    must: [/\[1\]/, /\[2\]/, /row level security|RLS/i, /GPL/i, /SQLite/i],
  },
  {
    id: 'shorten',
    call: 'shorten',
    prompt: shortenPrompt('Tidepool DB 4.2 release changes', COMMENTARY),
    read: t => ({ ok: true, shown: t }),
    must: [/2026-10-28/, /35\s?%/, /20\s?%/, /tidepooldb\.dev\/releases\/4\.2/, /examplecorp\.io/],
  },
]

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const runs = Number(arg('--runs', '1'))
const jobs = Number(arg('-j', '4'))
const only = arg('--case', '')

type Answer = { text: string; usd: number; out: number; thinking: number }
function ask(call: Call, prompt: string): Promise<Answer> {
  // No effort sent means the model's default; for Haiku 5.5 on the API that is medium.
  const effort = EFFORTS[call] ?? 'medium'
  const argv = ['-p', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--model', 'haiku', '--effort', effort, '--system-prompt', SYSTEM]
  return new Promise((resolve, reject) => {
    const child = spawn('claude', argv, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', d => (stdout += d))
    const timer = setTimeout(() => child.kill(), 240_000)
    child.on('close', () => {
      clearTimeout(timer)
      try {
        const d = JSON.parse(stdout) as { result?: string; total_cost_usd?: number; terminal_reason?: string; usage?: { output_tokens?: number; output_tokens_details?: { thinking_tokens?: number } } }
        if (d.terminal_reason && d.terminal_reason !== 'completed') return reject(new Error(d.terminal_reason))
        resolve({ text: d.result ?? '', usd: d.total_cost_usd ?? 0, out: d.usage?.output_tokens ?? 0, thinking: d.usage?.output_tokens_details?.thinking_tokens ?? 0 })
      } catch {
        reject(new Error(`bad output: ${stdout.slice(0, 80)}`))
      }
    })
    child.stdin.end(prompt)
  })
}

type Row = { id: string; fails: string[]; usd: number; out: number; thinking: number; cap: number }

async function run(c: Case): Promise<Row> {
  const a = await ask(c.call, c.prompt)
  const cap = CAPS[c.call]
  const fails: string[] = []
  if (a.out >= cap) fails.push(`cut: ${a.out} output tokens (${a.thinking} thinking), cap ${cap}`)
  const r = c.read(a.text)
  if (!r.ok) fails.push(`parse: ${r.why}`)
  for (const m of c.must ?? []) if (!m.test(r.shown)) fails.push(`missing ${m.source.slice(0, 40)}`)
  for (const m of c.mustNot ?? []) {
    const hit = m.exec(r.shown)
    if (hit) fails.push(`claims "${hit[0].slice(0, 60)}"`)
  }
  return { id: c.id, fails, usd: a.usd, out: a.out, thinking: a.thinking, cap }
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

const cases = CASES.filter(c => !only || c.id === only)
const work = Array.from({ length: runs }, () => cases).flat()
const rows = await pool(work, jobs, c => run(c).catch(e => ({ id: c.id, fails: [`error: ${(e as Error).message.slice(0, 60)}`], usd: 0, out: 0, thinking: 0, cap: CAPS[c.call] })))
const failed = rows.filter(r => r.fails.length)
console.log(`${failed.length ? 'FAIL' : 'PASS'} haiku: ${rows.length - failed.length}/${rows.length} calls clean, $${rows.reduce((s, r) => s + r.usd, 0).toFixed(4)}`)
for (const r of rows) console.log(`  ${r.fails.length ? '✗' : '✓'} ${r.id.padEnd(12)} out ${r.out}/${r.cap} tok (${r.thinking} thinking)${r.fails.length ? `  ${r.fails.join('; ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
