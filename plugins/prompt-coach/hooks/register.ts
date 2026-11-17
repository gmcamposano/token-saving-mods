import type { Register } from 'claude-code'

// Zero-token prompt linter: toasts only the user sees. Nothing reaches the model.
type Rule = { id: string; test: (t: string) => boolean; tip: string }

const THINK = /\b(think (hard|harder|carefully|deeply)|ultrathink|piensa (bien|mucho|con cuidado|profundamente)|razona (bien|con cuidado))\b/i
const TASK = /\b(implementa|crea|haz|construye|refactoriza|migra|agrega|añade|arregla|build|implement|create|refactor|migrate|add|fix)\b/i
const DONE = /\b(listo cuando|terminado cuando|hasta que|criterio|tests?|pruebas?|done when|until|stop (and|to) ask|para(r|te) y pregunta|entregable|sin preguntar)\b/i

const RULES: Rule[] = [
  {
    id: 'think',
    test: t => THINK.test(t),
    tip: 'prompt-coach: quita "think hard/piensa bien" — el razonamiento ya está activo; solo añade latencia.',
  },
  {
    id: 'done',
    test: t => t.length > 280 && TASK.test(t) && !DONE.test(t),
    tip: 'prompt-coach: tarea larga sin criterio de terminado. Di qué es "listo" y cuándo parar a preguntar.',
  },
  {
    id: 'numbers',
    test: t => (t.match(/^[^\n]*\d[\d.,%$ \t|-]{6,}\d[^\n]*$/gm) ?? []).length >= 5,
    tip: 'prompt-coach: ¿números copiados de un gráfico/tabla? Adjunta la captura o el archivo.',
  },
]

const COOLDOWN = 5 // prompts between repeats of the same tip

export const register: Register = on => {
  let n = 0
  const lastShown = new Map<string, number>()

  on('prompt.submit', ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    if (e.origin && e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    n += 1
    // Ignore pasted material: only the user's own words count.
    const own = e.text.replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, '').trim()
    if (!own || own.startsWith('/')) return next(e)
    const hit = RULES.find(r => r.test(own) && n - (lastShown.get(r.id) ?? -COOLDOWN) >= COOLDOWN)
    if (hit) {
      lastShown.set(hit.id, n)
      $.ui.toast(hit.tip)
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
