const {test} = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../src/engine.js');
const prepared = require('../data/default-layout.json');
const original = () => Layout.validate(structuredClone(prepared));
const chest = (id, items=[]) => ({id,label:id,items});
const empty = () => Layout.clear(original());

test('migrates the accepted layout without changing any chest assignment or contents', () => {
  const doc=original();
  assert.equal(doc.schemaVersion,4);
  assert.equal(doc.floors.length,8);
  assert.equal(doc.chests.length,837);
  assert.deepEqual(doc.placements,prepared.placements);
  assert.deepEqual(doc.staging,prepared.staging);
  for(let i=0;i<doc.chests.length;i++) {
    assert.equal(doc.chests[i].id,prepared.chests[i].id);
    assert.deepEqual(doc.chests[i].items.map(i=>i.name),prepared.chests[i].items.map(i=>i.name));
    assert.ok(doc.chests[i].items.every(i=>!Object.hasOwn(i,'slots')));
  }
});

test('legacy U/D exports migrate to T/B while keeping opaque chest identities', () => {
  const legacy=structuredClone(prepared);
  legacy.schemaVersion=1;
  legacy.placements=Object.fromEntries(Object.entries(legacy.placements).map(([s,c])=>[s.replace(/-T/,'-U').replace(/-B/,'-D'),c]));
  const doc=Layout.validate(legacy);
  assert.deepEqual(doc.placements,original().placements);
  assert.equal(doc.chests[0].id,prepared.chests[0].id);
});

test('creates empty chests, accepts over 54 items, edits and deletes without altering other chests', () => {
  let doc=Layout.saveChest(original(),chest('test-chest'));
  assert.ok(doc.staging.includes('test-chest'));
  const contents=Array.from({length:80},(_,i)=>({name:`Custom item ${i}`,itemId:`mod:item_${i}`}));
  doc=Layout.saveChest(doc,{...chest('test-chest',contents),label:'Renamed'});
  assert.equal(doc.chests.find(c=>c.id==='test-chest').items.length,80);
  const target=Object.keys(doc.placements)[0],old=doc.placements[target];
  doc=Layout.move(doc,'test-chest',target);
  assert.ok(doc.staging.includes(old));
  doc=Layout.deleteChest(doc,'test-chest');
  assert.equal(doc.placements[target],null);
  assert.equal(doc.chests.length,837);
  assert.equal(Layout.validate(doc).chests.length,837);
});

test('new chests can occupy only existing empty positions', () => {
  let doc=original(),target=Object.keys(doc.placements)[0];
  assert.throws(()=>Layout.saveChest(doc,chest('new'),target),/occupied/);
  doc=Layout.deleteChest(doc,doc.placements[target]);
  doc=Layout.saveChest(doc,chest('new'),target);
  assert.equal(doc.placements[target],'new');
  assert.throws(()=>Layout.saveChest(doc,chest('bad'),'F99L1-T1'),/Unknown/);
});

test('removing a wall preserves every chest exactly once and rebuilding adds empty positions', () => {
  const before=original(),floor=before.floors.find(f=>f.id===0);
  const wall=floor.walls[0];
  const removed=Object.entries(before.placements).filter(([s])=>s.startsWith(`F0${wall}`)).map(([,c])=>c);
  let doc=Layout.saveFloor(before,{...floor,name:'Workshop',walls:floor.walls.filter(w=>w!==wall)});
  assert.equal(doc.staging.length,before.staging.length+27);
  assert.ok(removed.every(c=>doc.staging.includes(c)));
  assert.equal(doc.chests.length,before.chests.length);
  for(const [slot,c] of Object.entries(doc.placements)) assert.equal(c,before.placements[slot]);
  doc=Layout.saveFloor(doc,{...floor,name:'Workshop'});
  assert.equal(Object.values(doc.placements).filter(c=>c===null).length,27);
  assert.ok(removed.every(c=>doc.staging.includes(c)));
  assert.deepEqual(before,original());
});

test('all floors may be removed and recreated without losing their staged chests', () => {
  let doc=original();
  for(const f of [...doc.floors]) doc=Layout.deleteFloor(doc,f.id);
  assert.equal(doc.floors.length,0);
  assert.equal(doc.staging.length,837);
  assert.deepEqual(doc.placements,{});
  doc=Layout.saveFloor(doc,{id:0,name:'Fresh floor',walls:['T','R','L']});
  assert.equal(doc.squares.length,9);
  assert.equal(Object.keys(doc.placements).length,81);
  doc=Layout.move(doc,doc.staging[0],'F0L1-T1');
  assert.equal(Layout.validate(doc).staging.length,836);
  assert.throws(()=>Layout.saveFloor(doc,{id:0,name:'No walls',walls:[]}),/wall/);
});

test('empty document supports new floors and chest creation', () => {
  let doc=Layout.saveChest(empty(),chest('first'));
  doc=Layout.saveFloor(doc,{id:1,name:'Storage',walls:['B']});
  doc=Layout.move(doc,'first','F1B2-M2');
  assert.equal(doc.placements['F1B2-M2'],'first');
});

