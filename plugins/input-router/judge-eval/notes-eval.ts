// Real-model eval of input-router's notes on big shell outputs. `claude plugin test` cannot reach a model (the kit
// stands in for the engine), so this builds each hand-off exactly as bashPart does (toLines, fit, chunk, noteWords,
// FILE_SYSTEM, promptFor from hooks/notes.ts), sends every part through `claude -p` on your login, and checks the
// notes Claude would get:
//   - must:    facts the task needs, as regexes that must appear;
//   - mustNot: claims the output does not support (the hallucination this eval was written after);
//   - cut:     the part used more output tokens than noteMaxTokens allows, so the real call would stop mid-notes.
//
//   node --experimental-strip-types judge-eval/notes-eval.ts [--models haiku] [--runs 1] [-j 3] [--case log]
//
// Run from the input-router folder. Exits 1 when any check fails for the first model. Notes are saved under
// the system temp folder for reading; the path is printed.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunk, FILE_SYSTEM, fit, noteMaxTokens, noteWords, partsChars, promptFor, type Task, toLines } from '../hooks/notes.ts'

type Case = { id: string; cmd: string; text: string; task: Task; must: RegExp[]; mustNot?: RegExp[] }

// Deterministic filler: the same output every run.
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pickOne = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!
const ts = (minute: number) => `2026-11-16T${String(2 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:${String(Math.floor(rnd() * 60)).padStart(2, '0')}`
const PATHS = ['/invoices', '/sales', '/customers', '/reports/607', '/dashboard', '/invoices/new']
const info = (m: number) =>
  `${ts(m)} INFO -- : [${Math.floor(rnd() * 1e8).toString(16)}] Completed 200 OK in ${Math.floor(rnd() * 400)}ms (Views: ${Math.floor(rnd() * 90)}ms | ActiveRecord: ${Math.floor(rnd() * 60)}ms) GET ${pickOne(PATHS)}`

function prodLog(): string {
  const out: string[] = []
  const errs: Record<number, string> = {}
  for (const [i, m] of [120, 380, 640, 900, 1300, 1700, 2100].entries())
    errs[m] = `ERROR -- : ActiveRecord::ConnectionTimeoutError (could not obtain a connection from the pool within 5.000 seconds; all pooled connections were in use) [attempt ${i + 1}]`
  errs[1500] = 'ERROR -- : Mseller::NotFound (404 GET /ecf/status for e-NCF E310000000123)'
  errs[2600] = 'ERROR -- : Mseller::NotFound (404 GET /ecf/status for e-NCF E310000000123)'
  errs[2400] = 'ERROR -- : Pundit::NotAuthorizedError (not allowed to destroy? this Invoice) user_id=58'
  for (let i = 0; i < 3000; i++) out.push(errs[i] ? `${ts(Math.floor(i / 25))} ${errs[i]}` : info(Math.floor(i / 25)))
  return out.join('\n')
}

function hugeLog(): string {
  // Over CHUNK_CHARS several times, so the hand-off has several parts; the one fatal line sits late in the output.
  const out: string[] = []
  for (let i = 0; i < 4200; i++) out.push(i === 3600 ? `${ts(Math.floor(i / 40))} FATAL -- : PG::DiskFull: could not extend file "base/16384/2619": No space left on device (/var/lib/postgresql)` : info(Math.floor(i / 40)))
  return out.join('\n')
}

function locales(): string {
  const out = ['es:']
  const areas = ['customers', 'invoices', 'reports', 'settings', 'users', 'products']
  for (let a = 0; a < 60; a++) {
    out.push(`  ${pickOne(areas)}_${a}:`)
    for (let k = 0; k < 40; k++) out.push(`    key_${k}: "Texto ${a}.${k} ${pickOne(['de prueba', 'del formulario', 'de ayuda', 'del botón'])}"`)
  }
  const at = 1300
  out.splice(at, 0, '  sales:', '    export:', '    title: "Exportar ventas (formato 607) — CSV"', '    hint: "Incluye notas de crédito B04"')
  return out.join('\n')
}

function plan(): string {
  const out: string[] = ['# Implementación MVP']
  const sections = ['Clientes', 'Productos', 'Facturas de consumo', 'Usuarios y roles', 'Reportes', 'Notas de crédito', 'Integración MSeller', 'Despliegue']
  for (const s of sections) {
    out.push('', `## ${s}`, '')
    const n = s === 'Notas de crédito' ? 0 : 140
    for (let i = 0; i < n; i++) out.push(`- [x] ${s}: tarea ${i + 1} ${pickOne(['validación', 'vista', 'policy', 'test', 'traducción'])} completada el 2026-${String(1 + (i % 10)).padStart(2, '0')}-1${i % 9}`)
    if (s === 'Notas de crédito') {
      out.push('- [x] Modelo CreditNote con acts_as_tenant :team')
      out.push('- [ ] Emitir e-CF tipo 34 contra la factura original (fecha límite DGII: 2027-03-15)')
      out.push('- [ ] Anular nota de crédito rechazada por MSeller (reintentar hasta 3 veces)')
      out.push('- [ ] PDF de la nota de crédito con FerrumPdf')
      for (let i = 0; i < 140; i++) out.push(`- [x] Notas de crédito: subtarea ${i + 1} cerrada`)
    }
  }
  return out.join('\n')
}

