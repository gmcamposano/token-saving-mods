import { expect, test } from 'claude-code/testing'
import {
  ALL_CHARS,
  CAPS,
  clean,
  EFFORTS,
  cleanQueries,
  joinPrompt,
  oneLine,
  PAGE_CHARS,
  parseJoin,
  parseKeep,
  parsePlan,
  parseWriteUp,
  planFallback,
  planPrompt,
  relevantPrompt,
  shortenPrompt,
  urlsIn,
  wasCut,
  writeUpPrompt,
} from './prompts'

const TODAY = '2026-11-17'

test('clean and oneLine: no dashes, no banned word, capped', () => {
  expect(clean('fast — cheap – good, we ship it', 100)).toBe('fast, cheap, good, we publish it')
  expect(oneLine('a\n\n b   c', 3)).toBe('a b')
})

test('urlsIn: unique URLs without trailing punctuation', () => {
  expect(urlsIn('see https://a.com/x. and (https://b.org/y), again https://a.com/x')).toEqual(['https://a.com/x', 'https://b.org/y'])
})

test('cleanQueries strips bullets, numbering and whole-line quotes, keeps inner quotes', () => {
  expect(cleanQueries(['- "claude code" changelog', '2) "release notes"', 'ab', null])).toEqual(['"claude code" changelog', 'release notes'])
})

test('parsePlan: deep needs two parts; quick drops parts', () => {
  const deep = parsePlan('{"mode":"deep","queries":["a b c","d e f"],"parts":["one part","two part"],"official":[],"since":null}', 'q', false, TODAY)
  expect(deep.mode).toBe('deep')
  expect(deep.parts).toEqual(['one part', 'two part'])
  const thin = parsePlan('{"mode":"deep","queries":["a b c"],"parts":["only one"]}', 'q', false, TODAY)
  expect(thin.mode).toBe('quick')
  expect(thin.parts).toEqual([])
})

test('parsePlan: since only as a past date, official only https, at most 2 queries', () => {
  const p = parsePlan(
    'Sure:\n{"mode":"quick","queries":["q one","q two","q three"],"official":["https://x.dev/changelog","http://insecure.dev","not a url"],"since":"2026-11-10"}',
    'q',
    false,
    TODAY,
  )
  expect(p.queries).toEqual(['q one', 'q two'])
  expect(p.official).toEqual(['https://x.dev/changelog'])
  expect(p.since).toBe('2026-11-10')
  expect(parsePlan('{"since":"2027-01-01"}', 'q', false, TODAY).since).toBeNull()
  expect(parsePlan('{"since":"last week"}', 'q', false, TODAY).since).toBeNull()
})

test('parsePlan: no queries falls back to the question; forceDeep keeps a part', () => {
  const p = parsePlan('{"mode":"quick","queries":[]}', 'what changed in X?', true, TODAY)
  expect(p.mode).toBe('deep')
  expect(p.queries).toEqual(['what changed in X?'])
  expect(p.parts).toEqual(['what changed in X?'])
})

test('parsePlan throws on a cut answer with no JSON, so plan() falls back', () => {
  expect(() => parsePlan('{"mode":"quick","queries":["a', 'q', false, TODAY)).toThrow()
  expect(planFallback('q', false)).toEqual({ mode: 'quick', queries: ['q'], parts: [], since: null, official: [] })
})

test('parseKeep reads the list and the reason; throws without one', () => {
  const k = parseKeep('{"keep":[1,"3"],"why":"same product"}')
  expect([...k.keep]).toEqual([1, 3])
  expect(k.why).toBe('same product')
  expect(() => parseKeep('{"why":"x"}')).toThrow()
  expect(() => parseKeep('{"keep":[1,')).toThrow()
})

test('parseWriteUp reads both parts; a cut answer keeps its text as notes', () => {
  expect(parseWriteUp('<brief>Answer [1].</brief>\n<notes>Detail [1].</notes>')).toEqual({ brief: 'Answer [1].', notes: 'Detail [1].' })
  const cut = parseWriteUp('<brief>Answer [1].</brief>\n<notes>Detail [1] and then')
  expect(cut.brief).toBe('Answer [1].')
  expect(cut.notes).toContain('<notes>Detail [1] and then')
})

test('parseJoin reads the brief, or the head of a cut answer', () => {
  expect(parseJoin('x <brief>The answer [2].</brief> y')).toBe('The answer [2].')
  expect(parseJoin('<brief>cut mid')).toBe('<brief>cut mid')
})

test('planPrompt and relevantPrompt carry the request, date and window', () => {
  expect(planPrompt('what changed?', true, TODAY)).toContain('This request is deep')
  expect(planPrompt('what changed?', false, TODAY)).toContain(`Today is ${TODAY}.`)
  const r = relevantPrompt('Tidepool DB', [{ title: 'T', url: 'https://t.dev', text: 'x'.repeat(900), via: 'fetch', newest: '2026-11-01' }], '2026-11-10', TODAY)
  expect(r).toContain('[1] T (https://t.dev), newest date 2026-11-01')
  expect(r).toContain('The request covers 2026-11-10 to 2026-11-17.')
  expect(r).not.toContain('x'.repeat(601))
})

test('writeUpPrompt spends at most PAGE_CHARS a page and ALL_CHARS in all', () => {
  const big = { title: 'B', url: 'https://b.dev', text: 'y'.repeat(PAGE_CHARS * 2), via: 'fetch' }
  const p = writeUpPrompt('q', Array.from({ length: 8 }, () => big), [], TODAY, null)
  expect((p.match(/y{100,}/g) ?? []).reduce((s, m) => s + m.length, 0)).toBe(ALL_CHARS)
  expect(writeUpPrompt('q', [], [], TODAY, null)).toContain('(none: no page was about the question)')
})

test('joinPrompt names failed parts; shortenPrompt caps the commentary', () => {
  expect(joinPrompt('q', [], ['r1'], ['part 2'])).toContain('These parts failed and have no report: part 2')
  expect(shortenPrompt('q', 'z'.repeat(ALL_CHARS + 10))).not.toContain('z'.repeat(ALL_CHARS + 1))
})

test('every call asks for low effort and leaves room for thinking (measured up to ~1,300 thinking tokens)', () => {
  for (const call of ['plan', 'relevant', 'writeUp', 'join', 'shorten'] as const) {
    expect(EFFORTS[call]).toBe('low')
    expect(CAPS[call]).toBeGreaterThanOrEqual(3000)
  }
})

test('wasCut: a reply at or over its cap, and only that', () => {
  expect(wasCut(CAPS.plan - 1, 'plan')).toBe(false)
  expect(wasCut(CAPS.plan, 'plan')).toBe(true)
  expect(wasCut(undefined, 'shorten')).toBe(false)
})
