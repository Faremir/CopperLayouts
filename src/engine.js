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