// The case this eval was written after: a grep that shows one judge's model and not the other's.
function twoJudges(): string {
  const out: string[] = ['=== policy.ts (model-router)']
  for (let i = 1; i < 160; i++) out.push(i === 64 ? "64:export const JUDGE_MODEL = 'haiku'" : `${i}:  // policy line ${i}: ${pickOne(['tier criteria', 'risk wording', 'thresholds', 'effort rubric'])} ${'.'.repeat(Math.floor(rnd() * 40))}`)
  out.push('=== register.tsx (effort-optimizer), grep -n "question|effort|low|medium|high"')
  for (let i = 0; i < 160; i++) {
    const n = 100 + i * 2
    out.push(n === 234 ? "234:    effort: 'low'," : n === 236 ? '236:    timeoutMs: 20_000,' : `${n}:  // effort level ${pickOne(['low', 'medium', 'high'])} handling ${'.'.repeat(Math.floor(rnd() * 40))}`)
  }
  return out.join('\n')
}

// Small outputs, just over the 8,000-character bar: where the notes must stay well under the output itself.
function smallCode(): string {
  const out: string[] = []
  for (let i = 1; i <= 200; i++) {
    out.push(
      i === 37
        ? '  static RETRY_LIMIT = 7'
        : i === 112
          ? "  WEBHOOK_URL = 'https://hooks.example.test/ecf/v2'"
          : i === 180
            ? "    raise NcfError, 'NCF range exhausted for B01'"
            : `  # ${pickOne(['service', 'sequence', 'invoice', 'tenant'])} helper ${i} ${'.'.repeat(Math.floor(rnd() * 30))}`,
    )
  }
  return out.join('\n')
}

function smallDiff(): string {
  const out: string[] = ['diff --git a/app/models/sale.rb b/app/models/sale.rb', '--- a/app/models/sale.rb', '+++ b/app/models/sale.rb']
  for (let i = 1; i <= 250; i++) {
    out.push(
      i === 60
        ? '-  ITBIS_RATE = 0.16'
        : i === 61
          ? '+  ITBIS_RATE = 0.18'
          : i === 190
            ? "-  test 'rejects a B02 sale without RNC' do"
            : ` ${pickOne(['  def total', '  end', '  # rounding', '  validates :ncf'])} ${'.'.repeat(Math.floor(rnd() * 30))}`,
    )
  }
  return out.join('\n')
}

const CASES: Case[] = [
  {
    id: 'log',
    cmd: 'tail -n 3000 log/production.log',
    text: prodLog(),
    task: { user: '¿Qué errores hubo anoche en producción? Necesito saber cuáles y cuántas veces.', assistant: 'Reviso el log de producción.' },
    must: [/ConnectionTimeoutError/, /(ConnectionTimeoutError|timeout)[^\n]{0,200}\b7\b|\b7\b[^\n]{0,200}(ConnectionTimeoutError|timeout)/i, /E310000000123/, /NotAuthorizedError/, /L1501\b/, /L2601\b/],
  },
  {
    id: 'huge-log',
    cmd: 'cat /var/log/app/full.log',
    text: hugeLog(),
    task: { user: 'la app se cayó anoche, busca la causa en el log', assistant: 'Leo el log completo.' },
    must: [/DiskFull|No space left/i, /\/var\/lib\/postgresql/],
  },
  {
    id: 'locale-exact',
    cmd: 'sed -n 1,3000p config/locales/es.yml',
    text: locales(),
    task: { user: 'dame el texto exacto de la clave sales.export.title y su hint', assistant: 'Busco la clave en es.yml.' },
    must: [/Exportar ventas \(formato 607\)/, /Incluye notas de crédito B04/],
  },
  {
    id: 'plan-pending',
    cmd: 'cat docs/IMPLEMENTACION_MVP.md | grep -v "^$"',
    text: plan(),
    task: { user: '¿qué falta en la sección de notas de crédito?', assistant: 'Miro el plan del MVP.' },
    must: [/tipo 34|e-CF 34/i, /2027-03-15/, /3 veces|three times|3 times/i, /FerrumPdf|PDF/],
  },
  {
    id: 'two-judges',
    cmd: 'sed -n 1,160p policy.ts; grep -n "question|effort|low|medium|high" register.tsx | head -160',
    text: twoJudges(),
    task: { user: '¿qué modelo usa el juez de cada mod (model-router y effort-optimizer)?', assistant: 'Miro policy.ts y register.tsx.' },
    must: [/haiku/i],
    mustNot: [
      /both[^\n.]{0,80}haiku|haiku[^\n.]{0,80}\bboth\b/i,
      /(effort-optimizer|register\.tsx)[^\n]{0,160}\b(uses|is|=|judge model)[^\n]{0,40}haiku/i,
      /\bsame (judge )?model\b/i,
    ],
  },
  {
    id: 'small-code',
    cmd: 'sed -n 1,200p app/services/ecf_sender.rb',
    text: smallCode(),
    task: { user: '¿cuántos reintentos hace, a qué URL va el webhook y qué error lanza cuando se acaban los NCF?', assistant: 'Leo ecf_sender.rb.' },
    must: [/RETRY_LIMIT[^\n]{0,80}\b7\b|\b7\b[^\n]{0,80}(retr|reinten)/i, /hooks\.example\.test\/ecf\/v2/, /NCF range exhausted for B01/, /L180\b/],
  },
  {
    id: 'small-diff',
    cmd: 'git diff app/models/sale.rb',
    text: smallDiff(),
    task: { user: 'resume qué cambia este diff y si quita algún test', assistant: 'Miro el diff.' },
    must: [/0\.16/, /0\.18/, /B02/, /RNC/],
  },
]

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback
}
const models = arg('--models', 'haiku').split(',')
const runs = Number(arg('--runs', '1'))
const jobs = Number(arg('-j', '3'))
const only = arg('--case', '')

