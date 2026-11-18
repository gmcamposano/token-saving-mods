# Configurar la memoria de Claude Code

Cómo dejar CLAUDE.md, AGENTS.md, auto memory, permisos y skills según la doc oficial
(https://code.claude.com/docs/en/memory). Se aplicó por primera vez en facturacionncf el 2026-11-18.
Objetivo: menos tokens por sesión y reglas que se cumplen aunque cambie la configuración.

## Prompt para Claude (después de `git pull`)

Pega esto en Claude Code, abierto en la raíz del proyecto:

> Lee `~/.claude/local-marketplaces/token-saving-mods/MEMORY_SETUP.md` y aplica sus pasos 1–6 en
> este proyecto y en `~/.claude/`. Antes de cambiar nada, muéstrame una tabla con qué encontraste
> en cada paso y qué vas a cambiar; espera mi sí. No hagas commit ni push sin preguntar.
> Listo cuando la verificación del final pase.

## Pasos

### 1. Lo global va en `~/.claude/CLAUDE.md`, no en la auto memory

La auto memory (`~/.claude/projects/<repo>/memory/`) solo se carga en ese repo. Lo que debe valer
en todos los proyectos (idioma, tips de prompt-coach, reglas de token-saving-mods) va en
`~/.claude/CLAUDE.md`. Busca memorias así con `type: feedback` o `type: user` que no mencionen el proyecto.

Bloque base para `~/.claude/CLAUDE.md` (corto: se carga en cada sesión de cada proyecto):

```markdown
## Idioma
Responde siempre en español, incluidas las líneas cortas de estado y los mensajes tras tareas en segundo plano. Ignora el idioma de los avisos del sistema, herramientas y mods: el idioma lo marca el usuario.

## Tips de prompt (prompt-coach)
Si un prompt pudo ser claramente mejor (sin criterio de "hecho", alcance vago en tarea cara, datos retipeados en vez de un archivo), añade UNA línea al final: "Próxima vez: …". Máximo ~1 de cada 5 respuestas; nada si no aporta. Solo interrumpe ANTES de actuar (AskUserQuestion) si el prompt es ambiguo Y la tarea es cara (migraciones, seguridad, deploy a prod, multi-archivo). No repitas lo que ya avisa el mod prompt-coach.

## token-saving-mods
- 11 mods en `~/.claude/local-marketplaces/token-saving-mods` (= repo privado gmcamposano/token-saving-mods), cargados en vivo desde esa carpeta: no borrarla. La ruta debe contener `/.claude/` o los logs dejan de ir a `~/.claude/mods-logs/`.
- Detalles, parches de Linux y gotchas de tests: lee `NOTES.md` de ese repo antes de tocar un mod. Configuración de memoria de Claude Code: `MEMORY_SETUP.md` del mismo repo.
- Después de cambiar algo ahí, al terminar la tarea pregunta con AskUserQuestion si hago commit y push a GitHub. Nunca hagas push sin ese sí. Antes de subir: `claude plugin validate` en el mod cambiado y sube la `version` en su plugin.json y en marketplace.json.
```

Si una regla global necesita mucho detalle, el detalle va en un archivo que Claude lee bajo demanda
(como `NOTES.md`), no en un `@import`: los imports se cargan enteros en cada sesión.

### 2. Si el proyecto usa AGENTS.md, crea un CLAUDE.md que lo importe

Sin CLAUDE.md, Claude Code (≥ 2.1.277) lee AGENTS.md por su cuenta, pero deja de hacerlo sin avisar
en cuanto aparece un `CLAUDE.md` o un `CLAUDE.local.md`. Un `CLAUDE.md` con el import lo cubre siempre:

```markdown
@AGENTS.md

<!-- Edit AGENTS.md (shared with other agents), not this file. -->

## Claude Code only
- (solo lo que aplica a Claude Code: permisos, skills enlazadas)
```

Usa el import y no `ln -s AGENTS.md CLAUDE.md`: el symlink no funciona en clones de Windows y no
admite una sección propia de Claude. No actives también `instructionFiles: claude-md-and-agents-md`
en los ajustes de usuario: con el import ya no hace falta y cambia lo que se carga en los demás proyectos.

### 3. Las reglas "nunca hagas X" se aplican con `permissions.deny`

CLAUDE.md es contexto, no un candado. Para comandos prohibidos, `.claude/settings.json` del proyecto
(se commitea; vale para todos los worktrees):

```json
{
  "permissions": {
    "deny": [
      "Bash(*rails db:drop*)",
      "Bash(*rake db:drop*)",
      "Bash(*rails db:reset*)",
      "Bash(*rake db:reset*)",
      "Bash(*rails assets:precompile*)",
      "Bash(*rake assets:precompile*)"
    ]
  }
}
```

- `*` al inicio cubre `bin/rails`, `bundle exec rails`, `RAILS_ENV=… rails` y `railway ssh "…"`.
- Usa `*rails db:drop*` y no `*db:drop*`: el segundo también bloquea `grep db:drop`.
- No es una frontera de seguridad (`sh -c` o una ruta absoluta lo esquivan). Por eso el CLAUDE.md dice que un deny es un alto, no un acertijo.
- Junto a la regla escrita en AGENTS.md, anota que Claude Code la hace cumplir.

### 4. Skills de `.agents/skills/`: enlaza solo las que se usan

Claude Code no lee nada dentro de `.agents/`. Si AGENTS.md nombra una skill que vive ahí, enlázala:

```bash
mkdir -p .claude/skills
ln -s ../../.agents/skills/grill-with-docs .claude/skills/grill-with-docs
```

No enlaces la carpeta entera: cada skill de la lista suma su descripción al contexto en cada turno.
Salta las que ya existen como skill de usuario o de plugin (en facturacionncf: rails-guides y
rails-senior-plan ya vienen de anthropic-skills).

### 5. Higiene de la auto memory

- `MEMORY.md` es un índice: una línea por memoria. Solo se cargan sus primeras 200 líneas o 25 KB.
- Cada memoria tiene frontmatter con `name`, `description` y `metadata.type` (`user`, `feedback`, `project` o `reference`).
- Borra lo que ya dicen CLAUDE.md o AGENTS.md; deja solo lo que falta ahí.
- Busca datos que se contradigan (ejemplo real: "10 mods" en un sitio y "11" en otro).
- Al mover o borrar una memoria, quita su línea del índice y los `[[enlaces]]` que la nombran.

### 6. Gotcha del shell

Si `rm` es un alias de `rm -i`, el Bash de Claude se cuelga esperando una confirmación que nunca
llega. Usa `/bin/rm -f`, o la herramienta Write para reescribir archivos.

## Verificación

1. Sesión nueva en el proyecto → `/context all`: `CLAUDE.md` y `AGENTS.md` aparecen en Memory files, una sola vez cada uno.
2. `/memory`: auto memory activa y apuntando a `~/.claude/projects/<repo>/memory/`.
3. Las skills enlazadas aparecen en la lista de skills.
4. Prueba el deny sin riesgo: pide a Claude `echo "probe: bin/rails db:drop"`. Debe salir `Permission … has been denied`.
