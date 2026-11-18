import { expect, test } from 'claude-code/testing'
import { condense, LOG_MAX, SWITCH_POLL_MS, TRIM_LOG } from './register'

const dots = (n: number) => Array.from({ length: n }, (_, i) => `noise line ${i}`)

const MINITEST = [
  'Run options: --seed 4242',
  '',
  '# Running:',
  ...dots(80),
  'F',
  '',
  'Failure:',
  'SalesControllerTest#test_index_filters [test/controllers/sales_controller_test.rb:12]:',
  'Expected: 2',
  '  Actual: 3',
  '',
  'bin/rails test test/controllers/sales_controller_test.rb:10',
  '',
  'E',
  '',
  'Error:',
  'SalePolicyTest#test_scope:',
  'NoMethodError: undefined method `admin?` for nil',
  '    app/policies/sale_policy.rb:3:in `index?`',
  '',
  'bin/rails test test/policies/sale_policy_test.rb:5',
  '',
  ...dots(20),
  'Finished in 12.345678s, 30.0 runs/s, 80.0 assertions/s.',
  '370 runs, 990 assertions, 1 failures, 1 errors, 0 skips',
].join('\n')

test('minitest: keeps both blocks whole, the seed and the summary', () => {
  const out = condense('bin/rails test 2>&1', MINITEST, 1, '/x/full.txt')
  expect(out).not.toBeNull()
  expect(out).toContain('Exit code: 1')
  expect(out).toContain('/x/full.txt')
  expect(out).toContain('Expected: 2\n  Actual: 3\n\nbin/rails test test/controllers/sales_controller_test.rb:10')
  expect(out).toContain("app/policies/sale_policy.rb:3:in `index?`")
  expect(out).toContain('370 runs, 990 assertions, 1 failures, 1 errors, 0 skips')
  expect(out).toContain('--seed 4242')
  expect(out).not.toContain('noise line')
})

test('minitest: caps at five blocks and counts the rest', () => {
  const block = (i: number) => ['Failure:', `T#test_${i} [t.rb:${i}]:`, 'boom', '', `bin/rails test t.rb:${i}`, '']
  const text = [...dots(70), ...Array.from({ length: 8 }, (_, i) => block(i)).flat(), '8 runs, 8 assertions, 8 failures, 0 errors, 0 skips'].join('\n')
  const out = condense('bin/rails test', text, 1, '/f')!
  expect(out).toContain('test_4')
  expect(out).not.toContain('T#test_5 [t.rb:5]')
  expect(out).toContain('Otros 3 (bloque completo en el archivo):')
  expect(out).toContain('- Failure T#test_7 → bin/rails test t.rb:7')
})

test('short output, unknown command and no summary pass whole', () => {
  expect(condense('bin/rails test', 'a\nb\n1 runs, 1 assertions, 0 failures, 0 errors, 0 skips', 0, '/f')).toBeNull()
  expect(condense('git log', MINITEST, 0, '/f')).toBeNull()
  expect(condense('bin/rails test', dots(200).join('\n'), 0, '/f')).toBeNull()
})

test('rubocop and i18n-tasks in one command', () => {
  const text = [
    'Inspecting 90 files',
    ...dots(70),
    'Offenses:',
    '',
    'app/models/sale.rb:3:5: C: Style/StringLiterals: Prefer single-quoted strings.',
    '  x = "a"',
    '      ^^^',
    '90 files inspected, 1 offense detected, 1 offense autocorrectable',
    'Missing keys (1) | i18n-tasks v1.0.14',
    '+--------+------------------+',
    '| Locale | Key              |',
    '+--------+------------------+',
    '|  es    | sales.index.foo  |',
    '+--------+------------------+',
  ].join('\n')
  const out = condense('bundle exec rubocop && i18n-tasks missing', text, 1, '/f')!
  expect(out).toContain('## rubocop')
  expect(out).toContain('app/models/sale.rb:3:5: C: Style/StringLiterals')
  expect(out).toContain('90 files inspected, 1 offense detected')
  expect(out).toContain('## i18n-tasks')
  expect(out).toContain('|  es    | sales.index.foo  |')
})

test('the Bash hook swaps a long failing test run for the condensed text', async ($, on) => {
  on('session.id', () => ({ value: 's1' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', () => ({ value: false }))
  on('tool.call', () => ({ isError: true, result: `Exit code 1\n${MINITEST}`, text: `Exit code 1\n${MINITEST}` }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'bin/rails test' })
  const text = 'deny' in ran && ran.deny ? ran.deny : (ran as { text?: string }).text ?? ''
  expect(text).toContain('[check-filter]')
  expect(text).toContain('Exit code: 1')
  expect(text).not.toContain('noise line')
})

test('the Bash hook leaves other commands alone', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: MINITEST, stderr: '', interrupted: false } }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'git log' })
  expect((ran as { result: { stdout: string } }).result.stdout).toBe(MINITEST)
})

test('a run that crashed before its summary: head, app frames, tail', () => {
  const text = [
    'bin/rails aborted!',
    'ActiveRecord::PendingMigrationError: Migrations are pending.',
    ...dots(13),
    ...Array.from({ length: 150 }, (_, i) => `/home/u/.gem/ruby/3.4.0/gems/railties-8.1.0/lib/x.rb:${i}:in 'call'`),
    '/home/u/app/config/environment.rb:5:in `<main>`',
    'test/test_helper.rb:3:in `<top (required)>`',
    ...dots(10),
  ].join('\n')
  const out = condense('bin/rails test', text, 1, '/f')!
  expect(out).toContain('PendingMigrationError')
  expect(out).toContain('config/environment.rb:5')
  expect(out).toContain('test/test_helper.rb:3')
  expect(out).not.toContain('railties-8.1.0')
  expect(out.length < text.length / 3).toBe(true)
})

test('the log is trimmed to its last 20 KB and the switch is read every 10 s', () => {
  expect(LOG_MAX).toBe(20_000)
  expect(TRIM_LOG).toContain('tail -c "$2" "$1"')
  expect(SWITCH_POLL_MS).toBe(10_000)
})