type Answer = { text: string; usd: number; out: number; thinking: number }
function ask(model: string, prompt: string): Promise<Answer> {
  const argv = ['-p', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--model', model, '--effort', 'low', '--system-prompt', FILE_SYSTEM]
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
      } catch (e) {
        reject(new Error(`bad output: ${stdout.slice(0, 80)}`))
      }
    })
    child.stdin.end(prompt)
  })
}

type Row = { id: string; fails: string[]; usd: number; parts: number; words: number; maxOut: number; cap: number; notes: string; src?: number }

async function run(model: string, c: Case): Promise<Row> {
  const all = toLines(c.text, 1)
  const parts = chunk(fit(all).kept)
  const words = noteWords(parts.length, partsChars(parts))
  const cap = noteMaxTokens(words)
  const saved = `/tmp/input-router/results/eval-${c.id}.txt`
  const src = { path: saved, kind: 'text' as const, title: `Output of the shell command \`${c.cmd}\`, saved at ${saved}`, where: c.cmd, noun: 'output' as const }
  const answers = await Promise.all(parts.map((p, i) => ask(model, promptFor(src, p, i, parts.length, words, c.task))))
  const notes = answers.map((a, i) => (parts.length > 1 ? `## Part ${i + 1}\n` : '') + a.text).join('\n\n')
  const fails: string[] = []
  for (const r of c.must) if (!r.test(notes)) fails.push(`missing ${r.source.slice(0, 50)}`)
  for (const r of c.mustNot ?? []) {
    const m = r.exec(notes)
    if (m) fails.push(`claims "${m[0].slice(0, 70)}"`)
  }
  const maxOut = Math.max(...answers.map(a => a.out))
  const maxThink = Math.max(...answers.map(a => a.thinking))
  if (maxOut > cap) fails.push(`cut: a part used ${maxOut} output tokens (${maxThink} thinking), cap ${cap}`)
  return { id: c.id, fails, usd: answers.reduce((s, a) => s + a.usd, 0), parts: parts.length, words, maxOut, cap, notes, src: c.text.length }
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

const dir = join(tmpdir(), `input-router-eval-${Date.now()}`)
mkdirSync(dir, { recursive: true })
const cases = CASES.filter(c => !only || c.id === only || (only.endsWith('*') && c.id.startsWith(only.slice(0, -1))))
let exit = 0
for (const [index, model] of models.entries()) {
  const work = Array.from({ length: runs }, () => cases).flat()
  const rows = await pool(work, jobs, c => run(model, c).catch(e => ({ id: c.id, fails: [`error: ${(e as Error).message.slice(0, 60)}`], usd: 0, parts: 0, words: 0, maxOut: 0, cap: 0, notes: '' })))
  const failed = rows.filter(r => r.fails.length)
  console.log(`${failed.length ? 'FAIL' : 'PASS'} ${model}: ${rows.length - failed.length}/${rows.length} hand-offs clean, $${rows.reduce((s, r) => s + r.usd, 0).toFixed(4)}`)
  for (const [i, r] of rows.entries()) {
    writeFileSync(join(dir, `${model}-${r.id}-${i}.md`), r.notes)
    console.log(`  ${r.fails.length ? '✗' : '✓'} ${r.id.padEnd(14)} parts ${r.parts}, ${r.words} words/part, out max ${r.maxOut}/${r.cap} tok, src ${r.src ?? 0} → notes ${r.notes.length} chars${r.fails.length ? `  ${r.fails.join('; ')}` : ''}`)
  }
  if (index === 0 && failed.length) exit = 1
}
console.log(`\nNotes saved in ${dir}`)
process.exit(exit)
