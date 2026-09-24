# Working on this project

- Use `npm test` and `npm run build`. There are no build dependencies.
- Commit `docs/index.html` with source changes; it is the GitHub Pages and offline artifact.
- Preserve the prepared layout unless a layout change is requested. Stable chest identities must survive moves and imports.
- Keep every chest exactly once: in one floor position or staging. Removing walls or floors stages their chests.
- Coordinates are wall-facing T/M/B; bottom chests face the center and column 1 is facing-left. Keep physical neighbor data consistent.
- Keep the UI concise. Do not restore route arrows, starting points, seeded controls, or per-item slot allocations.
- The repository is private. Do not change its visibility or purchase a hosting plan without the owner's explicit approval.
