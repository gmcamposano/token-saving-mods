# Instalar token-saving-mods (10 mods)

Requisito: Claude Code 2.1.287+ (probado en 2.1.326). Funciona en macOS y Linux.

Opcionales (los mods funcionan sin ellos):
- input-router lee PDFs si hay `pdftotext` (macOS `brew install poppler`, Linux `apt install poppler-utils`).
- research-router usa Firecrawl si `firecrawl` está instalado (npm).
- efficient-browser-use reduce imágenes con `sips` (macOS); en Linux puede no reducirlas.

## Pasos

1. Descomprime y mueve la carpeta. **La ruta debe contener `/.claude/`** (si no, los mods no cargan):

   ```
   mkdir -p ~/.claude/local-marketplaces
   unzip ~/Downloads/token-saving-mods-*.zip -d ~/.claude/local-marketplaces/
   ```

2. En Claude Code:

   ```
   /plugin marketplace add ~/.claude/local-marketplaces/token-saving-mods
   ```

3. Instala cada mod:

   ```
   /plugin install input-router@token-saving-mods
   /plugin install effort-optimizer@token-saving-mods
   /plugin install model-router@token-saving-mods
   /plugin install cache-clock@token-saving-mods
   /plugin install handoff@token-saving-mods
   /plugin install research-router@token-saving-mods
   /plugin install efficient-browser-use@token-saving-mods
   /plugin install mods@token-saving-mods
   /plugin install savings-proof@token-saving-mods
   /plugin install check-filter@token-saving-mods
   ```

4. `/reload-plugins` (o reinicia Claude Code).

5. Verifica: `/mods` abre el panel con los 10 mods; `/savings` abre el panel de ahorro.

6. Solo para el mantenedor del repo (si solo instalas los mods, omite este paso): copia `extras/CLAUDE-global-regla.md` dentro de `~/.claude/CLAUDE.md` (Claude preguntará si sube cada cambio a GitHub).

## Instalar desde GitHub (recomendado, igual en todas tus máquinas)

En lugar de los pasos 1-2, clona el repo en la misma ruta y agrégalo como marketplace local:

```
git clone https://github.com/gmcamposano/token-saving-mods ~/.claude/local-marketplaces/token-saving-mods
```
```
/plugin marketplace add ~/.claude/local-marketplaces/token-saving-mods
```

Así cada máquina tiene un clon editable. Si mantienes el repo, la regla de `extras/CLAUDE-global-regla.md` (paso 6) hace que Claude pregunte si subes los cambios.
Para traer cambios de otra máquina: `git -C ~/.claude/local-marketplaces/token-saving-mods pull`,
luego `claude plugin marketplace update token-saving-mods` y reinicia.

## Actualizar desde un zip nuevo

Ver `UPDATE.md`.

## Problemas

- `marketplace add` no encuentra la carpeta → la ruta debe apuntar a la carpeta que contiene `.claude-plugin/`.
- Un mod falla → apágalo en `/mods`; los demás siguen.
