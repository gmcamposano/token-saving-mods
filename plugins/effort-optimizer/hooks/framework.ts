// The pure part of the effort pick: the judge's prompt, reading its answer, the cap and the floor.
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

// Ben's framework from the effort levels video (four questions, stop at the first yes), tuned for Opus 5.5:
// medium is its default and matches older models at high, so high needs a hidden, costly mistake.
export function pickPrompt(text: string, lastReply: string, now: Level | '') {
  return `You pick the effort level an AI assistant (Claude) should use for one prompt. Effort sets how much time, reading and checking Claude spends, and how many decisions it makes alone. It is not how smart Claude is.

Medium is the default. On Claude Opus 5.5, medium matches older models at high, so most work belongs here. Leave medium only when one of the questions below is clearly yes. Ask them in this order and stop at the first yes:

1. Will the person go back and forth with Claude on this, or is it a small task done in a step or two with little reading? Then low.
   Examples: brainstorming options, quick rewrites (friendlier, shorter), sorting or tagging items, short summaries, rough first drafts or outlines, small tweaks to something already made, simple questions, a one-line rename.
   Not low: anything that needs reading code or documents first, finding a bug's cause, writing a full document, or changing several files. That is medium.
2. Is the main job judging or checking something where a mistake would stay hidden and cost money, a client, trust or a wrong decision, with no tests or set path to catch it? Then high.
   Examples: reviewing a contract for risk, reconciling or checking numbers across sources (a difference nobody can explain yet), fact-checking, open-ended analysis with no set path (why did churn go up), a security or permissions audit, a migration that moves real production data, a final review of a risky change right before it goes live.
3. Is the person handing off a long, hard and critical job and walking away, with no time to answer questions? All three must be true. Then xhigh.
   Examples: a full research report from a year of calls and tickets, reviewing a 50 page agreement before signing, an investor pitch deck as the best one shot. Answer max only when the prompt asks for the deepest possible work and says it is critical; otherwise xhigh.
4. Everything else is medium. This includes everyday coding: features, bug fixes, refactors, writing tests, explaining code, reviewing or fixing config, scripts and tools. Also everyday writing, repurposing content, meeting summaries with decisions and next steps, standard reports in a set format, quick research before a call. If you are not sure, medium.

Words like review, verify, check or fix do not make a task high by themselves; what matters is a costly mistake nothing else would catch. Working in a money, tax or legal domain does not make ordinary coding high: tests and the person's review catch its mistakes. A task being long does not make it high. Rule-following work stays low or medium.
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

// A bare approval or "go on" (yes, ok, dale, option 2): the judge's rule says keep, so no Haiku call is made.
// Every word must be in this list; anything else ("sí, pero cambia X") still goes to the judge.
const GO_ON = new Set(
  (
    'y yes yeah yep yup ok okay k go ahead on continue proceed do it sure sounds good lgtm approved next option please thanks ' +
    'sí si dale vale listo adelante sigue seguir continúa continua continuar hazlo perfecto de acuerdo procede opción opcion ' +
    'la el correcto exacto bien muy gracias porfa por favor va'
  ).split(' '),
)

export function isGoOn(text: string) {
  const words = text.toLowerCase().split(/[\s,.!¡?¿:;)(]+/).filter(Boolean)
  return words.length > 0 && words.length <= 5 && words.every(w => GO_ON.has(w) || /^\d{1,2}$/.test(w))
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

// The cap's mirror: a minimum level, set with /effort-optimizer min, medium by default. On Opus 5.5 low skips
// reading and checking, and a "yes, do it" after a low pick keeps running at low (no judge call for go-ons).
// So the judge may only raise or keep from the minimum; a level set below it by hand is kept, one this mod set
// (held on requests, or put in the effort setting) is raised to the minimum.
export const FLOOR_LEVELS = ['low', 'medium', 'high'] as const
export type Floor = (typeof FLOOR_LEVELS)[number]
export const DEFAULT_FLOOR: Floor = 'medium'
export const FLOOR_WHY = 'kept at the minimum effort set for this mod'

export function below(a: Level, b: Level) {
  return LEVELS.indexOf(a) < LEVELS.indexOf(b)
}

export function asFloor(v: unknown): Floor | '' {
  const l = asLevel(v)
  return (FLOOR_LEVELS as readonly string[]).includes(l) ? (l as Floor) : ''
}

export function floorPick(p: Pick, now: Level | '', min: Floor, nowByMod = false): Pick {
  if (!below(p.level, min)) return p
  if (now && below(now, min) && !nowByMod) return { level: now, why: p.why }
  return { level: min, why: FLOOR_WHY }
}
