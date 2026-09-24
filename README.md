# Minecraft Storage Planner

A configurable storage map with draggable chests, shared staging, item search, and editable floors. The prepared eight-floor layout is included.

## Use

Open `docs/index.html` directly in a modern browser. The app is self-contained and works offline.

- Select a chest to see its contents. **Edit** changes its name and contents; **Delete** removes it.
- **+ Chest** creates a chest in staging. Clicking an empty position creates one there.
- Search **Add items** for Java 26.1 items, or choose **Add custom** for modded items and other labels. Each item name can be edited or removed. There are no per-item slot allocations.
- Drag chests between positions and staging. Dropping onto an occupied position swaps the two chests. **Move** also lets you click a destination or move between floors.
- **+ Floor** adds a floor. **Edit floor** renames it and selects its walls. Each wall holds three 3×3 squares. Removing a wall or floor moves its chests into shared staging.
- **Undo / Redo** applies to moves, chest edits, and floor changes.
- **Export** saves all floors, chests, item names and identifiers, placements, staging, and physical neighbor information as JSON. **Import** restores it. Exports from earlier versions are supported.

Changes save in the current browser. They are not uploaded to GitHub and do not sync between devices. Export a backup before moving to a different browser or address, or clearing browser data. An exported JSON file can be given to Codex for further changes.

Chest positions use **T / M / B** for top, middle, and bottom. Bottom chests face the center of the map. Column 1 is on your left when standing in the center and facing a wall. Stable floor and chest identifiers are preserved when names change.

## Develop

Requires Node.js 20 or later; no dependencies are needed.

```sh
npm test
npm run build
```

`src/engine.js` handles validation, migration, physical neighbors, and immutable layout operations. `src/app.js` handles rendering, movement, history, search, and persistence. `src/editor.js` handles chest and floor forms. The HTML template and styles are in `src/page.html` and `src/style.css`.

The build reads `data/default-layout.json` and the item catalog and produces the complete offline app at `docs/index.html`. Rebuild and commit that file after changing the source or data.

## GitHub Pages

In repository **Settings → Pages**, choose **Deploy from a branch**, branch **main**, folder **/docs**, and save. Private repositories require a GitHub plan that supports private-repository Pages. The published Pages site may still be publicly accessible; repository privacy and site visibility are separate settings.

## Item data

The bundled 1,506-item Java 26.1 catalog is from [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/26.1/items.json). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and the snapshot identifier. Custom entries are supported independently of this catalog.
