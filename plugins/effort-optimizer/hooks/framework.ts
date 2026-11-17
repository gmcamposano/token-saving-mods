// The pure part of the effort pick: the judge's prompt, reading its answer and the cap.
// No JSX and no engine calls, so register.tsx, the tests and evals/judge-eval.ts share one copy.
import type { Level } from '../types'

export type Pick = { level: Level; why: string }

export const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']

// Picking a level is classification: Anthropic's model guide puts that on Haiku.
export const JUDGE_MODEL = 'haiku'
export const JUDGE_EFFORT = 'low'
export const JUDGE_MAX_TOKENS = 120

// "Extra high", "x-high" and "xhigh" all read as xhigh.
export function norm(s: string) {
  const t = s.toLowerCase().replace(/[^a-z]/g, '')
  if (t === 'extrahigh' || t === 'xhigh') return 'xhigh'
  return t
}

export function asLevel(v: unknown): Level | '' {
  if (typeof v !== 'string') return ''
  const t = norm(v)
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : ''
}

// Plain text: no em or en dashes, never the banned word, one short line.
export function cleanWhy(raw: string) {
  const r = raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\bship(s|ped|ping)?\b/gi, 'publish')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`\s]+|["'`\s.]+$/g, '')
  return r.slice(0, 90)
}

// Ben's framework from the effort levels video: four questions, stop at the first yes.
export function pickPrompt(text: string, lastReply: string, now: Level | '') {
  return `You pick the effort level an AI assistant (Claude) should use for one prompt. Effort sets how much time, reading and checking Claude spends, and how many decisions it makes alone. It is not how smart Claude is.

Ask these four questions in this order and stop at the first yes:

1. Will the person go back and forth with Claude on this, or is it a simple task? Then low.
   Examples: brainstorming options, quick rewrites (friendlier, shorter), sorting or tagging items, short summaries, rough first drafts or outlines, small tweaks to something already made, simple questions.
2. Would a hidden mistake cost money, a client, trust or a wrong decision? Then high.
   Examples: checking numbers across sources, open-ended analysis with no set path (why did churn go up), reviewing a contract for risk, fact-checking, going through long documents, verifying and testing work made at a lower level, building or fixing a skill.
3. Is the person handing off a long, hard and critical job and walking away, with no time to answer questions? All three must be true. Then xhigh.
   Examples: a full research report from a year of calls and tickets, reviewing a 50 page agreement before signing, an investor pitch deck as the best one shot. Answer max only when the prompt asks for the deepest possible work and says it is critical; otherwise xhigh.
4. Everything else is medium: everyday writing, repurposing content, meeting summaries with decisions and next steps, standard reports in a set format, quick research before a call. If you are not sure, medium.

A task being long does not make it high. Rule-following work stays low or medium.
If the prompt only approves, answers a question, or says to go on with earlier work (yes, go, ok, do it, option 2), answer keep.

The chat runs at: ${now || 'unknown'}

Claude's last reply (first 600 characters, for context):
<reply>
${lastReply || '(none, this is the first prompt)'}
</reply>

The new prompt:
<prompt>
${text}
</prompt>

Reply with JSON only: {"level": "low|medium|high|xhigh|max|keep", "why": "the reason in under 12 plain words"}`
}

export function parsePick(text: string): Pick | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { level?: unknown; why?: unknown }
    const level = asLevel(j.level)
    if (!level) return null
    return { level, why: cleanWhy(typeof j.why === 'string' ? j.why : '') }
  } catch {
    return null
  }
}

// Anthropic's model guide (2026-11): on Opus 5.5, xhigh scored about 1.4 points over high at 2.5x the cost,
// and a self-check or Fable 5.2 at medium beats it on cost per task. So the mod never raises past high;
// a level already set past high by hand is kept.
export const CAP_WHY = 'hard and critical: give Claude a test to check, or try Fable at medium'

export function capPick(p: Pick, now: Level | ''): Pick {
  if (p.level !== 'xhigh' && p.level !== 'max') return p
  if (now === 'xhigh' || now === 'max') return { level: now, why: p.why }
  return { level: 'high', why: CAP_WHY }
}
