// The pure part of every Haiku call this mod makes: the prompts, the output caps, and how each answer is read.
// No JSX and no engine calls, so register.tsx, the tests and judge-eval/worker-eval.ts share one copy.

export type Link = { title: string; url: string }
// `via` names the path that read the page, for the log and the notes file.
// `newest`: the newest date found on the page, YYYY-MM-DD, when there is one.
export type Source = Link & { text: string; via: string; newest?: string }
// `since`: the first day of the time window the request names, YYYY-MM-DD. `official`: pages to read first.
export type Plan = { mode: 'quick' | 'deep'; queries: string[]; parts: string[]; since: string | null; official: string[] }

export const MAX_QUERIES = 2
export const MIN_PARTS = 2
export const MAX_PARTS = 4
export const PAGE_CHARS = 12_000
export const ALL_CHARS = 60_000

export type Call = 'plan' | 'relevant' | 'writeUp' | 'join' | 'shorten'

// The output cap of each call. Haiku thinks even at effort low, its thinking counts against the cap, and
// $.model.complete does not say when a reply was cut. judge-eval/worker-eval.ts (2026-11-17) found the old caps
// (400, 200, 2500, 1200, 700) cut 6 of 12 calls: the planner never finished a deep plan and the relevance check
// never finished its list, so both fell back without a word. Only what is used is billed.
export const CAPS: Record<Call, number> = { plan: 4000, relevant: 3000, writeUp: 8000, join: 6000, shorten: 4000 }

// The effort each call asks for. Low on every call: the least thinking the engine can ask for. With none sent,
// Haiku 5.5 thinks at its default, medium.
export const EFFORTS: Record<Call, 'low' | undefined> = { plan: 'low', relevant: 'low', writeUp: 'low', join: 'low', shorten: 'low' }

// A reply that used its whole cap may stop mid-way.
export function wasCut(outputTokens: number | undefined, call: Call) {
  return outputTokens !== undefined && outputTokens >= CAPS[call]
}

export const SYSTEM = [
  'You are a research worker. You read web search results and pages, and you report what they say.',
  'Write plain, simple English in short sentences. Never use em dashes or en dashes. Never use the word "ship".',
  'Use only the sources you are given. Never invent a number, date, name or quote.',
].join(' ')

// Said to every writer: the brief keeps what the sources hedge, and never upgrades a claim.
export const CAVEATS =
  'Keep each source\'s own caveats and limits. Never state a claim more strongly than its source does. Say who measured a number: a vendor testing its own product is "the vendor\'s own test", never "controlled" or "independent" unless the source says so. Say when a number comes from one source only.'

// Plain text: no em or en dashes, never the banned word.
export function clean(raw: string, max: number) {
  return raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\bship(s|ped|ping)?\b/gi, 'publish')
    .trim()
    .slice(0, max)
}

export function oneLine(raw: string, max: number) {
  return clean(raw.replace(/\s+/g, ' '), max)
}

export function urlsIn(text: string) {
  const out: string[] = []
  for (const m of text.matchAll(/https?:\/\/[^\s)\]"'<>,|]+/g)) {
    const u = m[0].replace(/[.;:]+$/, '')
    if (!out.includes(u)) out.push(u)
  }
  return out
}

