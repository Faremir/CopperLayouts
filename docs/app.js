'use strict';

const get_element = id => document.getElementById(id);
const escape_html = value => String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
})[ch]);
const normalize = value => String(value).toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');

/* Pure layout operations. A chest identity never depends on its current slot. */
const Layout = (() => {
    const FORMAT = 'minecraft-storage-layout';
    const ROWS = 'TMB';
    const REVISION = 'v17-copper-layouts';
    const MAX_MODULES_PER_WALL = 1000;
    const MAX_MODULES = 10000;
    const COORDINATE_SYSTEM = 'wall-facing-tmb';
    const slots_of = square => Array.from({
        length: 9
    }, (_, i) => `${square.id}-${ROWS[Math.floor(i / 3)]}${i % 3 + 1}`);
    // Readable text remains upright; only the positions of the nine tiles rotate.
    // Column 1 is the leftmost column when standing inside and facing that wall.
    const wall_order = {
        T: ['T1', 'T2', 'T3', 'M1', 'M2', 'M3', 'B1', 'B2', 'B3'],
        R: ['B1', 'M1', 'T1', 'B2', 'M2', 'T2', 'B3', 'M3', 'T3'],
        B: ['B3', 'B2', 'B1', 'M3', 'M2', 'M1', 'T3', 'T2', 'T1'],
        L: ['T3', 'M3', 'B3', 'T2', 'M2', 'B2', 'T1', 'M1', 'B1']
    };
    const display_slots_of = square => wall_order[square.wall].map(position => `${square.id}-${position}`);
    const canonical_slot = id => typeof id === 'string' ? id.replace(/^(F\d+[TRBL][1-9]\d*-)([UD])([1-3])$/, (all, base, row, col) => base + (row === 'U' ? 'T' : 'B') + col) : id;
    const fail = message => {
        throw new Error(message);
    };
    const is_object = value => value && typeof value === 'object' && !Array.isArray(value);
    const string = (value, name, max = 300, optional = false) => {
        if (optional && (value === undefined || value === null)) {
            return '';
        }
        if (typeof value !== 'string' || !optional && !value.trim() || value.length > max) {
            fail(`Invalid ${name}.`);
        }
        return value;
    };
    const unique = (list, name) => {
        if (new Set(list).size !== list.length) {
            fail(`Duplicate ${name}.`);
        }
    };
    function migrate_legacy(raw) {
        if (!is_object(raw.placements) || !Array.isArray(raw.chests)) {
            fail('Placements or prepared chests are missing.');
        }
        const placements = {};
        for (const [old_slot, chest_id] of Object.entries(raw.placements)) {
            if (!/^F\d+[TRBL][1-9]\d*-[UMD][1-3]$/.test(old_slot)) {
                fail('Invalid legacy chest position.');
            }
            placements[canonical_slot(old_slot)] = chest_id;
        }
        // Opaque chest identities and staged chests stay intact across coordinate changes.
        return {
            ...raw,
            schemaVersion: 2,
            coordinateSystem: COORDINATE_SYSTEM,
            revision: REVISION,
            placements,
            chests: raw.chests.map(c => is_object(c) ? {
                ...c,
                sourceSlot: canonical_slot(c.sourceSlot)
            } : c)
        };
    }

    function validate(raw) {
        if (!is_object(raw) || raw.format !== FORMAT || ![1, 2, 3, 4].includes(raw.schemaVersion)) {
            fail('This is not a supported storage layout export.');
        }
        if (raw.schemaVersion === 1) {
            raw = migrate_legacy(raw);
        }
        if (raw.coordinateSystem !== COORDINATE_SYSTEM) {
            fail('Unsupported chest coordinate system.');
        }
        if (!Array.isArray(raw.floors) || raw.floors.length > 100) {
            fail('Invalid floor list.');
        }
        if (!Array.isArray(raw.squares) || raw.squares.length > MAX_MODULES) {
            fail(`A layout can contain up to ${MAX_MODULES.toLocaleString()} modules.`);
        }
        if (!Array.isArray(raw.chests) || raw.chests.length > 20000) {
            fail('Invalid chest list.');
        }
        if (!is_object(raw.placements) || !Array.isArray(raw.staging)) {
            fail('Placements or staging are missing.');
        }
        const floors = raw.floors.map(f => {
            if (!is_object(f) || !Number.isInteger(f.id) || f.id < 0 || f.id > 9999) {
                fail('Invalid floor.');
            }
            const walls = raw.schemaVersion < 3 ? ['T', 'R', 'B', 'L'].filter(w => raw.squares.some(s => s?.floor === f.id && s.wall === w)) : f.walls;
            if (!Array.isArray(walls) || walls.length < 1 || walls.length > 4 || walls.some(w => !['T', 'R', 'B', 'L'].includes(w))) {
                fail('Choose at least one wall.');
            }
            unique(walls, 'wall');
            const module_counts = {
                T: 0,
                R: 0,
                B: 0,
                L: 0
            };
            if (raw.schemaVersion === 4 && f.moduleCounts !== undefined && !is_object(f.moduleCounts)) {
                fail('Invalid wall module counts.');
            }
            if (raw.schemaVersion === 4 && Object.values(f.moduleCounts || {}).some(count => !Number.isSafeInteger(count) || count < 0 || count > MAX_MODULES_PER_WALL)) {
                fail(`Wall module counts must be whole numbers from 0 to ${MAX_MODULES_PER_WALL.toLocaleString()}.`);
            }
            for (const wall of walls) {
                const count = raw.schemaVersion < 4 ? 3 : f.moduleCounts?.[wall] ?? 3;
                if (!Number.isSafeInteger(count) || count < 1 || count > MAX_MODULES_PER_WALL) {
                    fail(`Each wall must have 1–${MAX_MODULES_PER_WALL.toLocaleString()} modules.`);
                }
                module_counts[wall] = count;
            }
            return {
                id: f.id,
                name: string(f.name, 'floor name'),
                shortName: string(f.shortName || f.name, 'floor label'),
                walls,
                moduleCounts: module_counts
            };
        });
        unique(floors.map(f => f.id), 'floor');
        const floor_definitions = new Map(floors.map(f => [f.id, f]));
        const squares = raw.squares.map(s => {
            if (!is_object(s) || !floor_definitions.has(s.floor) || !['T', 'R', 'B', 'L'].includes(s.wall) || !Number.isSafeInteger(s.section) || s.section < 1 || s.section > floor_definitions.get(s.floor).moduleCounts[s.wall] || s.id !== `F${s.floor}${s.wall}${s.section}`) {
                fail('Invalid 3×3 square.');
            }
            return {
                id: s.id,
                floor: s.floor,
                wall: s.wall,
                section: s.section
            };
        });
        unique(squares.map(s => s.id), 'square');
        for (const floor of floors) {
            const ids = new Set(squares.filter(s => s.floor === floor.id).map(s => s.id));
            const expected = squares_for_floor(floor).map(s => s.id);
            if (ids.size !== expected.length || expected.some(id => !ids.has(id))) {
                fail(`Wall structure does not match floor ${floor.id}.`);
            }
        }
        const chests = raw.chests.map(c => {
            if (!is_object(c) || typeof c.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(c.id) || !Array.isArray(c.items) || c.items.length > 20000) {
                fail('Invalid chest.');
            }
            const items = c.items.map(item => {
                if (!is_object(item)) {
                    fail(`Invalid item in ${c.id}.`);
                }
                return {
                    name: string(item.name, 'item name', 500),
                    itemId: string(item.itemId, 'item identifier', 300, true)
                };
            });
            return {
                id: c.id,
                label: string(c.label, 'chest label'),
                family: string(c.family, 'family', 300, true),
                role: string(c.role, 'role', 300, true),
                items,
                sourceSlot: string(c.sourceSlot, 'original position', 120, true),
                sourceGroup: string(c.sourceGroup, 'original group', 300, true)
            };
        });
        unique(chests.map(c => c.id), 'chest identity');
        const chest_ids = new Set(chests.map(c => c.id));
        const slot_ids = new Set(squares.flatMap(slots_of));
        const used = new Set();
        const record = id => {
            if (!chest_ids.has(id)) {
                fail('A placement references an unknown chest.');
            }
            if (used.has(id)) {
                fail('A chest is placed more than once.');
            }
            used.add(id);
            return id;
        };
        if (Object.keys(raw.placements).length !== slot_ids.size || Object.keys(raw.placements).some(s => !slot_ids.has(s))) {
            fail('The floor slot list is incomplete or contains unknown positions.');
        }
        const placements = {};
        for (const slot of slot_ids) {
            const id = raw.placements[slot];
            placements[slot] = id === null ? null : record(id);
        }
        const staging = raw.staging.map(record);
        if (used.size !== chest_ids.size) {
            fail('Some chests are missing from both the floors and staging.');
        }
        return {
            format: FORMAT,
            schemaVersion: 4,
            coordinateSystem: COORDINATE_SYSTEM,
            revision: REVISION,
            sourceRevision: string(raw.sourceRevision, 'source revision', 120, true),
            floors,
            squares,
            chests,
            placements,
            staging
        };
    }

    function squares_for_floor(floor) {
        return floor.walls.flatMap(wall => {
            const count = floor.moduleCounts?.[wall] ?? 3;
            if (!Number.isSafeInteger(count) || count < 1 || count > MAX_MODULES_PER_WALL) {
                fail(`Each wall must have 1–${MAX_MODULES_PER_WALL.toLocaleString()} modules.`);
            }
            return Array.from({
                length: count
            }, (_, i) => ({
                id: `F${floor.id}${wall}${i + 1}`,
                floor: floor.id,
                wall,
                section: i + 1
            }));
        });
    }

    function clear(doc) {
        return validate({
            ...doc,
            floors: [],
            squares: [],
            chests: [],
            placements: {},
            staging: []
        });
    }

    function save_chest(doc, chest, target = null) {
        const existing = doc.chests.some(c => c.id === chest.id);
        const chests = existing ? doc.chests.map(c => c.id === chest.id ? chest : c) : [...doc.chests, chest];
        const placements = {
                ...doc.placements
            },
            staging = [...doc.staging];
        if (!existing) {
            if (target !== null) {
                if (!Object.hasOwn(placements, target)) {
                    fail('Unknown destination.');
                }
                if (placements[target] !== null) {
                    fail('This position is already occupied.');
                }
                placements[target] = chest.id;
            } else {
                staging.push(chest.id);
            }
        }
        return validate({
            ...doc,
            chests,
            placements,
            staging
        });
    }

    function delete_chest(doc, id) {
        if (!doc.chests.some(c => c.id === id)) {
            fail('Unknown chest.');
        }
        return {
            ...doc,
            chests: doc.chests.filter(c => c.id !== id),
            placements: Object.fromEntries(Object.entries(doc.placements).map(([s, c]) => [s, c === id ? null : c])),
            staging: doc.staging.filter(c => c !== id)
        };
    }

    function save_floor(doc, floor) {
        const existing = doc.floors.some(f => f.id === floor.id);
        const floors = existing ? doc.floors.map(f => f.id === floor.id ? floor : f) : [...doc.floors, floor];
        const squares = [...doc.squares.filter(s => s.floor !== floor.id), ...squares_for_floor(floor)];
        if (squares.length > MAX_MODULES) {
            fail(`A layout can contain up to ${MAX_MODULES.toLocaleString()} modules.`);
        }
        return reconcile_squares(doc, floors, squares);
    }

    function delete_floor(doc, id) {
        if (!doc.floors.some(f => f.id === id)) {
            fail('Unknown floor.');
        }
        return reconcile_squares(doc, doc.floors.filter(f => f.id !== id), doc.squares.filter(s => s.floor !== id));
    }

    function reorder_floors(doc, ordered_ids) {
        if (ordered_ids.length !== doc.floors.length || new Set(ordered_ids).size !== ordered_ids.length || ordered_ids.some(id => !doc.floors.some(f => f.id === id))) {
            fail('Invalid floor order.');
        }
        const numbers = new Map(ordered_ids.map((id, number) => [id, number]));
        const rename_slot = slot => slot.replace(/^F(\d+)/, (_, id) => 'F' + numbers.get(Number(id)));
        return validate({
            ...doc,
            floors: ordered_ids.map((id, number) => ({
                ...doc.floors.find(f => f.id === id),
                id: number
            })),
            squares: doc.squares.map(s => ({
                ...s,
                id: rename_slot(s.id),
                floor: numbers.get(s.floor)
            })),
            placements: Object.fromEntries(Object.entries(doc.placements).map(([slot, chest]) => [rename_slot(slot), chest]))
        });
    }

    function reconcile_squares(doc, floors, squares) {
        const slots = new Set(squares.flatMap(slots_of));
        const staging = [...doc.staging];
        for (const [slot, chest] of Object.entries(doc.placements)) {
            if (!slots.has(slot) && chest) {
                staging.push(chest);
            }
        }
        const placements = Object.fromEntries([...slots].map(slot => [slot, doc.placements[slot] ?? null]));
        return validate({
            ...doc,
            floors,
            squares,
            placements,
            staging
        });
    }

    function index(doc) {
        const floors = new Map(doc.floors.map(f => [f.id, f]));
        const squares = new Map(doc.squares.map(s => [s.id, s]));
        const chests = new Map(doc.chests.map(c => [c.id, c]));
        const locations = new Map(doc.staging.map(id => [id, null]));
        const slots = new Map();
        const wall_slots = new Map();
        for (const s of doc.squares) {
            slots_of(s).forEach((id, i) => {
                const column = i % 3 + 1;
                // Wall offsets follow map coordinates (north→south / west→east).
                // The left and bottom wall's facing-left column is at the opposite end.
                const wall_column = ['L', 'B'].includes(s.wall) ? 3 - column : column - 1;
                const visual_index = display_slots_of(s).indexOf(id);
                const slot = {
                    id,
                    squareId: s.id,
                    floor: s.floor,
                    wall: s.wall,
                    row: Math.floor(i / 3),
                    column,
                    offset: (s.section - 1) * 3 + wall_column,
                    mapRow: Math.floor(visual_index / 3) + 1,
                    mapColumn: visual_index % 3 + 1
                };
                slots.set(id, slot);
                wall_slots.set(`${s.floor}:${s.wall}:${slot.row}:${slot.offset}`, id);
                const chest_id = doc.placements[id];
                if (chest_id) {
                    locations.set(chest_id, id);
                }
            });
        }
        const at = (f, w, r, o) => wall_slots.get(`${f}:${w}:${r}:${o}`) || null;
        const joins_by_floor = new Map(doc.floors.map(f => {
            const end = wall => f.moduleCounts[wall] * 3 - 1;
            return [f.id, [['T', 0, 'L', 0], ['T', end('T'), 'R', 0], ['B', 0, 'L', end('L')], ['B', end('B'), 'R', end('R')]]];
        }));
        for (const slot of slots.values()) {
            const {
                floor: f,
                wall: w,
                row: r,
                offset: o
            } = slot;
            slot.neighbors = {
                above: at(f, w, r - 1, o),
                below: at(f, w, r + 1, o),
                previousOnWall: at(f, w, r, o - 1),
                nextOnWall: at(f, w, r, o + 1)
            };
            slot.cornerNeighbors = [];
            for (const [wa, oa, wb, ob] of joins_by_floor.get(f)) {
                const other = w === wa && o === oa ? at(f, wb, r, ob) : w === wb && o === ob ? at(f, wa, r, oa) : null;
                if (other) {
                    slot.cornerNeighbors.push(other);
                }
            }
        }
        return {
            floors,
            squares,
            chests,
            slots,
            locations
        };
    }

    function move(doc, chest_id, target) {
        const ix = index(doc);
        if (!ix.chests.has(chest_id) || !ix.locations.has(chest_id)) {
            fail('Unknown chest.');
        }
        if (target !== null && !ix.slots.has(target)) {
            fail('Unknown destination.');
        }
        const source = ix.locations.get(chest_id);
        if (source === target) {
            return doc;
        }
        const placements = {
                ...doc.placements
            },
            staging = [...doc.staging];
        if (target === null) {
            placements[source] = null;
            staging.push(chest_id);
        } else {
            const occupant = placements[target];
            placements[target] = chest_id;
            if (source !== null) {
                placements[source] = occupant;
            } else {
                const position = staging.indexOf(chest_id);
                if (occupant) {
                    staging[position] = occupant;
                } else {
                    staging.splice(position, 1);
                }
            }
        }
        return {
            ...doc,
            placements,
            staging
        };
    }

    function export_document(doc) {
        const ix = index(doc);
        // Neighbor references identify fixed physical slots; occupants reflect every edit.
        return {
            ...doc,
            exportedAt: new Date().toISOString(),
            topology: {
                slots: [...ix.slots.values()].map(s => ({
                    id: s.id,
                    squareId: s.squareId,
                    floor: s.floor,
                    wall: s.wall,
                    row: ROWS[s.row],
                    column: s.column,
                    mapRow: s.mapRow,
                    mapColumn: s.mapColumn,
                    chestId: doc.placements[s.id],
                    neighbors: s.neighbors,
                    cornerNeighbors: s.cornerNeighbors
                }))
            }
        };
    }

    return {
        validate,
        index,
        move,
        exportDocument: export_document,
        slotsOf: slots_of,
        displaySlotsOf: display_slots_of,
        canonicalSlot: canonical_slot,
        saveChest: save_chest,
        deleteChest: delete_chest,
        saveFloor: save_floor,
        deleteFloor: delete_floor,
        reorderFloors: reorder_floors,
        squaresForFloor: squares_for_floor,
        clear,
        MAX_MODULES_PER_WALL,
        MAX_MODULES
    };
})();
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Layout;
}

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

