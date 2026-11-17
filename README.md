# token-saving-mods

11 mods de Claude Code para gastar menos tokens sin perder calidad: input-router, effort-optimizer,
model-router, cache-clock, handoff, research-router, efficient-browser-use, mods, savings-proof,
check-filter y prompt-coach. Repo privado de uso personal.

## Instalar

Requiere acceso a este repo y credencial git para github.com (`gh auth login` y luego `gh auth setup-git`).

```
/plugin marketplace add gmcamposano/token-saving-mods
/plugin install prompt-coach@token-saving-mods
```

Repite `/plugin install <mod>@token-saving-mods` para cada mod (lista completa en `INSTALL.md`).

## Actualizar

```
claude plugin marketplace update token-saving-mods
```

Luego reinicia Claude Code. Antes de actualizar, `UPDATE.md` tiene un prompt para que Claude revise los cambios.
