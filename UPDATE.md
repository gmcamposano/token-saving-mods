# Actualizar con ayuda de Claude

Descomprime el zip nuevo en `~/Downloads/token-saving-mods-nuevo/` y pega este prompt en Claude Code:

> Compara `~/Downloads/token-saving-mods-nuevo/token-saving-mods` con
> `~/.claude/local-marketplaces/token-saving-mods` (ignora carpetas `types/`).
> Resume en una tabla qué mods son nuevos, cuáles cambiaron (versión y qué hace el cambio) y cuáles
> desaparecieron. Avísame si algo toca red, credenciales o archivos fuera de `~/.claude`.
> Si lo apruebo: reemplaza la carpeta instalada, corre `claude plugin validate` en cada mod,
> `claude plugin marketplace update token-saving-mods`, instala los mods nuevos, y dime que reinicie.
> Listo cuando todos validan y `/mods` muestra la lista esperada. No toques otra configuración.