/** Own the current layout, navigation, history, and chest movement. */
class PlannerApplication {
    constructor(options) {
        this.config = options.config;
        this.catalog = new ItemCatalog(options.items);
        this.initial_layout = Layout.validate(this.catalog.hydrate_template(options.template));
        this.legacy_preset = options.legacy;
        this.catalog_metadata = options.metadata;
        this.storage_key = this.config.storage_key;
        this.legacy_storage_keys = this.config.legacy_storage_keys;
        this.layout = Layout.validate(this.initial_layout);
        this.floor = 0;
        this.selected = 'chest-F0L3-U3';
        this.indexes = undefined;
        this.picked = null;
        this.dragged = null;
        this.dragged_floor = null;
        this.drop_highlight = null;
        this.ignore_click_until = 0;
        this.notice_timer = undefined;
        this.undo_stack = [];
        this.redo_stack = [];
        this.wall_scrolls = new Map();
        this.startup_error = '';
        this.migrated_cache = false;
    }

    async initialize() {
        await this._restore_saved_layout();
        this.editor = new LayoutEditor(this);
        this.render();
        this._bind_events();
        this.editor.bind_events();
        get_element('catalogVersion').textContent = 'Java ' + this.catalog_metadata.minecraft_version;
        if (this.startup_error) {
            this.show_error(this.startup_error);
        } else if (this.migrated_cache) {
            this.save();
        }
    }

