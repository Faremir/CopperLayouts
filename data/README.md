# Catalog data

`items.json` is generated from the latest stable Java item catalog available in PrismarineJS. `items.meta.json` records its Minecraft version, pinned upstream commit, source URL, record count, and SHA-256 checksum of the generated file.

Run `npm run update:items` to refresh these two files. The scheduled GitHub Actions workflow runs the same updater. It never edits the layout configuration.

`legacy-preset.json` contains historical chest labels and item names for old browser saves and JSON imports. It is compatibility data, not the current template.

The application settings and prepared arrangement are under `config/`. Template contents refer to registry IDs; display names are resolved from `items.json` when the template is loaded.
