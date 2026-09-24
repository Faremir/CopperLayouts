/* Pure layout operations. A chest identity never depends on its current slot. */
const Layout = (() => {
  const FORMAT = 'minecraft-storage-layout';
  const ROWS = 'TMB';
  const REVISION = 'v16-copper-layouts';
  const MAX_MODULES_PER_WALL = 1000;
  const MAX_MODULES = 10000;
  const COORDINATE_SYSTEM = 'wall-facing-tmb';
  const slotsOf = square => Array.from({length:9}, (_,i) => `${square.id}-${ROWS[Math.floor(i/3)]}${i%3+1}`);
  // Readable text remains upright; only the positions of the nine tiles rotate.
  // Column 1 is the leftmost column when standing inside and facing that wall.
  const wallOrder = {
    T:['T1','T2','T3','M1','M2','M3','B1','B2','B3'],
    R:['B1','M1','T1','B2','M2','T2','B3','M3','T3'],
    B:['B3','B2','B1','M3','M2','M1','T3','T2','T1'],
    L:['T3','M3','B3','T2','M2','B2','T1','M1','B1']
  };
  const displaySlotsOf = square => wallOrder[square.wall].map(position=>`${square.id}-${position}`);
  const canonicalSlot = id => typeof id === 'string' ? id.replace(/^(F\d+[TRBL][1-9]\d*-)([UD])([1-3])$/,(all,base,row,col)=>base+(row==='U'?'T':'B')+col) : id;
  const fail = message => { throw new Error(message); };
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  const string = (value, name, max=300, optional=false) => {
    if (optional && (value === undefined || value === null)) return '';
    if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) fail(`Invalid ${name}.`);
    return value;
  };
  const unique = (list, name) => { if(new Set(list).size !== list.length) fail(`Duplicate ${name}.`); };

  function migrateLegacy(raw) {
    if (!isObject(raw.placements) || !Array.isArray(raw.chests)) fail('Placements or prepared chests are missing.');
    const placements = {};
    for (const [oldSlot,chestId] of Object.entries(raw.placements)) {
      if (!/^F\d+[TRBL][1-9]\d*-[UMD][1-3]$/.test(oldSlot)) fail('Invalid legacy chest position.');
      placements[canonicalSlot(oldSlot)] = chestId;
    }
    // Opaque chest identities and staged chests stay intact across coordinate changes.
    return {...raw,schemaVersion:2,coordinateSystem:COORDINATE_SYSTEM,revision:REVISION,placements,
      chests:raw.chests.map(c=>isObject(c)?{...c,sourceSlot:canonicalSlot(c.sourceSlot)}:c)};
  }

  function validate(raw) {
    if (!isObject(raw) || raw.format !== FORMAT || ![1,2,3,4].includes(raw.schemaVersion)) fail('This is not a supported storage layout export.');
    if (raw.schemaVersion === 1) raw = migrateLegacy(raw);
    if (raw.coordinateSystem !== COORDINATE_SYSTEM) fail('Unsupported chest coordinate system.');
    if (!Array.isArray(raw.floors) || raw.floors.length > 100) fail('Invalid floor list.');
    if (!Array.isArray(raw.squares) || raw.squares.length > MAX_MODULES) fail(`A layout can contain up to ${MAX_MODULES.toLocaleString()} modules.`);
    if (!Array.isArray(raw.chests) || raw.chests.length > 20000) fail('Invalid chest list.');
    if (!isObject(raw.placements) || !Array.isArray(raw.staging)) fail('Placements or staging are missing.');
    const floors = raw.floors.map(f => {
      if (!isObject(f) || !Number.isInteger(f.id) || f.id < 0 || f.id > 9999) fail('Invalid floor.');
      const walls=raw.schemaVersion<3 ? ['T','R','B','L'].filter(w=>raw.squares.some(s=>s?.floor===f.id&&s.wall===w)) : f.walls;
      if(!Array.isArray(walls)||walls.length<1||walls.length>4||walls.some(w=>!['T','R','B','L'].includes(w))) fail('Choose at least one wall.');
      unique(walls,'wall');
      const moduleCounts={T:0,R:0,B:0,L:0};
      if(raw.schemaVersion===4 && f.moduleCounts!==undefined && !isObject(f.moduleCounts)) fail('Invalid wall module counts.');
      if(raw.schemaVersion===4 && Object.values(f.moduleCounts||{}).some(count=>!Number.isSafeInteger(count)||count<0||count>MAX_MODULES_PER_WALL)) fail(`Wall module counts must be whole numbers from 0 to ${MAX_MODULES_PER_WALL.toLocaleString()}.`);
      for(const wall of walls) {
        const count=raw.schemaVersion<4?3:(f.moduleCounts?.[wall]??3);
        if(!Number.isSafeInteger(count)||count<1||count>MAX_MODULES_PER_WALL) fail(`Each wall must have 1–${MAX_MODULES_PER_WALL.toLocaleString()} modules.`);
        moduleCounts[wall]=count;
      }
      return {id:f.id,name:string(f.name,'floor name'),shortName:string(f.shortName||f.name,'floor label'),walls,moduleCounts};
    });
    unique(floors.map(f=>f.id),'floor');
    const floorDefinitions = new Map(floors.map(f=>[f.id,f]));
    const squares = raw.squares.map(s => {
      if (!isObject(s) || !floorDefinitions.has(s.floor) || !['T','R','B','L'].includes(s.wall) || !Number.isSafeInteger(s.section) || s.section<1 || s.section>floorDefinitions.get(s.floor).moduleCounts[s.wall] || s.id !== `F${s.floor}${s.wall}${s.section}`) fail('Invalid 3×3 square.');
      return {id:s.id, floor:s.floor, wall:s.wall, section:s.section};
    });
    unique(squares.map(s=>s.id),'square');
    for (const floor of floors) {
      const ids=new Set(squares.filter(s=>s.floor===floor.id).map(s=>s.id));
      const expected=squaresForFloor(floor).map(s=>s.id);
      if(ids.size!==expected.length||expected.some(id=>!ids.has(id))) fail(`Wall structure does not match floor ${floor.id}.`);
    }
    const chests = raw.chests.map(c => {
      if (!isObject(c) || typeof c.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(c.id) || !Array.isArray(c.items) || c.items.length > 20000) fail('Invalid chest.');
      const items = c.items.map(item => {
        if (!isObject(item)) fail(`Invalid item in ${c.id}.`);
        return {name:string(item.name,'item name',500),itemId:string(item.itemId,'item identifier',300,true)};
      });
      return {id:c.id,label:string(c.label,'chest label'),family:string(c.family,'family',300,true),role:string(c.role,'role',300,true),items,
        sourceSlot:string(c.sourceSlot,'original position',120,true),sourceGroup:string(c.sourceGroup,'original group',300,true)};
    });
    unique(chests.map(c=>c.id),'chest identity');
    const chestIds = new Set(chests.map(c=>c.id));
    const slotIds = new Set(squares.flatMap(slotsOf));
    const used = new Set();
    const record = id => {
      if (!chestIds.has(id)) fail('A placement references an unknown chest.');
      if (used.has(id)) fail('A chest is placed more than once.');
      used.add(id);
      return id;
    };
    if (Object.keys(raw.placements).length !== slotIds.size || Object.keys(raw.placements).some(s=>!slotIds.has(s))) fail('The floor slot list is incomplete or contains unknown positions.');
    const placements = {};
    for (const slot of slotIds) {
      const id = raw.placements[slot];
      placements[slot] = id === null ? null : record(id);
    }
    const staging = raw.staging.map(record);
    if (used.size !== chestIds.size) fail('Some chests are missing from both the floors and staging.');
    return {format:FORMAT,schemaVersion:4,coordinateSystem:COORDINATE_SYSTEM,revision:REVISION,
      sourceRevision:string(raw.sourceRevision,'source revision',120,true),floors,squares,chests,placements,staging};
  }

  function squaresForFloor(floor) {
    return floor.walls.flatMap(wall=>{
      const count=floor.moduleCounts?.[wall]??3;
      if(!Number.isSafeInteger(count)||count<1||count>MAX_MODULES_PER_WALL) fail(`Each wall must have 1–${MAX_MODULES_PER_WALL.toLocaleString()} modules.`);
      return Array.from({length:count},(_,i)=>({id:`F${floor.id}${wall}${i+1}`,floor:floor.id,wall,section:i+1}));
    });
  }

  function clear(doc) {
    return validate({...doc,floors:[],squares:[],chests:[],placements:{},staging:[]});
  }

  function saveChest(doc,chest,target=null) {
    const existing=doc.chests.some(c=>c.id===chest.id);
    const chests=existing?doc.chests.map(c=>c.id===chest.id?chest:c):[...doc.chests,chest];
    const placements={...doc.placements},staging=[...doc.staging];
    if(!existing) {
      if(target!==null) {
        if(!Object.hasOwn(placements,target)) fail('Unknown destination.');
        if(placements[target]!==null) fail('This position is already occupied.');
        placements[target]=chest.id;
      } else staging.push(chest.id);
    }
    return validate({...doc,chests,placements,staging});
  }

  function deleteChest(doc,id) {
    if(!doc.chests.some(c=>c.id===id)) fail('Unknown chest.');
    return {...doc,chests:doc.chests.filter(c=>c.id!==id),
      placements:Object.fromEntries(Object.entries(doc.placements).map(([s,c])=>[s,c===id?null:c])),
      staging:doc.staging.filter(c=>c!==id)};
  }

  function saveFloor(doc,floor) {
    const existing=doc.floors.some(f=>f.id===floor.id);
    const floors=existing?doc.floors.map(f=>f.id===floor.id?floor:f):[...doc.floors,floor];
    const squares=[...doc.squares.filter(s=>s.floor!==floor.id),...squaresForFloor(floor)];
    if(squares.length>MAX_MODULES) fail(`A layout can contain up to ${MAX_MODULES.toLocaleString()} modules.`);
    return reconcileSquares(doc,floors,squares);
  }

  function deleteFloor(doc,id) {
    if(!doc.floors.some(f=>f.id===id)) fail('Unknown floor.');
    return reconcileSquares(doc,doc.floors.filter(f=>f.id!==id),doc.squares.filter(s=>s.floor!==id));
  }

  function reconcileSquares(doc,floors,squares) {
    const slots=new Set(squares.flatMap(slotsOf));
    const staging=[...doc.staging];
    for(const [slot,chest] of Object.entries(doc.placements)) if(!slots.has(slot)&&chest) staging.push(chest);
    const placements=Object.fromEntries([...slots].map(slot=>[slot,doc.placements[slot]??null]));
    return validate({...doc,floors,squares,placements,staging});
  }

  function index(doc) {
    const floors = new Map(doc.floors.map(f=>[f.id,f]));
    const squares = new Map(doc.squares.map(s=>[s.id,s]));
    const chests = new Map(doc.chests.map(c=>[c.id,c]));
    const locations = new Map(doc.staging.map(id=>[id,null]));
    const slots = new Map();
    const wallSlots = new Map();
    for (const s of doc.squares) slotsOf(s).forEach((id,i) => {
      const column=i%3+1;
      // Wall offsets follow map coordinates (north→south / west→east).
      // The left and bottom wall's facing-left column is at the opposite end.
      const wallColumn=['L','B'].includes(s.wall)?3-column:column-1;
      const visualIndex=displaySlotsOf(s).indexOf(id);
      const slot = {id,squareId:s.id,floor:s.floor,wall:s.wall,row:Math.floor(i/3),column,
        offset:(s.section-1)*3+wallColumn,mapRow:Math.floor(visualIndex/3)+1,mapColumn:visualIndex%3+1};
      slots.set(id,slot);
      wallSlots.set(`${s.floor}:${s.wall}:${slot.row}:${slot.offset}`,id);
      const chestId = doc.placements[id];
      if(chestId) locations.set(chestId,id);
    });
    const at = (f,w,r,o) => wallSlots.get(`${f}:${w}:${r}:${o}`) || null;
    const joinsByFloor = new Map(doc.floors.map(f=>{
      const end=wall=>f.moduleCounts[wall]*3-1;
      return [f.id,[['T',0,'L',0],['T',end('T'),'R',0],['B',0,'L',end('L')],['B',end('B'),'R',end('R')]]];
    }));
    for (const slot of slots.values()) {
      const {floor:f,wall:w,row:r,offset:o} = slot;
      slot.neighbors = {above:at(f,w,r-1,o),below:at(f,w,r+1,o),previousOnWall:at(f,w,r,o-1),nextOnWall:at(f,w,r,o+1)};
      slot.cornerNeighbors = [];
      for (const [wa,oa,wb,ob] of joinsByFloor.get(f)) {
        const other = w===wa && o===oa ? at(f,wb,r,ob) : w===wb && o===ob ? at(f,wa,r,oa) : null;
        if(other) slot.cornerNeighbors.push(other);
      }
    }
    return {floors,squares,chests,slots,locations};
  }

  function move(doc, chestId, target) {
    const ix = index(doc);
    if (!ix.chests.has(chestId) || !ix.locations.has(chestId)) fail('Unknown chest.');
    if (target !== null && !ix.slots.has(target)) fail('Unknown destination.');
    const source = ix.locations.get(chestId);
    if (source === target) return doc;
    const placements = {...doc.placements}, staging = [...doc.staging];
    if (target === null) {
      placements[source] = null;
      staging.push(chestId);
    } else {
      const occupant = placements[target];
      placements[target] = chestId;
      if (source !== null) placements[source] = occupant;
      else {
        const position = staging.indexOf(chestId);
        if (occupant) staging[position] = occupant;
        else staging.splice(position,1);
      }
    }
    return {...doc,placements,staging};
  }

  function exportDocument(doc) {
    const ix = index(doc);
    // Neighbor references identify fixed physical slots; occupants reflect every edit.
    return {...doc,exportedAt:new Date().toISOString(),topology:{slots:[...ix.slots.values()].map(s=>({
      id:s.id,squareId:s.squareId,floor:s.floor,wall:s.wall,row:ROWS[s.row],column:s.column,mapRow:s.mapRow,mapColumn:s.mapColumn,
      chestId:doc.placements[s.id],neighbors:s.neighbors,cornerNeighbors:s.cornerNeighbors
    }))}};
  }
  return {validate,index,move,exportDocument,slotsOf,displaySlotsOf,canonicalSlot,saveChest,deleteChest,saveFloor,deleteFloor,squaresForFloor,clear,MAX_MODULES_PER_WALL,MAX_MODULES};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