    async _restore_saved_layout() {
        try {
            const cached = localStorage.getItem(this.storage_key) || this.legacy_storage_keys.map(key => localStorage.getItem(key)).find(Boolean);
            if (cached) {
                const parsed = JSON.parse(cached);
                this.layout = this.read_layout(parsed);
                this.migrated_cache = parsed.schemaVersion < 4;
                if (this.layout.floors.some(f => f.id === parsed.view?.floor)) {
                    this.floor = parsed.view.floor;
                }
                if (this.layout.chests.some(c => c.id === parsed.view?.selected)) {
                    this.selected = parsed.view.selected;
                }
            }
        } catch (error) {
            this.startup_error = 'The saved layout could not be opened. You can import an exported layout.';
        }
        this.indexes = Layout.index(this.layout);
        if (!this.indexes.chests.has(this.selected)) {
            this.selected = this.layout.chests[0]?.id ?? null;
        }
        if (!this.indexes.floors.has(this.floor)) {
            this.floor = this.layout.floors[0]?.id ?? null;
        }
        if (this.layout !== this.initial_layout) {
            const comparison = {
                ...this.layout
            };
            delete comparison.revision;
            delete comparison.sourceRevision;
            const bytes = new TextEncoder().encode(JSON.stringify(comparison));
            const digest = await crypto.subtle.digest('SHA-256', bytes);
            const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            if (this.config.template_upgrade_hashes.includes(hash)) {
                this.layout = this.initial_layout;
                this.migrated_cache = true;
                this.indexes = Layout.index(this.layout);
                if (!this.indexes.chests.has(this.selected)) {
                    this.selected = this.layout.chests[0]?.id ?? null;
                }
            }
        }
    }

