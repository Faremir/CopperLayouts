import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path), 'utf8');
const Layout = createRequire(import.meta.url)('../src/engine.js');
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
const [template, style, engine, app, editor, catalogCode, rawLayout, rawItems, legacyPreset] = await Promise.all([
  read('src/page.html'), read('src/style.css'), read('src/engine.js'),
  read('src/app.js'), read('src/editor.js'), read('src/catalog.js'),
  read('data/default-layout.json'), read('data/items-26.1.json'),read('data/legacy-preset.json')
]);
const layout = Layout.validate(JSON.parse(rawLayout));
const catalog = JSON.parse(rawItems).map(({name, displayName}) => ({name, displayName}));
const values = {STYLE: style, ENGINE: engine, APP: app, EDITOR: editor,CATALOG_CODE:catalogCode,
  DATA: safeJSON(layout), CATALOG: safeJSON(catalog),LEGACY_PRESET:safeJSON(JSON.parse(legacyPreset))};
const html = template.replace(/\/\*__(\w+)__\*\//g, (marker, key) => {
  if (!(key in values)) throw new Error(`Unknown template marker ${marker}`);
  return values[key];
});
await mkdir(resolve(root, 'docs'), {recursive: true});
await writeFile(resolve(root, 'docs/index.html'), html);
await writeFile(resolve(root, 'docs/.nojekyll'), '\n');
console.log(`Built docs/index.html: ${layout.chests.length} chests, ${layout.floors.length} floors, ${catalog.length} items.`);
