/** Searchable item registry and compatibility with older layout exports. */
class ItemCatalog {
    constructor(entries) {
        this.by_id = new Map();
        this.by_name = new Map();
        this.by_display_name = new Map();
        this.entries = [];
        for (const entry of entries) {
            const item = {
                name: entry.displayName,
                itemId: 'minecraft:' + entry.name
            };
            this.by_id.set(item.itemId, item);
            this._index_name(this.by_display_name, entry.displayName, item.itemId);
            this._index_name(this.by_name, entry.name, item.itemId);
            this._index_name(this.by_name, entry.displayName, item.itemId);
            this.entries.push({
                ...item,
                search: this.normalize(`${entry.displayName} ${entry.name} ${item.itemId}`)
            });
        }
        this.aliases = this._prepare_aliases();
    }

    normalize(value) {
        return String(value).toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
    }

    _index_name(index, name, item_id) {
        const key = this.normalize(name);
        if (!index.has(key)) {
            index.set(key, new Set());
        }
        index.get(key).add(item_id);
    }

    _prepare_aliases() {
        const aliases = {
            potions: ['potion'],
            'splash potions': ['splash_potion'],
            'lingering potions': ['lingering_potion'],
            'tipped arrows': ['tipped_arrow'],
            'dry grass': ['short_dry_grass', 'tall_dry_grass'],
            'netherite upgrade template': ['netherite_upgrade_smithing_template'],
            'lapis lazuli block': ['lapis_block'],
            'target block': ['target']
        };
        for (const material of ['gold', 'copper', 'iron', 'leather']) {
            const prefix = material === 'gold' ? 'golden' : material;
            aliases[material + ' armor'] = ['helmet', 'chestplate', 'leggings', 'boots'].map(piece => prefix + '_' + piece);
            if (material !== 'leather') {
                aliases[material + ' tools'] = ['axe', 'pickaxe', 'shovel', 'hoe', 'sword', 'spear'].map(piece => prefix + '_' + piece);
            }
        }
        return aliases;
    }

    /** Resolve historical labels without guessing ambiguous or modded types. */
    resolve_legacy(name) {
        const key = this.normalize(name);
        const display_matches = this.by_display_name.get(key);
        const matches = display_matches?.size === 1 ? display_matches : this.by_name.get(key);
        const item_ids = this.aliases[key]?.map(id => 'minecraft:' + id) || (matches?.size === 1 ? [...matches] : []);
        return item_ids.map(item_id => {
            const item = this.by_id.get(item_id);
            if (!item) {
                throw new Error(`Unknown catalog item: ${item_id}`);
            }
            return {
                ...item
            };
        });
    }

    /** Match display names and registry IDs, ranking exact names first. */
    search(query) {
        const normalized = this.normalize(query);
        if (!normalized) {
            return [];
        }
        const words = normalized.split(/\s+/);
        const rank = item => {
            const name = this.normalize(item.name);
            return name === normalized ? 0 : name.startsWith(normalized) ? 1 : 2;
        };
        return this.entries.filter(item => words.every(word => item.search.includes(word))).sort((first, second) => rank(first) - rank(second) || first.itemId.localeCompare(second.itemId));
    }

    /** Templates refer to IDs; display names always come from the current registry. */
    hydrate_template(template) {
        return {
            ...template,
            chests: template.chests.map(chest => ({
                ...chest,
                items: chest.items.map(item_id => {
                    const item = this.by_id.get(item_id);
                    if (!item) {
                        throw new Error(`The template uses an unavailable item: ${item_id}`);
                    }
                    return {
                        ...item
                    };
                })
            }))
        };
    }

    /** Repair untouched legacy contents while preserving custom edits and positions. */
    repair_preset(layout, legacy) {
        return {
            ...layout,
            chests: layout.chests.map(chest => {
                const previous = legacy[chest.id];
                if (!previous) {
                    return chest;
                }
                const untouched = chest.items.length === previous.names.length && chest.items.every((item, index) => !item.itemId && item.name === previous.names[index]);
                if (untouched) {
                    const resolved = previous.names.flatMap(name => this.resolve_legacy(name));
                    const items = [...new Map(resolved.map(item => [item.itemId, item])).values()];
                    return {
                        ...chest,
                        label: !items.length && chest.label === previous.label ? 'Unassigned' : chest.label,
                        family: items.length ? chest.family : '',
                        role: items.length ? chest.role : '',
                        items
                    };
                }
                return {
                    ...chest,
                    items: chest.items.flatMap(item => {
                        if (item.itemId || !previous.names.includes(item.name)) {
                            return [item];
                        }
                        const resolved = this.resolve_legacy(item.name);
                        return resolved.length ? resolved : [item];
                    })
                };
            })
        };
    }
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ItemCatalog;
}