    read_layout(raw) {
        if (raw.chests?.some(chest => chest.items?.some(item => typeof item === 'string'))) {
            raw = this.catalog.hydrate_template(raw);
        }
        const validated = Layout.validate(raw);
        return raw.schemaVersion < 4 ? Layout.validate(this.catalog.repair_preset(validated, this.legacy_preset)) : validated;
    }

    notify(message) {
        clearTimeout(this.notice_timer);
        get_element('notice').textContent = message;
        get_element('notice').classList.add('visible');
        this.notice_timer = setTimeout(() => get_element('notice').classList.remove('visible'), 2500);
    }

    show_error(message) {
        get_element('error').textContent = message;
        get_element('error').hidden = !message;
    }

    save() {
        try {
            localStorage.setItem(this.storage_key, JSON.stringify({
                ...this.layout,
                view: {
                    floor: this.floor,
                    selected: this.selected
                }
            }));
            get_element('saveStatus').textContent = 'Saved';
            get_element('saveStatus').classList.remove('unsaved');
            return true;
        } catch (error) {
            get_element('saveStatus').textContent = 'Export to save';
            get_element('saveStatus').classList.add('unsaved');
            this.show_error('This browser cannot save these changes locally. Use Export to keep your layout.');
            return false;
        }
    }

    commit(next, message) {
        if (next === this.layout) {
            return false;
        }
        this.undo_stack.push(this.layout);
        if (this.undo_stack.length > this.config.history_limit) {
            this.undo_stack.shift();
        }
        this.redo_stack = [];
        this.layout = next;
        this.indexes = Layout.index(this.layout);
        if (!this.indexes.floors.has(this.floor)) {
            this.floor = this.layout.floors[0]?.id ?? null;
        }
        if (!this.indexes.chests.has(this.selected)) {
            this.selected = this.layout.chests[0]?.id ?? null;
        }
        this.picked = null;
        this.render();
        this.save();
        if (message) {
            this.notify(message);
        }
        return true;
    }

    undo() {
        if (!this.undo_stack.length) {
            return;
        }
        this.redo_stack.push(this.layout);
        this.layout = this.undo_stack.pop();
        this.restore_history('Undone');
    }

    redo() {
        if (!this.redo_stack.length) {
            return;
        }
        this.undo_stack.push(this.layout);
        this.layout = this.redo_stack.pop();
        this.restore_history('Redone');
    }

    restore_history(message) {
        this.indexes = Layout.index(this.layout);
        if (!this.indexes.floors.has(this.floor)) {
            this.floor = this.layout.floors[0]?.id ?? null;
        }
        if (!this.indexes.chests.has(this.selected)) {
            this.selected = this.layout.chests[0]?.id ?? null;
        }
        this.picked = null;
        this.render();
        this.save();
        this.notify(message);
    }

    move_chest(id, target) {
        const c = this.indexes.chests.get(id);
        if (!c) {
            return;
        }
        const occupant = target ? this.layout.placements[target] : null;
        this.selected = id;
        const message = target === null ? 'Chest moved to staging' : occupant && occupant !== id ? 'Chests swapped' : 'Chest moved';
        try {
            if (!this.commit(Layout.move(this.layout, id, target), message)) {
                this.picked = null;
                this.render();
            }
        } catch (error) {
            this.show_error(error.message);
        }
    }

    chest_color(c) {
        const woods = [['dark oak', '#947960'], ['pale oak', '#dad4b4'], ['oak', '#bb9a64'], ['spruce', '#9b7c54'], ['birch', '#d5ceac'], ['jungle', '#b99370'], ['acacia', '#c28968'], ['mangrove', '#b9756e'], ['cherry', '#dbafb3'], ['poplar', '#c5b876'], ['crimson', '#bb718e'], ['warped', '#69afa3'], ['bamboo', '#b8be6f']];
        const family = c.family.toLowerCase();
        for (const [name, color] of woods) {
            if (family === name || family.startsWith(name + ' ') || family.startsWith(name + ' ·')) {
                return color;
            }
        }
        const colors = {
            'light gray': '#b9bbb4',
            'light blue': '#86b9d3',
            white: '#d9dad0',
            orange: '#cc9763',
            magenta: '#bc7fbd',
            yellow: '#cfbd6a',
            lime: '#9eb667',
            pink: '#d4a0af',
            gray: '#858d91',
            cyan: '#6baaaa',
            purple: '#9f82b8',
            blue: '#7e94bd',
            brown: '#a08972',
            green: '#8caa7b',
            red: '#be7d73',
            black: '#748181'
        };
        for (const [name, color] of Object.entries(colors)) {
            if (normalize(c.label).startsWith(name + ' ')) {
                return color;
            }
        }
        return '#8aab96';
    }

    tile(chest_id, slot_id = null) {
        const pos = slot_id ? slot_id.split('-').at(-1) : 'Staged';
        if (!chest_id) {
            return `<button type="button" id="slot-${slot_id}" class="chest empty" data-slot="${slot_id}" title="${slot_id} · empty" aria-label="${slot_id}, empty slot">
<span class="tile-meta">${pos}</span>
<span class="plus" aria-hidden="true">+</span>
</button>`;
        }
        const c = this.indexes.chests.get(chest_id);
        const label = `${slot_id || 'Staging'}: ${c.label}`;
        const contents = c.items.map(i => i.name).join(', ');
        const count = c.items.length > 1 ? `<span class="tile-count" title="${c.items.length} item types">+${c.items.length - 1}</span>` : '';
        return `<button type="button" ${slot_id ? `id="slot-${slot_id}" data-slot="${slot_id}"` : ''} class="chest ${chest_id === this.selected ? 'selected' : ''} ${chest_id === this.picked ? 'picked' : ''}" data-chest="${escape_html(chest_id)}" draggable="true" style="--chest-color:${this.chest_color(c)}" title="${escape_html(label + '\n' + contents)}" aria-label="${escape_html(label)}" aria-pressed="${chest_id === this.selected}">
<span class="tile-meta">
<span>${pos}</span>${count}</span>
<span class="tile-label">${escape_html(c.label)}</span>
</button>`;
    }

