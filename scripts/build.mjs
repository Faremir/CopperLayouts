/** Build the static Pages site and an optional standalone offline copy. */
import { readFile as read_file, writeFile as write_file, mkdir } from 'node:fs/promises';
import { createRequire as create_require } from 'node:module';
import { fileURLToPath as file_u_r_l_to_path } from 'node:url';
import { resolve } from 'node:path';
const require = create_require(import.meta.url);
const Layout = require('../src/engine.js');
const ItemCatalog = require('../src/catalog.js');
const root = file_u_r_l_to_path(new URL('../', import.meta.url));
const read = path => read_file(resolve(root, path), 'utf8');
const write = (path, contents) => write_file(resolve(root, path), contents);
const safe_json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const data_paths = {
    config: 'config/app.json',
    template: 'config/default-layout.json',
    items: 'data/items.json',
    metadata: 'data/items.meta.json',
    legacy: 'data/legacy-preset.json'
};
const source_paths = ['src/utils.js', 'src/engine.js', 'src/catalog.js', 'src/app.js', 'src/editor.js', 'src/main.js'];
const options = Object.fromEntries(await Promise.all(Object.entries(data_paths).map(async ([key, path]) => [key, JSON.parse(await read(path))])));
const layout = Layout.validate(new ItemCatalog(options.items).hydrate_template(options.template));
const [page, style, ...sources] = await Promise.all([read('src/page.html'), read('src/style.css'), ...source_paths.map(read)]);
const script = "'use strict';\n\n" + sources.join('\n');
const site = page.replace('<!-- STYLES -->', '<link rel="stylesheet" href="./style.css">').replace('<!-- SCRIPTS -->', '<script src="./app.js" defer></script>');
const offline = page.replace('<!-- STYLES -->', '<style>\n' + style + '</style>').replace('<!-- SCRIPTS -->', '<script>\nconst OFFLINE_DATA = ' + safe_json(options) + ';\n' + script + '</script>');
await mkdir(resolve(root, 'docs'), {
    recursive: true
});
await Promise.all([write('docs/index.html', site), write('docs/offline.html', offline), write('docs/app.js', script), write('docs/style.css', style), write('docs/config.json', await read(data_paths.config)), write('docs/default-layout.json', await read(data_paths.template)), write('docs/items.json', await read(data_paths.items)), write('docs/items.meta.json', await read(data_paths.metadata)), write('docs/legacy-preset.json', await read(data_paths.legacy)), write('docs/.nojekyll', '\n')]);
console.log(`Built CopperLayouts: ${layout.chests.length} chests, ${layout.floors.length} floors, ${options.items.length} catalog items.`);