test('wall-facing orientation keeps bottom chests inward and facing-left column 1', () => {
  const expected={T:['T1','T2','T3','M1','M2','M3','B1','B2','B3'],L:['T3','M3','B3','T2','M2','B2','T1','M1','B1'],R:['B1','M1','T1','B2','M2','T2','B3','M3','T3'],B:['B3','B2','B1','M3','M2','M1','T3','T2','T1']};
  for(const [wall,order] of Object.entries(expected)) assert.deepEqual(Layout.displaySlotsOf({id:'square',wall}),order.map(p=>'square-'+p));
  const ix=Layout.index(original());
  assert.equal(ix.slots.get('F0L1-T1').neighbors.nextOnWall,'F0L2-T3');
  assert.equal(ix.slots.get('F0R1-T3').neighbors.nextOnWall,'F0R2-T1');
});

test('export/import preserves edits and regenerates neighbors for the current walls', () => {
  let doc=original(),floor=doc.floors[0];
  doc=Layout.saveFloor(doc,{...floor,walls:['T','R','L','B'],moduleCounts:{...floor.moduleCounts,B:3}});
  doc=Layout.saveChest(doc,chest('custom',[{name:'A <custom> item',itemId:'example:item'}]));
  doc=Layout.move(doc,'custom','F0B1-T1');
  const exported=Layout.exportDocument(doc);
  assert.deepEqual(Layout.validate(JSON.parse(JSON.stringify(exported))),doc);
  assert.equal(exported.topology.slots.find(s=>s.id==='F0B1-T1').chestId,'custom');
  const ids=new Set(exported.topology.slots.map(s=>s.id));
  for(const s of exported.topology.slots) for(const neighbor of [...Object.values(s.neighbors),...s.cornerNeighbors]) assert.ok(neighbor===null||ids.has(neighbor));
});

test('invalid imports cannot duplicate, lose, or reference unknown chests', () => {
  const doc=original(),slots=Object.keys(doc.placements);
  const duplicate=structuredClone(doc);duplicate.placements[slots[1]]=duplicate.placements[slots[0]];
  assert.throws(()=>Layout.validate(duplicate),/more than once/);
  const missing=structuredClone(doc);missing.placements[slots[0]]=null;
  assert.throws(()=>Layout.validate(missing),/missing/);
  const unknown=structuredClone(doc);unknown.placements[slots[0]]='unknown';
  assert.throws(()=>Layout.validate(unknown),/unknown/);
});

test('each wall has independent module counts and shrinking stages exactly the removed chests', () => {
  const before=original(),floor=before.floors[0];
  const doc=Layout.saveFloor(before,{...floor,walls:['T','R','B','L'],moduleCounts:{T:1,R:4,B:12,L:2}});
  assert.equal(doc.squares.filter(s=>s.floor===0).length,19);
  assert.equal(doc.staging.length,27);
  const removed=Object.entries(before.placements).filter(([s])=>/^F0(T[23]|L3)-/.test(s)).map(([,c])=>c);
  assert.deepEqual(new Set(doc.staging),new Set(removed));
  assert.equal(doc.placements['F0R4-T1'],null);
  let moved=Layout.move(doc,removed[0],'F0B12-B3');
  assert.equal(Layout.index(moved).locations.get(removed[0]),'F0B12-B3');
  assert.deepEqual(Layout.validate(JSON.parse(JSON.stringify(Layout.exportDocument(moved)))),moved);
  assert.equal(Layout.index(moved).slots.get('F0B11-T1').neighbors.nextOnWall,'F0B12-T3');
  assert.deepEqual(before,original());
});

test('unequal wall lengths use their actual endpoints for corner neighbors', () => {
  const doc=Layout.saveFloor(empty(),{id:0,name:'Unequal',walls:['T','R','B','L'],moduleCounts:{T:1,R:4,B:12,L:2}});
  const slots=Layout.index(doc).slots;
  assert.ok(slots.get('F0T1-T3').cornerNeighbors.includes('F0R1-T1'));
  assert.ok(slots.get('F0L2-T1').cornerNeighbors.includes('F0B1-T3'));
  assert.ok(slots.get('F0B12-T1').cornerNeighbors.includes('F0R4-T3'));
  for(const slot of slots.values()) {
    for(const neighbor of slot.cornerNeighbors) assert.ok(slots.get(neighbor).cornerNeighbors.includes(slot.id));
  }
});

test('large wall counts work without imposing the former three-module structure', () => {
  const doc=Layout.saveFloor(empty(),{id:0,name:'Large wall',walls:['L'],moduleCounts:{L:1000}});
  assert.equal(doc.squares.length,1000);
  assert.equal(Object.keys(doc.placements).length,9000);
  assert.equal(Layout.index(doc).slots.get('F0L999-M1').neighbors.nextOnWall,'F0L1000-M3');
});

test('invalid wall counts are rejected before allocating slots', () => {
  for(const count of [-1,0,1.5,1001,Infinity,'3']) {
    assert.throws(()=>Layout.saveFloor(empty(),{id:0,name:'Invalid',walls:['T'],moduleCounts:{T:count}}),/modules/);
  }
  const bad=original();bad.floors[0].moduleCounts.B=-1;
  assert.throws(()=>Layout.validate(bad),/module counts/);
});

test('clear removes floors, chests, placements and staging without mutating the previous layout', () => {
  const before=Layout.move(original(),original().chests[0].id,null);
  const snapshot=structuredClone(before),doc=Layout.clear(before);
  for(const key of ['floors','squares','chests','staging']) assert.deepEqual(doc[key],[]);
  assert.deepEqual(doc.placements,{});
  assert.deepEqual(before,snapshot);
  assert.deepEqual(Layout.validate(Layout.exportDocument(doc)),doc);
});