    render_floors() {
        get_element('floors').innerHTML = this.layout.floors.map(f => `<button type="button" data-floor="${f.id}" draggable="true" class="${f.id === this.floor ? 'active' : ''}" aria-current="${f.id === this.floor ? 'page' : 'false'}" title="${escape_html(f.name)} · Drag to reorder, or Alt + Left/Right">
<span class="level">${f.id}</span>${escape_html(f.shortName)}</button>`).join('');
        const f = this.indexes.floors.get(this.floor);
        get_element('floorName').textContent = f ? `Floor ${this.floor} · ${f.name}` : 'No floors';
        get_element('editFloor').hidden = !f;
    }

    render_board() {
        for (const node of document.querySelectorAll('[data-wall-scroll]')) {
            this.wall_scrolls.set(node.dataset.floor + ':' + node.dataset.wallScroll, {
                left: node.scrollLeft,
                top: node.scrollTop
            });
        }
        get_element('map').classList.toggle('empty-map', !this.indexes.floors.has(this.floor));
        const f = this.indexes.floors.get(this.floor);
        const names = {
            T: 'Top',
            R: 'Right',
            B: 'Bottom',
            L: 'Left'
        };
        const walls = f ? ['T', 'R', 'B', 'L'].map(wall => {
            if (!f.walls.includes(wall)) {
                return `<div class="wall-opening wall-${wall}">Open</div>`;
            }
            const squares = this.layout.squares.filter(s => s.floor === this.floor && s.wall === wall).sort((a, b) => a.section - b.section);
            return `<section class="wall-panel wall-${wall}" aria-label="${names[wall]} wall">
<div class="wall-scroll" data-wall-scroll="${wall}" data-floor="${this.floor}" tabindex="0" aria-label="${names[wall]} wall, ${squares.length} modules">
<div class="wall-contents">${squares.map(s => `<section class="square" aria-label="${s.id}">
<div class="square-heading">
<span>${s.id}</span>
</div>
<div class="square-grid">${Layout.displaySlotsOf(s).map(id => this.tile(this.layout.placements[id], id)).join('')}</div>
</section>`).join('')}</div>
</div>
</section>`;
        }).join('') : '';
        get_element('map').innerHTML = walls + `<div class="workspace ${f ? '' : 'without-floor'}">
<section id="inspector" class="inspector" aria-label="Selected chest contents">
</section>
<section class="staging" aria-label="Shared chest staging">
<div class="staging-heading">
<h2>Staging</h2>
<span class="stage-count">${this.layout.staging.length}</span>
<span class="stage-scope">All floors</span>
<button id="newChest" type="button" class="chest-control">+ Chest</button>
</div>
<div id="stagingDrop" class="staging-drop ${this.picked ? 'pick-target' : ''}" tabindex="0" role="group" aria-label="Staging area; drop chests here">${this.layout.staging.length ? this.layout.staging.map(id => this.tile(id)).join('') : '<div class="stage-empty">Drop chests here</div>'}</div>
</section>
</div>`;
        for (const node of document.querySelectorAll('[data-wall-scroll]')) {
            const previous = this.wall_scrolls.get(this.floor + ':' + node.dataset.wallScroll);
            if (previous) {
                node.scrollLeft = previous.left;
                node.scrollTop = previous.top;
            }
        }
        this.render_inspector();
    }

    render_inspector() {
        const c = this.indexes.chests.get(this.selected);
        if (!c) {
            get_element('inspector').innerHTML = `<p class="empty-detail">${this.layout.floors.length ? 'Select or create a chest.' : 'Add a floor or create a chest to start.'}</p>`;
            return;
        }
        const location = this.indexes.locations.get(this.selected);
        const actions = `<div class="inspector-actions">
<button type="button" data-action="edit">Edit</button>
<button type="button" data-action="pick">${this.picked ? 'Cancel move' : 'Move'}</button>${location !== null ? '<button type="button" data-action="stage" title="Move this chest to staging">Stage</button>' : ''}<button type="button" class="danger quiet" data-action="delete">Delete</button>
</div>`;
        const picked_name = this.picked ? this.indexes.chests.get(this.picked)?.label : '';
        get_element('inspector').innerHTML = `<div class="inspector-head">
<div>
<span class="eyebrow">${location || 'Staging'}</span>
<h2>${escape_html(c.label)}</h2>
</div>${actions}</div>${c.items.length ? `<ul class="item-list">${c.items.map(i => `<li title="${escape_html(i.itemId || 'Custom item')}">
<span>${escape_html(i.name)}${i.name === 'Music Disc' && i.itemId ? `<small class="item-variant">${escape_html(i.itemId.replace('minecraft:music_disc_', '').replace(/_/g, ' '))}</small>` : ''}</span>
</li>`).join('')}</ul>` : '<p class="empty-detail">No items yet.</p>'}${this.picked ? `<div class="move-hint">Place ${escape_html(picked_name)} in a slot or staging. Esc to cancel.</div>` : ''}`;
    }

    mark_selection() {
        for (const node of document.querySelectorAll('[data-chest]')) {
            const active = node.dataset.chest === this.selected;
            node.classList.toggle('selected', active);
            node.classList.toggle('picked', node.dataset.chest === this.picked);
            if (node.classList.contains('chest')) {
                node.setAttribute('aria-pressed', String(active));
            }
        }
        document.body.classList.toggle('moving', !!this.picked);
        get_element('stagingDrop')?.classList.toggle('pick-target', !!this.picked);
    }

    render() {
        this.render_floors();
        this.render_board();
        this.mark_selection();
        this.render_search();
        get_element('undo').disabled = !this.undo_stack.length;
        get_element('redo').disabled = !this.redo_stack.length;
        get_element('clearLayout').disabled = !this.layout.floors.length && !this.layout.chests.length;
    }

