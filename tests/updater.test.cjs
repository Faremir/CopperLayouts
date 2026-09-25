const {
    test
} = require('node:test');
const assert = require('node:assert/strict');
const {
    mkdtemp,
    mkdir,
    writeFile: write_file,
    readFile: read_file,
    rm
} = require('node:fs/promises');
const {
    tmpdir
} = require('node:os');
const {
    join
} = require('node:path');
const load_updater = async () => (await import('../scripts/update-items.mjs')).ItemCatalogUpdater;
test('catalog version selection skips previews and uses inherited item paths', async () => {
    const Updater = await load_updater();
    const updater = new Updater();
    assert.deepEqual(updater.select_version({
        pc: {
            '1.21.11': {
                items: 'pc/1.21.11'
            },
            '26.1': {
                items: 'pc/26.1'
            },
            '26.2': {
                items: 'pc/26.1'
            },
            '27.1-pre1': {
                items: 'pc/27.1-pre1'
            },
            '28w01a': {
                items: 'pc/snapshot'
            }
        }
    }), {
        version: '26.2',
        path: 'data/pc/26.1/items.json'
    });
});
test('updates only catalog files and does not rewrite unchanged data', async () => {
    const Updater = await load_updater();
    const root = await mkdtemp(join(tmpdir(), 'copper-catalog-'));
    try {
        await mkdir(join(root, 'config'));
        await mkdir(join(root, 'data'));
        const template = JSON.stringify({
            chests: [{
                items: ['minecraft:oak_log']
            }]
        });
        await write_file(join(root, 'config/default-layout.json'), template);
        const urls = [];
        const request = async url => {
            urls.push(url);
            return {
                ok: true,
                json: async () => {
                    if (url.endsWith('commits/master')) {
                        return {
                            sha: 'a'.repeat(40)
                        };
                    }
                    if (url.endsWith('dataPaths.json')) {
                        return {
                            pc: {
                                '26.1': {
                                    items: 'pc/26.1'
                                }
                            }
                        };
                    }
                    return [{
                        name: 'oak_log',
                        displayName: 'Oak Log'
                    }];
                }
            };
        };
        const updater = new Updater({
            root,
            request
        });
        assert.equal(await updater.update(), true);
        const metadata = await read_file(join(root, 'data/items.meta.json'), 'utf8');
        assert.equal(JSON.parse(metadata).minecraft_version, '26.1');
        assert.ok(urls[1].includes('a'.repeat(40)));
        assert.equal(await updater.update(), false);
        assert.equal(await read_file(join(root, 'data/items.meta.json'), 'utf8'), metadata);
        assert.equal(await read_file(join(root, 'config/default-layout.json'), 'utf8'), template);
        updater.request = async () => ({
            ok: false,
            status: 503
        });
        await assert.rejects(() => updater.update(), /503/);
        assert.equal(await read_file(join(root, 'data/items.meta.json'), 'utf8'), metadata);
    } finally {
        await rm(root, {
            recursive: true,
            force: true
        });
    }
});
test('invalid or incompatible registry updates are rejected', async () => {
    const Updater = await load_updater();
    const updater = new Updater();
    const template = {
        chests: [{
            items: ['minecraft:oak_log']
        }]
    };
    assert.throws(() => updater.validate_items([], template), /empty/);
    assert.throws(() => updater.validate_items([{
        name: 'birch_log',
        displayName: 'Birch Log'
    }], template), /removed item IDs/);
    assert.throws(() => updater.validate_items([{
        name: 'oak_log',
        displayName: 'Oak Log'
    }, {
        name: 'oak_log',
        displayName: 'Duplicate'
    }], template), /duplicate/);
});
