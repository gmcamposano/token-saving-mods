import { expect, test } from 'claude-code/testing'
import { asLevel, CAP_WHY, capPick, cleanWhy, isGoOn, JUDGE_EFFORT, JUDGE_MODEL, parsePick, pickPrompt } from './framework'

test('the judge runs on Haiku at low effort', () => {
  expect(JUDGE_MODEL).toBe('haiku')
  expect(JUDGE_EFFORT).toBe('low')
})

test('asLevel reads every spelling of a level and nothing else', () => {
  expect(asLevel('High')).toBe('high')
  expect(asLevel('Extra high')).toBe('xhigh')
  expect(asLevel('x-high')).toBe('xhigh')
  expect(asLevel('MAX')).toBe('max')
  expect(asLevel('keep')).toBe('')
  expect(asLevel('ultra')).toBe('')
  expect(asLevel(3)).toBe('')
})

test('parsePick reads JSON wrapped in prose or a code fence', () => {
  expect(parsePick('{"level":"medium","why":"everyday writing"}')).toEqual({ level: 'medium', why: 'everyday writing' })
  expect(parsePick('Sure:\n```json\n{"level": "low", "why": "quick tweak."}\n```')).toEqual({ level: 'low', why: 'quick tweak' })
})

test('parsePick gives null for keep, broken JSON or no JSON', () => {
  expect(parsePick('{"level":"keep","why":"approval"}')).toBeNull()
  expect(parsePick('{"level":"high",')).toBeNull()
  expect(parsePick('high')).toBeNull()
  expect(parsePick('{"why":"no level"}')).toBeNull()
})

test('cleanWhy strips dashes, the banned word and quotes, and caps the length', () => {
  expect(cleanWhy('"risky — we ship money."')).toBe('risky, we publish money')
  expect(cleanWhy('x'.repeat(200)).length).toBe(90)
})

test('capPick lowers xhigh and max to high with the self-check hint', () => {
  for (const level of ['xhigh', 'max'] as const) {
    expect(capPick({ level, why: 'long critical job' }, 'medium')).toEqual({ level: 'high', why: CAP_WHY })
    expect(capPick({ level, why: 'long critical job' }, '')).toEqual({ level: 'high', why: CAP_WHY })
  }
  expect(CAP_WHY.length).toBeLessThanOrEqual(90)
})

test('capPick keeps a level set past high by hand', () => {
  expect(capPick({ level: 'max', why: 'w' }, 'xhigh')).toEqual({ level: 'xhigh', why: 'w' })
  expect(capPick({ level: 'xhigh', why: 'w' }, 'max')).toEqual({ level: 'max', why: 'w' })
})

test('capPick leaves low, medium and high alone', () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    expect(capPick({ level, why: 'w' }, 'xhigh')).toEqual({ level, why: 'w' })
  }
})

test('pickPrompt carries the prompt, the last reply and the current level', () => {
  const p = pickPrompt('fix the login bug', 'I found the cause', 'medium')
  expect(p).toContain('<prompt>\nfix the login bug\n</prompt>')
  expect(p).toContain('I found the cause')
  expect(p).toContain('The chat runs at: medium')
  expect(pickPrompt('hi', '', '')).toContain('(none, this is the first prompt)')
  expect(pickPrompt('hi', '', '')).toContain('The chat runs at: unknown')
})

test('isGoOn skips the judge only for bare approvals and go-ons', () => {
  for (const t of ['ok', 'Yes.', 'go ahead', 'sí, dale', 'Hazlo', 'continúa por favor', 'option 2', 'la 2', 'LGTM!', '3']) {
    expect(isGoOn(t)).toBe(true)
  }
  for (const t of ['', 'no', 'sí, pero cambia el test', 'ok, now review the contract for risk', 'fix it', 'yes yes yes yes yes yes']) {
    expect(isGoOn(t)).toBe(false)
  }
})