    select_chest(id, jump = false) {
        if (!this.indexes.chests.has(id)) {
            return;
        }
        this.selected = id;
        const location = this.indexes.locations.get(id);
        const target_floor = location ? this.indexes.slots.get(location).floor : this.floor;
        if (jump && target_floor !== this.floor) {
            this.floor = target_floor;
            this.render();
        } else {
            this.render_inspector();
            this.mark_selection();
        }
        if (jump) {
            const target = location ? get_element('slot-' + location) : get_element('stagingDrop');
            target?.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: 'smooth'
            });
            if (location) {
                target?.focus({
                    preventScroll: true
                });
            }
        }
    }

    set_floor(id) {
        if (!this.indexes.floors.has(id)) {
            return;
        }
        this.floor = id;
        // Keep a picked chest across floor switches; ordinary browsing selects this floor.
        if (!this.picked) {
            const current = this.indexes.locations.get(this.selected);
            if (current && this.indexes.slots.get(current)?.floor !== this.floor) {
                const square = this.layout.squares.find(s => s.floor === this.floor);
                const local = Layout.slotsOf(square).map(s => this.layout.placements[s]).find(Boolean);
                if (local) {
                    this.selected = local;
                }
            }
        }
        this.render();
        this.save();
    }

    matching_chests(query) {
        const words = normalize(query).replace(/(f\d+[trlb][1-9]\d*-)([ud])([1-3])/g, (all, base, row, col) => base + (row === 'u' ? 't' : 'b') + col).trim().split(/\s+/).filter(Boolean);
        if (!words.length) {
            return [];
        }
        return this.layout.chests.filter(c => {
            const location = this.indexes.locations.get(c.id);
            const text = normalize([location || 'staging', c.label, c.family, ...c.items.flatMap(i => [i.name, i.itemId])].join(' '));
            return words.every(word => text.includes(word));
        });
    }

    render_search() {
        const query = get_element('search').value.trim(),
            box = get_element('results');
        const matches = query ? this.matching_chests(query) : [],
            ids = new Set(matches.map(c => c.id));
        box.hidden = !query;
        get_element('search').setAttribute('aria-expanded', String(!!query));
        for (const node of document.querySelectorAll('.chest[data-chest]')) {
            node.classList.toggle('search-dim', !!query && !ids.has(node.dataset.chest));
            node.classList.toggle('search-match', !!query && ids.has(node.dataset.chest));
        }
        box.innerHTML = query ? `<div class="result-count">${matches.length} matching chest${matches.length === 1 ? '' : 's'}${matches.length > 60 ? ' · first 60 shown' : ''}</div>` + matches.slice(0, 60).map(c => {
            const location = this.indexes.locations.get(c.id);
            return `<button type="button" class="result" data-find="${escape_html(c.id)}">
<small>${location || 'Staging'}</small>
<strong>${escape_html(c.label)}</strong>
<span class="result-items">${escape_html(c.items.map(i => i.name).join(', '))}</span>
</button>`;
        }).join('') : '';
    }

    close_search(clear = false) {
        if (clear) {
            get_element('search').value = '';
            this.render_search();
        } else {
            get_element('results').hidden = true;
            get_element('search').setAttribute('aria-expanded', 'false');
        }
    }

    async import_layout(file) {
        if (!file) {
            return;
        }
        try {
            if (file.size > 64 * 1024 * 1024) {
                throw new Error('The file is larger than 64 MB.');
            }
            const next = this.read_layout(JSON.parse(await file.text()));
            this.show_error('');
            this.clear_drag();
            this.commit(next, 'Layout imported');
        } catch (error) {
            this.show_error('Import failed: ' + error.message);
        }
    }

    export_layout() {
        const json = JSON.stringify(Layout.exportDocument(this.layout), null, 2);
        const url = URL.createObjectURL(new Blob([json], {
            type: 'application/json'
        }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'copper-layouts-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.notify('Complete layout exported');
    }

    clear_drag() {
        if (this.drop_highlight) {
            this.drop_highlight.classList.remove('drop-target');
        }
        this.drop_highlight = null;
        this.dragged = null;
        this.dragged_floor = null;
        document.body.classList.remove('is-dragging');
        document.querySelectorAll('.dragging').forEach(n => n.classList.remove('dragging'));
    }

    reorder_floor(target_id, after = false) {
        if (this.dragged_floor === null || this.dragged_floor === target_id) {
            return;
        }
        const order = this.layout.floors.map(f => f.id).filter(id => id !== this.dragged_floor);
        order.splice(order.indexOf(target_id) + (after ? 1 : 0), 0, this.dragged_floor);
        this.floor = order.indexOf(this.floor);
        const next = Layout.reorderFloors(this.layout, order);
        this.clear_drag();
        this.commit(next, 'Floor order updated');
    }

    drop_target(event) {
        return event.target.closest('[data-slot]') || event.target.closest('#stagingDrop');
    }

    _bind_events() {
        document.addEventListener('dragstart', event => {
            const floor_button = event.target.closest('button[data-floor]');
            if (floor_button) {
                this.dragged_floor = Number(floor_button.dataset.floor);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-copper-layout-floor', String(this.dragged_floor));
                floor_button.classList.add('dragging');
                return;
            }
            const node = event.target.closest('.chest[data-chest]');
            if (!node) {
                return;
            }
            this.dragged = node.dataset.chest;
            this.selected = this.dragged;
            this.picked = null;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-minecraft-storage-chest', this.dragged);
            event.dataTransfer.setData('text/plain', this.dragged);
            node.classList.add('dragging');
            document.body.classList.add('is-dragging');
            this.render_inspector();
            this.mark_selection();
        });
        document.addEventListener('dragover', event => {
            if (this.dragged_floor !== null) {
                const target = event.target.closest('button[data-floor]');
                this.drop_highlight?.classList.remove('drop-target');
                this.drop_highlight = target;
                target?.classList.add('drop-target');
                if (target) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                }
                return;
            }
            if (!this.dragged) {
                return;
            }
            const target = this.drop_target(event);
            if (this.drop_highlight !== target) {
                this.drop_highlight?.classList.remove('drop-target');
                this.drop_highlight = target;
                target?.classList.add('drop-target');
            }
            if (target) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            }
        });
        document.addEventListener('dragleave', event => {
            if (!event.relatedTarget && this.drop_highlight) {
                this.drop_highlight.classList.remove('drop-target');
                this.drop_highlight = null;
            }
        });
        document.addEventListener('drop', event => {
            if (this.dragged_floor !== null) {
                event.preventDefault();
                const target = event.target.closest('button[data-floor]');
                if (target) {
                    const bounds = target.getBoundingClientRect();
                    this.reorder_floor(Number(target.dataset.floor), event.clientX > bounds.x + bounds.width / 2);
                }
                this.clear_drag();
                this.ignore_click_until = Date.now() + 180;
                return;
            }
            if (!this.dragged) {
                return;
            }
            event.preventDefault();
            const target = this.drop_target(event),
                id = this.dragged;
            this.clear_drag();
            this.ignore_click_until = Date.now() + 180;
            if (target) {
                this.move_chest(id, target.dataset.slot || null);
            }
        });
        document.addEventListener('dragend', () => {
            this.ignore_click_until = Date.now() + 180;
            this.clear_drag();
        });
        document.addEventListener('click', event => {
            if (Date.now() < this.ignore_click_until) {
                return;
            }
            const button = event.target.closest('button');
            if (button?.dataset.floor !== undefined) {
                this.set_floor(Number(button.dataset.floor));
                return;
            }
            if (button?.dataset.find) {
                this.close_search(true);
                this.select_chest(button.dataset.find, true);
                return;
            }
            if (this.picked && event.target.closest('#stagingDrop')) {
                this.move_chest(this.picked, null);
                return;
            }
            if (button?.dataset.slot && this.picked) {
                this.move_chest(this.picked, button.dataset.slot);
                return;
            }
            if (button?.dataset.chest) {
                this.select_chest(button.dataset.chest);
                return;
            }
            if (button?.dataset.slot) {
                this.editor.open_chest_editor(null, button.dataset.slot);
                return;
            }
            if (button?.dataset.action === 'edit') {
                this.editor.open_chest_editor(this.selected);
                return;
            }
            if (button?.dataset.action === 'delete') {
                this.commit(Layout.deleteChest(this.layout, this.selected), 'Chest deleted · Undo to restore');
                return;
            }
            if (button?.dataset.action === 'pick') {
                this.picked = this.picked ? null : this.selected;
                this.render_inspector();
                this.mark_selection();
                return;
            }
            if (button?.dataset.action === 'stage') {
                this.move_chest(this.selected, null);
                return;
            }
            if (!event.target.closest('.search-wrap')) {
                this.close_search();
            }
        });
        get_element('undo').addEventListener('click', event => this.undo(event));
        get_element('redo').addEventListener('click', event => this.redo(event));
        get_element('export').addEventListener('click', event => this.export_layout(event));
        get_element('import').addEventListener('click', () => get_element('importFile').click());
        get_element('importFile').addEventListener('change', event => {
            const file = event.target.files[0];
            event.target.value = '';
            this.import_layout(file);
        });
        get_element('search').addEventListener('input', event => this.render_search(event));
        get_element('search').addEventListener('focus', () => {
            if (get_element('search').value.trim()) {
                this.render_search();
            }
        });
        get_element('search').addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                get_element('results').querySelector('button')?.focus();
            }
            if (event.key === 'Enter') {
                const result = this.matching_chests(get_element('search').value)[0];
                if (result) {
                    event.preventDefault();
                    this.close_search(true);
                    this.select_chest(result.id, true);
                }
            }
        });
        document.addEventListener('keydown', event => {
            if (document.querySelector('dialog[open]')) {
                return;
            }
            if (event.altKey && event.target.matches('button[data-floor]') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                const order = this.layout.floors.map(f => f.id),
                    current = Number(event.target.dataset.floor);
                const target = order[order.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1)];
                if (target !== undefined) {
                    event.preventDefault();
                    this.dragged_floor = current;
                    this.reorder_floor(target, event.key === 'ArrowRight');
                }
                return;
            }
            if (event.key === 'Escape') {
                this.picked = null;
                this.clear_drag();
                this.close_search(true);
                this.render_inspector();
                this.mark_selection();
                return;
            }
            if (event.target.matches('input,textarea,[contenteditable]')) {
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.shiftKey ? this.redo() : this.undo();
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                this.redo();
            }
            if ((event.key === 'Enter' || event.key === ' ') && event.target.id === 'stagingDrop' && this.picked) {
                event.preventDefault();
                this.move_chest(this.picked, null);
            }
        });
    }
}

