import { expect, test } from 'claude-code/testing'
import { CHUNK_CHARS, chunk, CUT_NOTICE, cut, FILE_SYSTEM, fit, LINE_CHARS, MAX_CHARS, maybeCut, noteMaxTokens, noteWords, partsChars, promptFor, toLines } from './notes'

const lines = (n: number, len: number) => toLines(Array.from({ length: n }, (_, i) => `${i + 1}`.padEnd(len, 'x')).join('\n'), 1)

test('toLines numbers from the start given, drops the trailing empty line and cuts long lines', () => {
  const ls = toLines(`a\n${'y'.repeat(LINE_CHARS + 5)}\n`, 7)
  expect(ls.length).toBe(2)
  expect(ls[0]).toEqual({ n: 7, text: 'a' })
  expect(ls[1]!.n).toBe(8)
  expect(ls[1]!.text.endsWith(' [line cut]')).toBe(true)
  expect(cut('short')).toBe('short')
})

test('chunk keeps line boundaries, numbering and order, each part within CHUNK_CHARS', () => {
  const all = lines(3000, 100)
  const parts = chunk(all)
  expect(parts.length).toBeGreaterThan(1)
  expect(parts.flatMap(p => p.lines.map(l => l.n))).toEqual(all.map(l => l.n))
  for (const p of parts) expect(p.lines.reduce((s, l) => s + l.text.length + 10, 0)).toBeLessThanOrEqual(CHUNK_CHARS)
  expect(chunk([])).toEqual([])
})

test('fit keeps small input whole and big input as head + tail with the gap named', () => {
  const small = lines(100, 50)
  expect(fit(small)).toEqual({ kept: small, gap: '' })
  const big = lines(Math.ceil(MAX_CHARS / 100) + 2000, 90)
  const { kept, gap } = fit(big)
  expect(kept.length).toBeLessThan(big.length)
  expect(kept[0]!.n).toBe(1)
  expect(kept[kept.length - 1]!.n).toBe(big.length)
  const skipped = /skipped lines ([\d,]+)-([\d,]+)/.exec(gap)
  expect(skipped).not.toBeNull()
  const from = Number(skipped![1]!.replace(/,/g, ''))
  const to = Number(skipped![2]!.replace(/,/g, ''))
  expect(kept.some(l => l.n >= from && l.n <= to)).toBe(false)
  expect(kept.length + (to - from + 1)).toBe(big.length)
})

test('word budget: 150 to 600 per part, and room to finish them', () => {
  expect(noteWords(1)).toBe(600)
  expect(noteWords(5)).toBe(300)
  expect(noteWords(20)).toBe(150)
  // Haiku's thinking counts against the cap (measured up to 3,647 tokens at effort low) and notes run over 2
  // tokens a word: every part keeps room for both.
  for (const parts of [1, 2, 5, 20]) expect(noteMaxTokens(noteWords(parts))).toBeGreaterThanOrEqual(noteWords(parts) * 3 + 6000)
})

test('maybeCut flags a reply that used the whole cap, and only that', () => {
  expect(maybeCut('notes', 999, 1000)).toBe('notes')
  expect(maybeCut('notes', undefined, 1000)).toBe('notes')
  expect(maybeCut('notes', 1000, 1000)).toBe(`notes\n${CUT_NOTICE}`)
})

test('promptFor: a shell output names the command, the task, the line refs and the text', () => {
  const part = { lines: [{ n: 10, text: 'ERROR boom' }, { n: 11, text: 'ok' }] }
  const p = promptFor(
    { path: '/s/out.txt', kind: 'text', title: 'Output of the shell command `grep x`', where: 'grep x', noun: 'output' },
    part,
    1,
    3,
    200,
    { user: 'why does it fail?', assistant: 'Checking the log' },
  )
  expect(p).toContain('Output of the shell command `grep x`. Part 2 of 3: lines L10-L11.')
  expect(p).toContain("The agent's task (the person's request): why does it fail?")
  expect(p).toContain('Why the agent is reading this output')
  expect(p).toContain('Put first what the task needs')
  expect(p).toContain('For logs:')
  expect(p).toContain('At most 200 words.')
  expect(p).toContain('<text>\nL10: ERROR boom\nL11: ok\n</text>')
})

test('promptFor: a PDF cites pages; docs get the document checklist; no task, no task lines', () => {
  const part = { lines: [{ n: 1, text: '=== Page 3 ===', page: 3 }, { n: 2, text: 'Total 4', page: 3 }] }
  const pdf = promptFor({ path: '/d/a.pdf', kind: 'pdf' }, part, 0, 1, 600, { user: '', assistant: '' })
  expect(pdf).toContain('pages 3-3, lines L1-L2')
  expect(pdf).toContain('p.<page> L<start>-L<end>')
  expect(pdf).toContain('key facts, numbers, names, dates')
  expect(pdf).not.toContain("The agent's task")
  expect(pdf).not.toContain('Put first what the task needs')
  const md = promptFor({ path: '/d/notes.md', kind: 'text' }, part, 0, 1, 600, { user: '', assistant: '' })
  expect(md).toContain('File: /d/notes.md')
  expect(md).toContain('key facts, numbers, names, dates')
})

test('the system prompt asks for exact, cited notes', () => {
  expect(FILE_SYSTEM).toContain('It will not see the file, only your notes.')
  expect(FILE_SYSTEM).toContain('Cite every place')
})

test('word budget follows the text size: about chars / 32, never under 150 or over 600 a part', () => {
  expect(noteWords(1, 9000)).toBe(281)
  expect(noteWords(1, 2000)).toBe(150)
  expect(noteWords(1, 500_000)).toBe(600)
  expect(noteWords(4, 346_119)).toBe(noteWords(4))
  expect(partsChars([{ lines: [{ n: 1, text: 'abc' }, { n: 2, text: '' }] }])).toBe(5)
})
