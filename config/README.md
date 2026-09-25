# Application configuration

`app.json` contains application defaults, data paths, persistence keys, and the fingerprints of unchanged historical templates that can be safely upgraded. Edited user layouts never match these fingerprints.

`default-layout.json` defines the prepared floors, modules, chests, and placements. Chest contents are arrays of `minecraft:` item IDs. `ItemCatalog.hydrate_template()` resolves their names from the generated registry. User exports include both IDs and editable labels instead.

Keep configuration separate from the generated files in `data/`. Catalog updates must not automatically assign new items to chests or rearrange the template.
