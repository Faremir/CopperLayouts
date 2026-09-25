/** Refresh the item registry from the newest stable Java version in minecraft-data. */
import { createHash as create_hash } from 'node:crypto';
import { readFile as read_file, writeFile as write_file, rename, rm } from 'node:fs/promises';
import { fileURLToPath as file_u_r_l_to_path, pathToFileURL as path_to_file_u_r_l } from 'node:url';
import { resolve } from 'node:path';
export class ItemCatalogUpdater {
    constructor({
        root,
        request = fetch
    } = {}) {
        this.root = root || file_u_r_l_to_path(new URL('../', import.meta.url));
        this.request = request;
        this.repository = 'PrismarineJS/minecraft-data';
    }

    async read_remote(url) {
        const response = await this.request(url, {
            headers: {
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'CopperLayouts'
            },
            signal: AbortSignal.timeout(30000)
        });
        if (!response.ok) {
            throw new Error(`Catalog request failed (${response.status}): ${url}`);
        }
        return response.json();
    }

    /** Ignore snapshots and pre-releases; resolve shared item paths through the manifest. */
    select_version(paths) {
        const versions = Object.keys(paths.pc || {}).filter(version => /^\d+\.\d+(?:\.\d+)?$/.test(version) && paths.pc[version].items).sort((first, second) => first.localeCompare(second, 'en', {
            numeric: true
        }));
        const version = versions.at(-1);
        if (!version) {
            throw new Error('No stable Java item catalog is available.');
        }
        const path = paths.pc[version].items;
        if (!/^pc\/[a-zA-Z0-9_.-]+$/.test(path)) {
            throw new Error('Invalid upstream item path.');
        }
        return {
            version,
            path: 'data/' + path + '/items.json'
        };
    }

    validate_items(items, template) {
        if (!Array.isArray(items) || !items.length) {
            throw new Error('The item catalog is empty or invalid.');
        }
        const names = new Set();
        for (const item of items) {
            if (!/^[a-z0-9_]+$/.test(item.name) || typeof item.displayName !== 'string' || !item.displayName.trim() || names.has(item.name)) {
                throw new Error('The item catalog contains an invalid or duplicate registry name.');
            }
            names.add(item.name);
        }
        const missing = template.chests.flatMap(chest => chest.items).filter(id => !names.has(id.replace(/^minecraft:/, '')));
        if (missing.length) {
            throw new Error('The template still uses removed item IDs: ' + [...new Set(missing)].join(', '));
        }
    }

    /** Validate the complete download before replacing either generated data file. */
    async update() {
        const upstream = await this.read_remote(`https://api.github.com/repos/${this.repository}/commits/master`);
        if (!/^[a-f0-9]{40}$/.test(upstream.sha || '')) {
            throw new Error('Invalid upstream revision.');
        }
        const base = `https://raw.githubusercontent.com/${this.repository}/${upstream.sha}/`;
        const paths = await this.read_remote(base + 'data/dataPaths.json');
        const selected = this.select_version(paths);
        const items = await this.read_remote(base + selected.path);
        const template = JSON.parse(await read_file(resolve(this.root, 'config/default-layout.json'), 'utf8'));
        this.validate_items(items, template);
        const content = JSON.stringify(items, null, 4) + '\n';
        const checksum = create_hash('sha256').update(content).digest('hex');
        const metadata_path = resolve(this.root, 'data/items.meta.json');
        let previous;
        try {
            previous = JSON.parse(await read_file(metadata_path, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        if (previous?.minecraft_version === selected.version && previous?.sha256 === checksum) {
            console.log(`Java ${selected.version}: the item catalog is already current.`);
            return false;
        }
        const metadata = {
            minecraft_version: selected.version,
            repository: this.repository,
            upstream_commit: upstream.sha,
            source_path: selected.path,
            source_url: base + selected.path,
            item_count: items.length,
            sha256: checksum
        };
        const files = [['data/items.json', content], ['data/items.meta.json', JSON.stringify(metadata, null, 4) + '\n']];
        try {
            for (const [path, value] of files) {
                await write_file(resolve(this.root, path + '.tmp'), value);
            }
            for (const [path] of files) {
                await rename(resolve(this.root, path + '.tmp'), resolve(this.root, path));
            }
        } finally {
            for (const [path] of files) {
                await rm(resolve(this.root, path + '.tmp'), {
                    force: true
                });
            }
        }
        console.log(`Updated Java ${selected.version}: ${items.length} items.`);
        return true;
    }
}
if (process.argv[1] && import.meta.url === path_to_file_u_r_l(resolve(process.argv[1])).href) {
    await new ItemCatalogUpdater().update();
}
