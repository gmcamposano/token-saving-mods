// The pure part of a file or shell-output hand-off: how text is cut into parts and the prompt Haiku reads for
// each. No JSX and no engine calls, so register.tsx, the tests and judge-eval/notes-eval.ts share one copy.

// What the helper reads per call, and in all. Longer files get their head and tail read.
export const CHUNK_CHARS = 120_000
export const MAX_CHARS = 960_000
// Longer lines are cut, as core's Read cuts them (transcripts often have 1,000 to 1,300 character lines).
export const LINE_CHARS = 2000
// The words all parts of one hand-off share.
export const NOTE_WORDS = 1500

export type Line = { n: number; text: string; page?: number }
export type Chunk = { lines: Line[] }
// What a read is for: the person's real request (in a subagent, its own prompt) and Claude's words just before
// the call. The request picks the notes: the same file for another request gets new notes.
export type Task = { user: string; assistant: string }
// The fields of a source the prompt reads.
export type PromptSource = { path: string; kind: 'text' | 'pdf'; title?: string; where?: string; noun?: 'output' }

export function fmt(n: number) {
  return n.toLocaleString('en-US')
}

// Words per part: the hand-off's budget split across its parts, 150 to 600 each.
export function noteWords(parts: number) {
  return Math.max(150, Math.min(600, Math.round(NOTE_WORDS / parts)))
}

// The output cap for one part's notes. Haiku thinks even at effort low and its thinking counts against the cap,
// and $.model.complete does not say when a reply was cut. judge-eval/notes-eval.ts (2026-11-17) measured up to
// 3,647 thinking tokens on one part and visible notes over 2 tokens a word; the old cap (words * 2 + 300, 900 to
// 1,500) cut 7 of 10 hand-offs. Only what is used is billed, so the headroom costs nothing on a normal part.
export function noteMaxTokens(words: number) {
  return words * 3 + 6000
}

// Said under a part whose reply used the whole cap: its notes may stop mid-way, so Claude knows to read the text.
export const CUT_NOTICE = '[These notes may be cut short: the helper ran out of room. Read the exact lines for anything they do not cover.]'

export function maybeCut(text: string, outputTokens: number | undefined, cap: number) {
  return outputTokens !== undefined && outputTokens >= cap ? `${text}\n${CUT_NOTICE}` : text
}

export const FILE_SYSTEM = [
  'You write reading notes for another AI model. It will not see the file, only your notes.',
  'Be exact and short. Cite every place with the line numbers given at the start of each line.',
  'Plain text or simple markdown bullets. No preamble, no closing remarks, no em dashes.',
].join(' ')

export function cut(text: string) {
  return text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS)} [line cut]` : text
}

const size = (l: Line) => l.text.length + 10

// Keeps line boundaries; one chunk is at most CHUNK_CHARS of numbered text.
export function chunk(lines: Line[]): Chunk[] {
  const out: Chunk[] = []
  let cur: Line[] = []
  let n = 0
  for (const line of lines) {
    if (cur.length > 0 && n + size(line) > CHUNK_CHARS) {
      out.push({ lines: cur })
      cur = []
      n = 0
    }
    cur.push(line)
    n += size(line)
  }
  if (cur.length > 0) out.push({ lines: cur })
  return out
}

// Over MAX_CHARS the helper reads the head and the tail; the gap is said in the notes.
export function fit(lines: Line[]): { kept: Line[]; gap: string } {
  if (lines.reduce((s, l) => s + size(l), 0) <= MAX_CHARS) return { kept: lines, gap: '' }
  const half = MAX_CHARS / 2
  let h = 0
  let n = 0
  while (h < lines.length && n + size(lines[h]!) <= half) n += size(lines[h++]!)
  let t = lines.length
  n = 0
  while (t > h && n + size(lines[t - 1]!) <= half) n += size(lines[--t]!)
  const from = lines[h]?.n ?? 0
  const to = lines[t - 1]?.n ?? 0
  return { kept: [...lines.slice(0, h), ...lines.slice(t)], gap: `The helper skipped lines ${fmt(from)}-${fmt(to)} (too big to read whole).` }
}

export function toLines(text: string, from: number): Line[] {
  const raw = text.split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  return raw.map((t, i) => ({ n: from + i, text: cut(t) }))
}

export function promptFor(src: PromptSource, part: Chunk, i: number, of: number, words: number, task: Task) {
  const first = part.lines[0]!
  const last = part.lines[part.lines.length - 1]!
  const where = src.kind === 'pdf' ? `pages ${first.page}-${last.page}, lines L${first.n}-L${last.n}` : `lines L${first.n}-L${last.n}`
  const cite =
    src.kind === 'pdf'
      ? 'Cite places as p.<page> L<start>-L<end>. "=== Page N ===" lines mark where each page starts.'
      : 'Cite places as L<start>-L<end>.'
  const what =
    src.kind === 'pdf' || /\.(md|mdx|txt|rst|html?|docx?|rtf|vtt|srt)\b/i.test(src.title ? (src.where ?? '') : src.path)
      ? 'Cover: the headings and sections with where each starts, key facts, numbers, names, dates, definitions and conclusions.'
      : 'Cover: the structure (sections, functions, classes, tables, config blocks) with where each starts, key values and names. For logs: first and last timestamps, each distinct error or warning with a count and where it first and last shows, and anything unusual.'
  return [
    `${src.title ?? `File: ${src.path}`}. Part ${i + 1} of ${of}: ${where}.`,
    ...(task.user ? [`The agent's task (the person's request): ${task.user}`] : []),
    ...(task.assistant ? [`Why the agent is reading this ${src.noun ?? 'file'} (its words just before the read): ${task.assistant}`] : []),
    `Write notes that let the agent do this task without reading the ${src.noun ?? 'file'} itself, and know exactly where to look for the full text.`,
    task.user || task.assistant ? 'Put first what the task needs. Then still cover the whole part, so nothing the task might need is missing.' : '',
    cite,
    what,
    'Quote short exact strings when they matter (ids, error messages, keys, figures).',
    `At most ${words} words.`,
    '<text>',
    part.lines.map(l => `L${l.n}: ${l.text}`).join('\n'),
    '</text>',
  ]
    .filter(Boolean)
    .join('\n')
}
