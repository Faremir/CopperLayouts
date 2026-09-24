const {test}=require('node:test');
const assert=require('node:assert/strict');
const Layout=require('../src/engine.js');
const Catalog=require('../src/catalog.js');
const prepared=require('../data/default-layout.json');
const legacy=require('../data/legacy-preset.json');
const catalog=Catalog.create(require('../data/items-26.1.json'));
const oldPreset=()=>({...Layout.validate(prepared),schemaVersion:3,chests:prepared.chests.map(c=>({...c,label:legacy[c.id].label,items:legacy[c.id].names.map(name=>({name,itemId:''}))}))});

test('every prepared item uses the catalog name and registry ID',()=>{
  for(const chest of prepared.chests) for(const item of chest.items) {
    assert.ok(catalog.byId.has(item.itemId),`${chest.id}: ${item.itemId}`);
    assert.deepEqual(item,catalog.byId.get(item.itemId));
  }
  assert.equal(prepared.chests.length,837);
  assert.equal(prepared.chests.filter(c=>!c.items.length).length,43);
});

test('aliases and broad categories resolve to real items without inventing unsupported items',()=>{
  assert.deepEqual(catalog.resolveLegacy('oak chest boat'),[{name:'Oak Boat with Chest',itemId:'minecraft:oak_chest_boat'}]);
  assert.equal(catalog.resolveLegacy('map')[0].itemId,'minecraft:filled_map');
  assert.equal(catalog.resolveLegacy('empty map')[0].itemId,'minecraft:map');
  assert.equal(catalog.resolveLegacy('gold tools').length,6);
  assert.equal(catalog.resolveLegacy('leather armor').length,4);
  assert.equal(catalog.resolveLegacy('music disc 13')[0].itemId,'minecraft:music_disc_13');
  assert.deepEqual(catalog.resolveLegacy('Music Disc'),[]);
  assert.deepEqual(catalog.resolveLegacy('poplar log'),[]);
  assert.deepEqual(catalog.resolveLegacy('white wool stairs'),[]);
});

test('old preset contents are repaired while moves and user labels survive',()=>{
  let doc=Layout.validate(oldPreset());
  const id=doc.chests[0].id;
  doc=Layout.move(doc,id,null);
  doc=Layout.saveChest(doc,{...doc.chests[0],label:'My renamed chest'});
  const repaired=Layout.validate(catalog.repairPreset(doc,prepared,legacy));
  assert.deepEqual(repaired.placements,doc.placements);
  assert.deepEqual(repaired.staging,doc.staging);
  assert.equal(repaired.chests[0].label,'My renamed chest');
  for(let i=0;i<repaired.chests.length;i++) assert.deepEqual(repaired.chests[i].items,prepared.chests[i].items);
});

test('migration preserves manual custom entries, aliases and user-created chests',()=>{
  let doc=Layout.validate(oldPreset());
  const c=doc.chests.find(c=>c.items.some(i=>i.name==='oak log'));
  const items=[...c.items,{name:'Modded drawer',itemId:''},{name:'My oak label',itemId:'minecraft:oak_log'}];
  doc=Layout.saveChest(doc,{...c,items});
  doc=Layout.saveChest(doc,{id:'user-chest',label:'Mine',items:[{name:'poplar log',itemId:'mod:poplar_log'}]});
  const repaired=catalog.repairPreset(doc,prepared,legacy);
  const contents=repaired.chests.find(x=>x.id===c.id).items;
  assert.ok(contents.some(i=>i.itemId==='minecraft:oak_log'&&i.name==='Oak Log'));
  assert.deepEqual(contents.slice(-2),items.slice(-2));
  assert.deepEqual(repaired.chests.at(-1),doc.chests.at(-1));
});
