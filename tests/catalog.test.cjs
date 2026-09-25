const {
    test
} = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../src/engine.js');
const Catalog = require('../src/catalog.js');
const prepared = new Catalog(require('../data/items.json')).hydrate_template(require('../config/default-layout.json'));
const legacy = require('../data/legacy-preset.json');
const catalog = new Catalog(require('../data/items.json'));
const old_preset = () => ({
    ...Layout.validate(prepared),
    schemaVersion: 4,
    chests: prepared.chests.map(c => ({
        ...c,
        label: legacy[c.id].label,
        items: legacy[c.id].names.map(name => ({
            name,
            itemId: ''
        }))
    }))
});
test('every prepared item uses the catalog name and registry ID', () => {
    for (const chest of prepared.chests) {
        for (const item of chest.items) {
            assert.ok(catalog.by_id.has(item.itemId), `${chest.id}: ${item.itemId}`);
            assert.deepEqual(item, catalog.by_id.get(item.itemId));
        }
    }

    assert.equal(prepared.chests.length, 659);
    assert.equal(prepared.chests.filter(c => !c.items.length).length, 0);
});
test('aliases and broad categories resolve to real items without inventing unsupported items', () => {
    assert.deepEqual(catalog.resolve_legacy('oak chest boat'), [{
        name: 'Oak Boat with Chest',
        itemId: 'minecraft:oak_chest_boat'
    }]);
    assert.equal(catalog.resolve_legacy('map')[0].itemId, 'minecraft:filled_map');
    assert.equal(catalog.resolve_legacy('empty map')[0].itemId, 'minecraft:map');
    assert.equal(catalog.resolve_legacy('gold tools').length, 6);
    assert.equal(catalog.resolve_legacy('leather armor').length, 4);
    assert.equal(catalog.resolve_legacy('music disc 13')[0].itemId, 'minecraft:music_disc_13');
    assert.deepEqual(catalog.resolve_legacy('Music Disc'), []);
    assert.deepEqual(catalog.resolve_legacy('poplar log'), []);
    assert.deepEqual(catalog.resolve_legacy('white wool stairs'), []);
});
test('old preset contents are repaired while moves and user labels survive', () => {
    let doc = Layout.validate(old_preset());
    const id = doc.chests[0].id;
    doc = Layout.move(doc, id, null);
    doc = Layout.saveChest(doc, {
        ...doc.chests[0],
        label: 'My renamed chest'
    });
    const repaired = Layout.validate(catalog.repair_preset(doc, legacy));
    assert.deepEqual(repaired.placements, doc.placements);
    assert.deepEqual(repaired.staging, doc.staging);
    assert.equal(repaired.chests[0].label, 'My renamed chest');
    for (const chest of repaired.chests) {
        const resolved = legacy[chest.id].names.flatMap(name => catalog.resolve_legacy(name));
        const expected = [...new Map(resolved.map(item => [item.itemId, item])).values()];
        assert.deepEqual(chest.items, expected);
    }
});
test('migration preserves manual custom entries, aliases and user-created chests', () => {
    let doc = Layout.validate(old_preset());
    const c = doc.chests.find(c => c.items.some(i => i.name === 'oak log'));
    const items = [...c.items, {
        name: 'Modded drawer',
        itemId: ''
    }, {
        name: 'My oak label',
        itemId: 'minecraft:oak_log'
    }];
    doc = Layout.saveChest(doc, {
        ...c,
        items
    });
    doc = Layout.saveChest(doc, {
        id: 'user-chest',
        label: 'Mine',
        items: [{
            name: 'poplar log',
            itemId: 'mod:poplar_log'
        }]
    });
    const repaired = catalog.repair_preset(doc, legacy);
    const contents = repaired.chests.find(x => x.id === c.id).items;
    assert.ok(contents.some(i => i.itemId === 'minecraft:oak_log' && i.name === 'Oak Log'));
    assert.deepEqual(contents.slice(-2), items.slice(-2));
    assert.deepEqual(repaired.chests.at(-1), doc.chests.at(-1));
});
test('the template groups rare collections and preserves complete bulk modules', () => {
    const contains = id => prepared.chests.filter(chest => chest.items.some(item => item.itemId === id));
    for (const id of ['cobblestone', 'sand', 'dirt']) {
        const chests = contains('minecraft:' + id);
        assert.equal(chests.length, 9, id);
        const chest_ids = new Set(chests.map(chest => chest.id));
        const modules = new Set(Object.entries(prepared.placements).filter(([, chest_id]) => chest_ids.has(chest_id)).map(([slot]) => slot.split('-')[0]));
        assert.equal(modules.size, 1, id);
    }

    for (const [pattern, count] of [[/^minecraft:music_disc_/, 21], [/_armor_trim_smithing_template$/, 18], [/^minecraft:(?:.*_head|.*_skull)$/, 6]]) {
        const collections = prepared.chests.filter(chest => chest.items.some(item => pattern.test(item.itemId)));
        assert.equal(collections.length, 1);
        assert.equal(collections[0].items.length, count);
    }

    assert.equal(contains('minecraft:purpur_block').length, 1);
    assert.equal(contains('minecraft:potion').length, 1);
});