/** Edit chest and floor drafts; commit changes only after Save. */
class LayoutEditor {
    constructor(app) {
        this.app = app;
        this.chest_draft = null;
        this.chest_target = null;
        this.chest_is_new = false;
        this.floor_draft = null;
        this.floor_is_new = false;
        this.catalog_entries = this.app.catalog.entries;
    }

    open_chest_editor(id = null, target = null) {
        const c = id ? this.app.indexes.chests.get(id) : null;
        if (id && !c) {
            return;
        }
        this.app.picked = null;
        this.app.mark_selection();
        this.app.render_inspector();
        this.chest_draft = c ? structuredClone(c) : {
            id: 'chest-' + crypto.randomUUID(),
            label: 'New chest',
            family: '',
            role: '',
            items: [],
            sourceSlot: '',
            sourceGroup: ''
        };
        this.chest_target = target;
        this.chest_is_new = !c;
        get_element('chestEditorHeading').textContent = c ? 'Edit chest' : 'Create chest';
        get_element('chestName').value = this.chest_draft.label;
        get_element('saveChest').textContent = c ? 'Save chest' : 'Create chest';
        get_element('catalogSearch').value = '';
        get_element('chestEditError').hidden = true;
        this.render_draft_items();
        this.render_catalog();
        get_element('chestEditor').showModal();
        get_element('chestName').focus();
        if (!c) {
            get_element('chestName').select();
        }
    }

    render_draft_items() {
        get_element('draftItemCount').textContent = this.chest_draft.items.length;
        get_element('draftItems').innerHTML = this.chest_draft.items.length ? this.chest_draft.items.map((item, i) => `<div class="draft-item">
<div class="draft-item-field">
<input data-item-name="${i}" aria-label="Item name ${i + 1}" value="${escape_html(item.name)}" required maxlength="500" autocomplete="off">
<small>${escape_html(item.itemId || 'Custom item')}</small>
</div>
<button type="button" class="quiet remove-item" data-remove-item="${i}" aria-label="Remove ${escape_html(item.name)}">✕</button>
</div>`).join('') : '<p class="empty-detail">No items yet.</p>';
    }

    catalog_matches(query) {
        return this.app.catalog.search(query);
    }

    render_catalog() {
        const query = get_element('catalogSearch').value.trim(),
            results = get_element('catalogResults');
        const matches = this.catalog_matches(query);
        results.hidden = !query;
        results.innerHTML = query ? matches.slice(0, 20).map(item => `<button type="button" data-add-item="${escape_html(item.itemId)}">
<span>${escape_html(item.name)}</span>
<small>${escape_html(item.itemId)}</small>
<span aria-hidden="true">＋</span>
</button>`).join('') + `<button type="button" class="custom-item" data-custom-item="true">
<span>Add custom: ${escape_html(query)}</span>
<span aria-hidden="true">＋</span>
</button>` : '';
    }

    add_draft_item(item) {
        this.chest_draft.items.push({
            name: item.name,
            itemId: item.itemId || ''
        });
        this.render_draft_items();
        get_element('draftItems').lastElementChild?.scrollIntoView({
            block: 'nearest'
        });
        get_element('catalogSearch').focus({
            preventScroll: true
        });
    }

