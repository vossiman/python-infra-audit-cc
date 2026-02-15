# Changelog

## 1.0.0 (2025-02-15)

Initial release.

- `/infra:audit` — Audit Python project infrastructure against blueprint
- `/infra:update` — Self-update command
- Background update checker (SessionStart hook)
- Selective file install (preserves other files in `commands/infra/`)
- Additive `settings.json` merge (coexists with GSD and other skills)
- Local patch backup on update
- SHA256 file manifest for modification detection
- `--global` (default) and `--local` install modes
- `--uninstall` for clean removal
