# token-saving-mods

Mods de Claude Code para gastar menos tokens sin perder calidad. Repo privado de uso personal.

## Agradecimiento

Este pack nace de la inspiración y el trabajo de **Ben AI** ([YouTube @BenAI92](https://www.youtube.com/@BenAI92) · [benai.co](https://www.benai.co)).
La mayoría de los mods son suyos o parten de sus ideas; aquí solo están adaptados a mi flujo (Linux, Rails).
Gracias, Ben, por compartir tanto y tan bien explicado.

`model-router` es la copia de BenAI del Jev Model Router de [claude-code-templates](https://github.com/davila7/claude-code-templates) (MIT).

## Mods

| Mod | Versión | Qué hace | Origen |
| --- | --- | --- | --- |
| `input-router` | 0.5.0 | Haiku lee primero los archivos grandes y resultados de conectores; Claude recibe notas cortas y la ruta al original. Panel lateral en vivo. `/input-router full` deja pasar el siguiente completo. | Ben AI |
| `effort-optimizer` | 0.2.4 | Elige el nivel de esfuerzo de cada prompt con el marco de cuatro preguntas de Ben y ofrece cambiarlo (o lo cambia solo en modo auto). | Ben AI |
| `model-router` | 0.8.0 | Haiku clasifica cada tarea de subagente y la baja a un modelo más barato solo si su confianza ≥ `minDowngradeConfidence`. Registra el ahorro estimado. Nunca cambia el modelo del chat principal. | claude-code-templates (MIT), cambios de Ben AI |
| `cache-clock` | 0.3.2 | Cuenta regresiva hasta que el caché del prompt se enfría; ofrece handoff en chats grandes y "keep warm" en segundo plano. | Ben AI |
| `handoff` | 0.1.0 | A los 250k tokens ofrece Refresh: resume el chat completo y lo copia o abre un chat nuevo con él. | Ben AI |
| `research-router` | 0.4.1 | Saca la investigación web del chat principal: Haiku acorta resultados grandes y `/research-router` delega la lectura de páginas y devuelve un brief con fuentes. | Ben AI |
| `efficient-browser-use` | 0.3.1 | Reduce cada screenshot del navegador (sips en macOS, Pillow en el resto). `/efficient-browser full` deja pasar uno a tamaño completo. | Ben AI |
| `mods` | 0.2.0 | Panel que detecta todos los mods, los activa o desactiva y abre los de panel lateral. | Ben AI |
| `savings-proof` | 0.2.0 | `/savings` abre el panel con los tokens ahorrados por los demás mods, hoy y en este chat. | Ben AI |
| `check-filter` | 0.2.1 | La salida larga de tests y linters (`rails test`, `rubocop`, `i18n-tasks`, `bundle-audit`, `brakeman`) llega como fallos exactos + resumen; el log completo queda en un archivo. Determinista, sin Haiku. | Propio |
| `prompt-coach` | 0.3.0 | Linter de prompts sin tokens: pregunta antes de enviar un prompt corto de tarea cara sin detalle (deploy, migrar, borrar…); avisos por relleno tipo "think hard", criterios de "hecho" ausentes y números de gráficos tecleados a mano; avisa si este repo tiene cambios sin subir o commits nuevos en GitHub. | Propio |

## Instalar

Requiere acceso a este repo y credencial git para github.com (`gh auth login` y luego `gh auth setup-git`).

```
git clone https://github.com/gmcamposano/token-saving-mods ~/.claude/local-marketplaces/token-saving-mods
/plugin marketplace add ~/.claude/local-marketplaces/token-saving-mods
/plugin install prompt-coach@token-saving-mods
```

Repite `/plugin install <mod>@token-saving-mods` para cada mod de la tabla (detalles en `INSTALL.md`).

## Actualizar

```
git -C ~/.claude/local-marketplaces/token-saving-mods pull
claude plugin marketplace update token-saving-mods
```

Luego reinicia Claude Code. Antes de actualizar, `UPDATE.md` tiene un prompt para que Claude revise los cambios.

## Otras guías

- Configuración global de Claude Code (CLAUDE.md, settings, guía de memoria por proyecto): repo `gmcamposano/claude-config`.
- `NOTES.md`: parches de Linux y gotchas de desarrollo de los mods. Léelo antes de tocar un mod.