    open_floor_editor(id = null) {
        const f = id === null ? null : this.app.indexes.floors.get(id);
        if (id !== null && !f) {
            return;
        }
        this.floor_is_new = !f;
        this.floor_draft = f ? structuredClone(f) : {
            id: Math.max(-1, ...this.app.layout.floors.map(f => f.id)) + 1,
            name: 'New floor',
            shortName: 'New floor',
            walls: ['T', 'R', 'B', 'L'].filter(wall => this.app.config.default_module_counts[wall] > 0),
            moduleCounts: structuredClone(this.app.config.default_module_counts)
        };
        get_element('floorEditorHeading').textContent = f ? 'Edit floor' : 'Create floor';
        get_element('floorTitle').value = this.floor_draft.name;
        for (const input of get_element('floorForm').querySelectorAll('[data-wall-count]')) {
            input.value = this.floor_draft.moduleCounts[input.dataset.wallCount];
        }
        get_element('deleteFloor').hidden = !f;
        get_element('floorEditError').hidden = true;
        get_element('floorEditor').showModal();
        get_element('floorTitle').focus();
        if (!f) {
            get_element('floorTitle').select();
        }
    }

    bind_events() {
        get_element('newFloor').addEventListener('click', () => this.open_floor_editor());
        get_element('editFloor').addEventListener('click', () => this.open_floor_editor(this.app.floor));
        get_element('clearLayout').addEventListener('click', () => get_element('clearEditor').showModal());
        get_element('confirmClear').addEventListener('click', () => {
            get_element('clearEditor').close();
            this.app.clear_drag();
            this.app.close_search(true);
            this.app.commit(Layout.clear(this.app.layout), 'Layout cleared · Undo to restore');
        });
        get_element('catalogSearch').addEventListener('input', event => this.render_catalog(event));
        get_element('catalogSearch').addEventListener('keydown', event => {
            if (event.key === 'Enter' && get_element('catalogSearch').value.trim()) {
                event.preventDefault();
                const first = this.catalog_matches(get_element('catalogSearch').value)[0];
                this.add_draft_item(first || {
                    name: get_element('catalogSearch').value.trim(),
                    itemId: ''
                });
            }
        });
        get_element('draftItems').addEventListener('input', event => {
            if (event.target.dataset.itemName !== undefined) {
                this.chest_draft.items[Number(event.target.dataset.itemName)].name = event.target.value;
            }
        });
        document.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) {
                return;
            }
            if (button.id === 'newChest') {
                this.open_chest_editor();
                return;
            }
            if (button.dataset.close) {
                get_element(button.dataset.close).close();
                return;
            }
            if (button.dataset.removeItem !== undefined) {
                this.chest_draft.items.splice(Number(button.dataset.removeItem), 1);
                this.render_draft_items();
                return;
            }
            if (button.dataset.addItem) {
                const item = this.catalog_entries.find(i => i.itemId === button.dataset.addItem);
                if (item) {
                    this.add_draft_item(item);
                }
                return;
            }
            if (button.dataset.customItem) {
                this.add_draft_item({
                    name: get_element('catalogSearch').value.trim(),
                    itemId: ''
                });
            }
        });
        get_element('chestForm').addEventListener('submit', event => {
            event.preventDefault();
            try {
                const old = this.app.indexes.chests.get(this.chest_draft.id);
                const changed = old && JSON.stringify(old.items) !== JSON.stringify(this.chest_draft.items);
                const next_chest = {
                    ...this.chest_draft,
                    label: get_element('chestName').value.trim(),
                    items: this.chest_draft.items.map(i => ({
                        ...i,
                        name: i.name.trim()
                    })),
                    family: changed ? '' : this.chest_draft.family,
                    role: changed ? '' : this.chest_draft.role
                };
                const next = Layout.saveChest(this.app.layout, next_chest, this.chest_is_new ? this.chest_target : null);
                this.app.selected = next_chest.id;
                get_element('chestEditor').close();
                this.app.commit(next, this.chest_is_new ? 'Chest created' : 'Chest updated');
            } catch (error) {
                get_element('chestEditError').textContent = error.message;
                get_element('chestEditError').hidden = false;
            }
        });
        get_element('floorForm').addEventListener('submit', event => {
            event.preventDefault();
            try {
                const name = get_element('floorTitle').value.trim();
                const module_counts = Object.fromEntries([...get_element('floorForm').querySelectorAll('[data-wall-count]')].map(i => [i.dataset.wallCount, i.valueAsNumber]));
                if (Object.values(module_counts).some(n => !Number.isSafeInteger(n) || n < 0 || n > Layout.MAX_MODULES_PER_WALL)) {
                    throw new Error(`Use a whole number from 0 to ${Layout.MAX_MODULES_PER_WALL.toLocaleString()} for each wall.`);
                }
                const walls = ['T', 'R', 'B', 'L'].filter(w => module_counts[w] > 0);
                const next = Layout.saveFloor(this.app.layout, {
                    ...this.floor_draft,
                    name,
                    shortName: name,
                    walls,
                    moduleCounts: module_counts
                });
                const staged = next.staging.length - this.app.layout.staging.length;
                this.app.floor = this.floor_draft.id;
                get_element('floorEditor').close();
                this.app.commit(next, staged ? `${staged} chests moved to staging` : this.floor_is_new ? 'Floor created' : 'Floor updated');
            } catch (error) {
                get_element('floorEditError').textContent = error.message;
                get_element('floorEditError').hidden = false;
            }
        });
        get_element('deleteFloor').addEventListener('click', () => {
            const next = Layout.deleteFloor(this.app.layout, this.floor_draft.id);
            get_element('floorEditor').close();
            this.app.commit(next, 'Floor removed · its chests are in staging');
        });
    }
}

/** Load application settings, the user template, and the generated registry independently. */
class ApplicationData {
    static async read_json(path) {
        const response = await fetch(new URL(path, document.baseURI), {
            cache: 'no-cache'
        });
        if (!response.ok) {
            throw new Error(`Unable to load ${path} (${response.status}).`);
        }
        return response.json();
    }

    static async load() {
        if (typeof OFFLINE_DATA !== 'undefined') {
            return OFFLINE_DATA;
        }
        const config = await this.read_json('./config.json');
        const [items, metadata, template, legacy] = await Promise.all([this.read_json(config.catalog_path), this.read_json(config.catalog_metadata_path), this.read_json(config.template_path), this.read_json(config.legacy_preset_path)]);
        return {
            config,
            items,
            metadata,
            template,
            legacy
        };
    }
}
ApplicationData.load().then(async options => {
    const application = new PlannerApplication(options);
    await application.initialize();
}).catch(error => {
    const message = document.getElementById('error');
    message.textContent = 'Unable to open the planner. ' + error.message;
    message.hidden = false;
    document.getElementById('saveStatus').textContent = 'Load failed';
});