export function cleanQueries(raw: unknown[]) {
  return raw
    .map(q => String(q ?? ''))
    // Strip quotes only around the whole line: a query can start with a quoted phrase.
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim().replace(/^(["'])(.*)\1$/, '$2').trim())
    .filter(l => l.length > 2)
}

// ---- plan: quick or deep, the queries and the parts ------------------------------------------------------------

export function planFallback(question: string, forceDeep: boolean): Plan {
  return { mode: forceDeep ? 'deep' : 'quick', queries: [oneLine(question, 200)], parts: forceDeep ? [oneLine(question, 400)] : [], since: null, official: [] }
}

export function planPrompt(question: string, forceDeep: boolean, today: string) {
  return [
    `Today is ${today}.`,
    `Research request: ${question}`,
    '',
    forceDeep
      ? 'This request is deep: split it into 2 to 4 separate lines of research.'
      : 'Decide how big it is. "quick": one or two web searches answer it. "deep": it needs 2 to 4 separate lines of research, for example several products, a broad survey, or a comparison across many angles.',
    `Write ${MAX_QUERIES} short web search queries, under 12 words each, that would find the best sources. If the request names a time window, such as "last 7 days", put the month and year in the queries.`,
    'Prefer official sources. For a product, that is its own changelog, release notes, docs or GitHub releases page; for Claude Code, its docs changelog and https://github.com/anthropics/claude-code/releases. Put up to 2 such page URLs in "official", only URLs you are sure exist, else [].',
    'Set "since" to the first day of the time window the request names, as YYYY-MM-DD, counted back from today. With no window, "since" is null.',
    'For deep, also write 2 to 4 self-contained sub-questions, one per line of research. For quick, parts is [].',
    'Answer with JSON only, in this form:',
    '{"mode":"quick","queries":["...","..."],"parts":[],"official":[],"since":null}',
  ].join('\n')
}

// Throws when the answer has no JSON; the caller falls back to planFallback.
export function parsePlan(text: string, question: string, forceDeep: boolean, today: string): Plan {
  const fallback = planFallback(question, forceDeep)
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error('the planner gave no JSON')
  const data = JSON.parse(json) as { mode?: unknown; queries?: unknown; parts?: unknown; official?: unknown; since?: unknown }
  const queries = cleanQueries(Array.isArray(data.queries) ? data.queries : []).slice(0, MAX_QUERIES).map(q => oneLine(q, 200))
  const parts = cleanQueries(Array.isArray(data.parts) ? data.parts : []).slice(0, MAX_PARTS).map(p => oneLine(p, 400))
  const mode = forceDeep || (data.mode === 'deep' && parts.length >= MIN_PARTS) ? 'deep' : 'quick'
  const official = (Array.isArray(data.official) ? data.official : [])
    .map(u => String(u ?? '').trim())
    .filter(u => /^https:\/\/[^\s]+$/.test(u))
    .slice(0, 2)
  const since = typeof data.since === 'string' && /^20\d\d-\d\d-\d\d$/.test(data.since) && data.since <= today ? data.since : null
  return {
    mode,
    queries: queries.length ? queries : fallback.queries,
    parts: mode === 'deep' ? (parts.length ? parts : fallback.parts) : [],
    since,
    official,
  }
}

// ---- relevant: which read pages are about the request ----------------------------------------------------------

export function relevantPrompt(question: string, read: readonly Source[], since: string | null, today: string) {
  return [
    `Today is ${today}.`,
    `Research request: ${question}`,
    since ? `The request covers ${since} to ${today}.` : '',
    '',
    'Pages found for it, numbered, each with its first lines:',
    read.map((s, i) => `[${i + 1}] ${s.title} (${s.url})${s.newest ? `, newest date ${s.newest}` : ''}\n${s.text.slice(0, 600)}`).join('\n\n'),
    '',
    'Which pages to keep: a page stays only if it is about the subject of the request itself, not a different product or project with a similar name.',
    since ? 'With a time window, a page stays only if it holds something from inside the window.' : '',
    'Answer with this JSON and nothing else: {"keep":[1,2],"why":"one short line"}',
  ]
    .filter(l => l !== '')
    .join('\n')
}

// The 1-based numbers to keep, and the reason. Throws when there is no JSON or no list; the caller keeps every page.
export function parseKeep(text: string): { keep: Set<number>; why: string | undefined } {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) throw new Error('the relevance check gave no JSON')
  const data = JSON.parse(json) as { keep?: unknown; why?: unknown }
  if (!Array.isArray(data.keep)) throw new Error('the relevance check gave no "keep" list')
  return { keep: new Set(data.keep.map(Number)), why: typeof data.why === 'string' ? data.why : undefined }
}

// ---- writeUp: the quick-mode brief and notes -------------------------------------------------------------------

export function writeUpPrompt(question: string, sources: readonly Source[], notes: readonly string[], today: string, since: string | null) {
  let room = ALL_CHARS
  const take = (s: string) => {
    const body = s.slice(0, Math.max(0, Math.min(PAGE_CHARS, room)))
    room -= body.length
    return body
  }
  const blocks = sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.text ? take(s.text) : '(page not read; only the search engine listed it)'}`)
  const background = notes.map(n => take(n)).filter(Boolean)
  return [
    `Today is ${today}.${since ? ` The question covers ${since} to ${today}: leave out anything dated before ${since}, and say so if little falls inside it.` : ''}`,
    `Question: ${question}`,
    '',
    'Sources, numbered:',
    blocks.join('\n\n---\n\n') || '(none: no page was about the question)',
    '',
    'Search engine notes (background only, no number of their own; a claim from them takes the number of the source it names, else no number):',
    background.join('\n\n---\n\n') || '(none)',
    '',
    'Write two parts.',
    'BRIEF: at most 180 words. Lead with the direct answer. Put [n] after each claim, n being the source number. Say plainly what the sources do not settle.',
    CAVEATS,
    'NOTES: detailed notes for a later reader, source by source: the facts, numbers, dates and short quotes that bear on the question, each with its [n]. At most 900 words.',
    'If the sources do not answer the question, say so in the brief.',
    'Answer in exactly this form and nothing else:',
    '<brief>...</brief>',
    '<notes>...</notes>',
  ].join('\n')
}

export function parseWriteUp(text: string) {
  const brief = /<brief>([\s\S]*?)<\/brief>/i.exec(text)?.[1] ?? text.slice(0, 1200)
  const more = /<notes>([\s\S]*?)<\/notes>/i.exec(text)?.[1] ?? text
  return { brief: clean(brief, 1600), notes: clean(more, 12_000) }
}

// ---- join: the deep-mode brief from the workers' reports -------------------------------------------------------

export function joinPrompt(question: string, sources: readonly Link[], reports: readonly string[], failed: readonly string[]) {
  return [
    `Question: ${question}`,
    '',
    'Sources, numbered:',
    sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})`).join('\n') || '(none)',
    '',
    'Reports from the research workers, already using those numbers:',
    reports.join('\n\n---\n\n').slice(0, ALL_CHARS),
    '',
    failed.length ? `These parts failed and have no report: ${failed.join('; ')}` : '',
    'Write one BRIEF: at most 200 words. Lead with the direct answer. Keep the [n] after each claim. Say plainly what the reports do not settle, and name any part that failed.',
    CAVEATS,
    'Answer in exactly this form and nothing else:',
    '<brief>...</brief>',
  ].join('\n')
}

export function parseJoin(text: string) {
  return clean(/<brief>([\s\S]*?)<\/brief>/i.exec(text)?.[1] ?? text.slice(0, 1400), 1800)
}

// ---- shorten: auto mode, a WebSearch result's commentary -------------------------------------------------------

export function shortenPrompt(query: string, commentary: string) {
  return [
    `Search query: ${query}`,
    '',
    "Below is a web search tool's commentary on its results. Shorten it to the findings that matter for the query.",
    'Keep every number, name, date and URL that bears on the query, each finding next to its URL. Short bullets. At most 250 words. No preamble.',
    '',
    'Commentary:',
    commentary.slice(0, ALL_CHARS),
  ].join('\n')
}
