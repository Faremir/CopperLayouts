# CopperLayouts

A configurable Minecraft storage map with draggable chests and floors, shared staging, item search, and an editable eight-floor template.

[Open CopperLayouts](https://faremir.github.io/CopperLayouts/)

## Use

- Select a chest to see its contents. **Edit** changes its name and items; **Delete** removes it.
- **+ Chest**, above staging, creates a chest there. Clicking an empty position creates one directly in that position.
- Search **Add items** by display name or registry ID. **Add custom** supports modded items and other labels. Names remain editable.
- Drag chests between positions and staging. Dropping onto an occupied position swaps the chests. **Move** also supports clicking a destination or moving between floors.
- **+ Floor** and **Edit floor** sit beside the floor title. Each wall has its own number of 3×3 modules: `0` leaves it open, and `1–1,000` creates that many modules. The layout supports 10,000 modules in total. Long walls scroll independently. Shrinking or removing a floor stages its affected chests.
- Drag floor tabs to reorder them. Floor numbers and chest coordinates then follow the new order, starting at `0` and increasing. Chest identities and contents stay intact. Focus a floor tab and use **Alt + Left/Right** for keyboard reordering.
- **Clear** removes every floor, chest, and staged item after confirmation.
- **Undo / Redo** covers moves, editing, reordering, imports, and Clear until the page is reloaded.
- **Export / Import** saves and restores the complete layout, including item IDs, custom names, placements, staging, and physical neighbors. Earlier exports are supported.

Changes save in the current browser. Export a backup to move between devices or before clearing browser data. Personal layouts are never sent to GitHub.

Positions use **T / M / B** for top, middle, and bottom. Bottom chests face the center. Column 1 is on your left when standing inside and facing a wall.

## Default template

The template contains 659 chests in 81 modules, with 70 empty positions for expansion. Cobblestone, sand, and dirt each retain a complete 3×3 module. The compact endgame floor uses five modules: End materials and travel, diamond equipment, netherite equipment, End storage and finds, and collections. Music discs, armor trims, heads, pottery sherds, and banner patterns each share a collection chest. Alchemy uses one chest per assigned item category instead of repeating whole modules.

Exact, unchanged older presets upgrade automatically. Edited layouts keep their contents and arrangement. To deliberately load the new template into an existing layout, import [`docs/default-layout.json`](docs/default-layout.json); Undo remains available afterward.

## Develop

Requires Node.js 20 or later. There are no build dependencies. These package scripts also work with `bun run`.

```sh
npm test
npm run build
npm run update:items
```

Application files use four-space indentation, descriptive methods, and small classes for stateful responsibilities:

- `PlannerApplication`: layout state, rendering, history, movement, and floor ordering.
- `LayoutEditor`: chest and floor drafts, catalog selection, and form submission.
- `ItemCatalog`: registry lookup, template resolution, search, and legacy item repair.
- `ApplicationData`: independent loading of configuration and data.
- `ItemCatalogUpdater`: upstream version selection, validation, and generated catalog files.

`src/engine.js` keeps layout validation and immutable operations as pure functions. Formatting defaults are in `.editorconfig`.

## Configuration and generated data

| File | Purpose |
| --- | --- |
| `config/app.json` | Application defaults, persistence keys, data paths, and template migration fingerprints |
| `config/default-layout.json` | Floors, chests, placements, and item registry IDs; no copied catalog names |
| `data/items.json` | Generated PrismarineJS item registry |
| `data/items.meta.json` | Minecraft version, upstream revision, source URL, count, and checksum |
| `data/legacy-preset.json` | Historical labels used to repair old exports without overwriting custom entries |

The website loads separate JSON, JavaScript, and CSS files. The build also creates `docs/offline.html`, a self-contained copy that can be opened directly from disk. The regular `docs/index.html` requires HTTP; for local development, serve `docs` with any static server.

Rebuild and commit all generated files under `docs` after source or configuration changes.

## Automatic item updates

The **Update item catalog** GitHub Actions workflow runs daily at 05:23 UTC and can be started manually from the Actions tab. It selects the latest stable Java version available in PrismarineJS, resolves shared data paths, pins a single upstream revision, and validates the complete download. It changes only generated catalog data and rebuilt catalog assets; the default layout is maintained separately.

Snapshots and pre-releases are skipped. A registry that removes a template item fails validation and leaves the published catalog intact. An unchanged registry produces no commit. Successful changes are tested, built, committed, and followed by an explicit Pages rebuild. The workflow uses GitHub's built-in token; no additional secret is needed.

## GitHub Pages

Repository **Settings → Pages** uses **Deploy from a branch**, branch **main**, folder **/docs**. No custom domain is required.

## Attribution

The item registry comes from [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data). The bundled version and exact source revision are recorded in `data/items.meta.json`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
