# Regla opcional para acompañar a prompt-coach

Pega esto en `~/.claude/CLAUDE.md` (global) o en el CLAUDE.md/AGENTS.md del proyecto:

```
## Prompt coaching
Cuando un prompt claramente pudo ser mejor (sin criterio de terminado, alcance vago en tarea cara,
datos retecleados en vez de archivo), agrega UNA línea al final de la respuesta: "Próxima vez: …".
Máximo ~1 de cada 5 respuestas. No repitas lo que ya avisa el mod prompt-coach.
Interrumpe ANTES de actuar solo si el prompt es ambiguo Y la tarea es cara (migraciones, seguridad,
deploy a prod, cambios en varios archivos).
```
