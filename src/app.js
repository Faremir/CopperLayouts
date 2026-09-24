const STORAGE_KEY = 'minecraft_storage_editor_v3';
const LEGACY_STORAGE_KEYS = ['minecraft_storage_editor_v2','minecraft_storage_editor_v1'];
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const normalize = value => String(value).toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'');
let layout = Layout.validate(INITIAL_LAYOUT), floor = 0, selected = 'chest-F0L3-U3';
let indexes, picked = null, dragged = null, dropHighlight = null, ignoreClickUntil = 0;
let noticeTimer, undoStack = [], redoStack = [];
let startupError = '', migratedCache = false;
try {
  const cached = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map(key=>localStorage.getItem(key)).find(Boolean);
  if (cached) {
    const parsed = JSON.parse(cached);
    layout = Layout.validate(parsed);
    migratedCache = parsed.schemaVersion < 3;
    if (layout.floors.some(f=>f.id===parsed.view?.floor)) floor = parsed.view.floor;
    if (layout.chests.some(c=>c.id===parsed.view?.selected)) selected = parsed.view.selected;
  }
} catch (error) { startupError = 'The saved layout could not be opened. You can import an exported layout.'; }
indexes = Layout.index(layout);
if (!indexes.chests.has(selected)) selected = layout.chests[0]?.id??null;
if (!indexes.floors.has(floor)) floor = layout.floors[0]?.id??null;

function notify(message) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.add('visible');
  noticeTimer = setTimeout(()=>$('notice').classList.remove('visible'),2500);
}
function showError(message) { $('error').textContent=message; $('error').hidden=!message; }
function save() {
  try {
    localStorage.setItem(STORAGE_KEY,JSON.stringify({...layout,view:{floor,selected}}));
    $('saveStatus').textContent='Saved';
    $('saveStatus').classList.remove('unsaved');
    return true;
  } catch(error) {
    $('saveStatus').textContent='Export to save';
    $('saveStatus').classList.add('unsaved');
    showError('This browser cannot save these changes locally. Use Export to keep your layout.');
    return false;
  }
}
function commit(next, message) {
  if(next===layout) return false;
  undoStack.push(layout);
  if(undoStack.length>100) undoStack.shift();
  redoStack=[];
  layout=next;
  indexes=Layout.index(layout);
  if(!indexes.floors.has(floor)) floor=layout.floors[0]?.id??null;
  if(!indexes.chests.has(selected)) selected=layout.chests[0]?.id??null;
  picked=null;
  render();
  save();
  if(message) notify(message);
  return true;
}
function undo() {
  if(!undoStack.length) return;
  redoStack.push(layout);
  layout=undoStack.pop();
  restoreHistory('Undone');
}
function redo() {
  if(!redoStack.length) return;
  undoStack.push(layout);
  layout=redoStack.pop();
  restoreHistory('Redone');
}
function restoreHistory(message) {
  indexes=Layout.index(layout);
  if(!indexes.floors.has(floor)) floor=layout.floors[0]?.id??null;
  if(!indexes.chests.has(selected)) selected=layout.chests[0]?.id??null;
  picked=null;
  render(); save(); notify(message);
}
function moveChest(id,target) {
  const c=indexes.chests.get(id);
  if(!c) return;
  const occupant=target ? layout.placements[target] : null;
  selected=id;
  const message=target===null ? 'Chest moved to staging' : occupant && occupant!==id ? 'Chests swapped' : 'Chest moved';
  try {
    if(!commit(Layout.move(layout,id,target),message)) {picked=null;render();}
  } catch(error) {showError(error.message);}
}

function chestColor(c) {
  const woods=[['dark oak','#947960'],['pale oak','#dad4b4'],['oak','#bb9a64'],['spruce','#9b7c54'],['birch','#d5ceac'],['jungle','#b99370'],['acacia','#c28968'],['mangrove','#b9756e'],['cherry','#dbafb3'],['poplar','#c5b876'],['crimson','#bb718e'],['warped','#69afa3'],['bamboo','#b8be6f']];
  const family=c.family.toLowerCase();
  for(const [name,color] of woods) if(family===name || family.startsWith(name+' ') || family.startsWith(name+' ·')) return color;
  const colors={'light gray':'#b9bbb4','light blue':'#86b9d3',white:'#d9dad0',orange:'#cc9763',magenta:'#bc7fbd',yellow:'#cfbd6a',lime:'#9eb667',pink:'#d4a0af',gray:'#858d91',cyan:'#6baaaa',purple:'#9f82b8',blue:'#7e94bd',brown:'#a08972',green:'#8caa7b',red:'#be7d73',black:'#748181'};
  for(const [name,color] of Object.entries(colors)) if(normalize(c.label).startsWith(name+' ')) return color;
  return '#8aab96';
}
function tile(chestId,slotId=null) {
  const pos=slotId ? slotId.split('-').at(-1) : 'Staged';
  if(!chestId) return `<button type="button" id="slot-${slotId}" class="chest empty" data-slot="${slotId}" title="${slotId} · empty" aria-label="${slotId}, empty slot"><span class="tile-meta">${pos}</span><span class="plus" aria-hidden="true">+</span></button>`;
  const c=indexes.chests.get(chestId);
  const label=`${slotId || 'Staging'}: ${c.label}`;
  const contents=c.items.map(i=>i.name).join(', ');
  const count=c.items.length>1 ? `<span class="tile-count" title="${c.items.length} item types">+${c.items.length-1}</span>` : '';
  return `<button type="button" ${slotId?`id="slot-${slotId}" data-slot="${slotId}"`:''} class="chest ${chestId===selected?'selected':''} ${chestId===picked?'picked':''}" data-chest="${escapeHTML(chestId)}" draggable="true" style="--chest-color:${chestColor(c)}" title="${escapeHTML(label+'\n'+contents)}" aria-label="${escapeHTML(label)}" aria-pressed="${chestId===selected}"><span class="tile-meta"><span>${pos}</span>${count}</span><span class="tile-label">${escapeHTML(c.label)}</span></button>`;
}
function renderFloors() {
  $('floors').innerHTML=layout.floors.map(f=>`<button type="button" data-floor="${f.id}" class="${f.id===floor?'active':''}" aria-current="${f.id===floor?'page':'false'}" title="${escapeHTML(f.name)}"><span class="level">${f.id===0?'0':'−'+f.id}</span>${escapeHTML(f.shortName)}</button>`).join('');
  const f=indexes.floors.get(floor);
  $('floorName').textContent=f?`Floor ${floor===0?'0':'−'+floor} · ${f.name}`:'No floors';
  $('editFloor').hidden=!f;
}
function renderBoard() {
  $('map').classList.toggle('empty-map',!indexes.floors.has(floor));
  const f=indexes.floors.get(floor);
  const squares=layout.squares.filter(s=>s.floor===floor).sort((a,b)=>{
    const p=Layout.coordinates[a.wall+a.section],q=Layout.coordinates[b.wall+b.section];
    return p[0]-q[0] || p[1]-q[1];
  });
  $('map').innerHTML=squares.map(s=>{
    const [r,c]=Layout.coordinates[s.wall+s.section];
    return `<section class="square" style="grid-row:${r};grid-column:${c}" aria-label="${s.id}"><div class="square-heading"><span>${s.id}</span></div><div class="square-grid">${Layout.displaySlotsOf(s).map(id=>tile(layout.placements[id],id)).join('')}</div></section>`;
  }).join('')+`<div class="workspace ${f?'':'without-floor'}"><section id="inspector" class="inspector" aria-label="Selected chest contents"></section><section class="staging" aria-label="Shared chest staging"><div class="staging-heading"><h2>Staging</h2><span class="stage-count">${layout.staging.length}</span><span class="stage-scope">All floors</span></div><div id="stagingDrop" class="staging-drop ${picked?'pick-target':''}" tabindex="0" role="group" aria-label="Staging area; drop chests here">${layout.staging.length?layout.staging.map(id=>tile(id)).join(''):'<div class="stage-empty">Drop chests here</div>'}</div></section></div>`;
  if(f) for(const wall of ['T','R','B','L'].filter(w=>!f.walls.includes(w))) $('map').insertAdjacentHTML('beforeend',`<div class="wall-opening wall-${wall}">Open</div>`);
  renderInspector();
}
function renderInspector() {
  const c=indexes.chests.get(selected);
  if(!c) { $('inspector').innerHTML='<p class="empty-detail">Select or create a chest.</p>';return; }
  const location=indexes.locations.get(selected);
  const actions=`<div class="inspector-actions"><button type="button" data-action="edit">Edit</button><button type="button" data-action="pick">${picked?'Cancel move':'Move'}</button>${location!==null?'<button type="button" data-action="stage" title="Move this chest to staging">Stage</button>':''}<button type="button" class="danger quiet" data-action="delete">Delete</button></div>`;
  const pickedName=picked?indexes.chests.get(picked)?.label:'';
  $('inspector').innerHTML=`<div class="inspector-head"><div><span class="eyebrow">${location || 'Staging'}</span><h2>${escapeHTML(c.label)}</h2></div>${actions}</div>${c.items.length?`<ul class="item-list">${c.items.map(i=>`<li><span>${escapeHTML(i.name)}</span></li>`).join('')}</ul>`:'<p class="empty-detail">No items yet.</p>'}${picked?`<div class="move-hint">Place ${escapeHTML(pickedName)} in a slot or staging. Esc to cancel.</div>`:''}`;
}
function markSelection() {
  for(const node of document.querySelectorAll('[data-chest]')) {
    const active=node.dataset.chest===selected;
    node.classList.toggle('selected',active);
    node.classList.toggle('picked',node.dataset.chest===picked);
    if(node.classList.contains('chest')) node.setAttribute('aria-pressed',String(active));
  }
  document.body.classList.toggle('moving',!!picked);
  $('stagingDrop')?.classList.toggle('pick-target',!!picked);
}
function render() {
  renderFloors();renderBoard();markSelection();renderSearch();
  $('undo').disabled=!undoStack.length;
  $('redo').disabled=!redoStack.length;
}
function selectChest(id,jump=false) {
  if(!indexes.chests.has(id)) return;
  selected=id;
  const location=indexes.locations.get(id);
  const targetFloor=location?indexes.slots.get(location).floor:floor;
  if(jump && targetFloor!==floor) {floor=targetFloor;render();}
  else {renderInspector();markSelection();}
  if(jump) {
    const target=location?$('slot-'+location):$('stagingDrop');
    target?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    if(location) target?.focus({preventScroll:true});
  }
}
function setFloor(id) {
  if(!indexes.floors.has(id)) return;
  floor=id;
  // Keep a picked chest across floor switches; ordinary browsing selects this floor.
  if(!picked) {
    const current=indexes.locations.get(selected);
    if(current && indexes.slots.get(current)?.floor!==floor) {
      const square=layout.squares.find(s=>s.floor===floor);
      const local=Layout.slotsOf(square).map(s=>layout.placements[s]).find(Boolean);
      if(local) selected=local;
    }
  }
  render();save();
}
function matchingChests(query) {
  const words=normalize(query).replace(/(f\d+[trlb][1-3]-)([ud])([1-3])/g,(all,base,row,col)=>base+(row==='u'?'t':'b')+col).trim().split(/\s+/).filter(Boolean);
  if(!words.length) return [];
  return layout.chests.filter(c=>{
    const location=indexes.locations.get(c.id);
    const text=normalize([location || 'staging',c.label,c.family,...c.items.flatMap(i=>[i.name,i.itemId])].join(' '));
    return words.every(word=>text.includes(word));
  });
}
function renderSearch() {
  const query=$('search').value.trim(), box=$('results');
  const matches=query?matchingChests(query):[], ids=new Set(matches.map(c=>c.id));
  box.hidden=!query;
  $('search').setAttribute('aria-expanded',String(!!query));
  for(const node of document.querySelectorAll('.chest[data-chest]')) {
    node.classList.toggle('search-dim',!!query&&!ids.has(node.dataset.chest));
    node.classList.toggle('search-match',!!query&&ids.has(node.dataset.chest));
  }
  box.innerHTML=query?`<div class="result-count">${matches.length} matching chest${matches.length===1?'':'s'}${matches.length>60?' · first 60 shown':''}</div>`+matches.slice(0,60).map(c=>{
    const location=indexes.locations.get(c.id);
    return `<button type="button" class="result" data-find="${escapeHTML(c.id)}"><small>${location || 'Staging'}</small><strong>${escapeHTML(c.label)}</strong><span class="result-items">${escapeHTML(c.items.map(i=>i.name).join(', '))}</span></button>`;
  }).join(''):'';
}
function closeSearch(clear=false) {
  if(clear) {$('search').value='';renderSearch();}
  else {$('results').hidden=true;$('search').setAttribute('aria-expanded','false');}
}

async function importLayout(file) {
  if(!file) return;
  try {
    if(file.size>15*1024*1024) throw new Error('The file is larger than 15 MB.');
    const next=Layout.validate(JSON.parse(await file.text()));
    showError('');
    clearDrag();
    commit(next,'Layout imported');
  } catch(error) {showError('Import failed: '+error.message);}
}
function exportLayout() {
  const json=JSON.stringify(Layout.exportDocument(layout),null,2);
  const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download='minecraft-storage-layout-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('Complete layout exported');
}
function clearDrag() {
  if(dropHighlight) dropHighlight.classList.remove('drop-target');
  dropHighlight=null;dragged=null;
  document.body.classList.remove('is-dragging');
  document.querySelectorAll('.dragging').forEach(n=>n.classList.remove('dragging'));
}
function dropTarget(event) {
  return event.target.closest('[data-slot]') || event.target.closest('#stagingDrop');
}
document.addEventListener('dragstart',event=>{
  const node=event.target.closest('.chest[data-chest]');
  if(!node) return;
  dragged=node.dataset.chest;selected=dragged;picked=null;
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('application/x-minecraft-storage-chest',dragged);
  event.dataTransfer.setData('text/plain',dragged);
  node.classList.add('dragging');
  document.body.classList.add('is-dragging');
  renderInspector();markSelection();
});
document.addEventListener('dragover',event=>{
  if(!dragged) return;
  const target=dropTarget(event);
  if(dropHighlight!==target) {
    dropHighlight?.classList.remove('drop-target');
    dropHighlight=target;
    target?.classList.add('drop-target');
  }
  if(target) {event.preventDefault();event.dataTransfer.dropEffect='move';}
});
document.addEventListener('dragleave',event=>{
  if(!event.relatedTarget && dropHighlight) {dropHighlight.classList.remove('drop-target');dropHighlight=null;}
});
document.addEventListener('drop',event=>{
  if(!dragged) return;
  event.preventDefault();
  const target=dropTarget(event), id=dragged;
  clearDrag();
  ignoreClickUntil=Date.now()+180;
  if(target) moveChest(id,target.dataset.slot || null);
});
document.addEventListener('dragend',()=>{ignoreClickUntil=Date.now()+180;clearDrag();});

document.addEventListener('click',event=>{
  if(Date.now()<ignoreClickUntil) return;
  const button=event.target.closest('button');
  if(button?.dataset.floor!==undefined) {setFloor(Number(button.dataset.floor));return;}
  if(button?.dataset.find) {closeSearch(true);selectChest(button.dataset.find,true);return;}
  if(picked && event.target.closest('#stagingDrop')) {moveChest(picked,null);return;}
  if(button?.dataset.slot && picked) {moveChest(picked,button.dataset.slot);return;}
  if(button?.dataset.chest) {selectChest(button.dataset.chest);return;}
  if(button?.dataset.slot) {openChestEditor(null,button.dataset.slot);return;}
  if(button?.dataset.action==='edit') {openChestEditor(selected);return;}
  if(button?.dataset.action==='delete') {commit(Layout.deleteChest(layout,selected),'Chest deleted · Undo to restore');return;}
  if(button?.dataset.action==='pick') {picked=picked?null:selected;renderInspector();markSelection();return;}
  if(button?.dataset.action==='stage') {moveChest(selected,null);return;}
  if(!event.target.closest('.search-wrap')) closeSearch();
});
$('undo').addEventListener('click',undo);
$('redo').addEventListener('click',redo);
$('export').addEventListener('click',exportLayout);
$('import').addEventListener('click',()=>$('importFile').click());
$('importFile').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';importLayout(file);});
$('search').addEventListener('input',renderSearch);
$('search').addEventListener('focus',()=>{if($('search').value.trim())renderSearch();});
$('search').addEventListener('keydown',event=>{
  if(event.key==='ArrowDown') {event.preventDefault();$('results').querySelector('button')?.focus();}
  if(event.key==='Enter') {
    const result=matchingChests($('search').value)[0];
    if(result) {event.preventDefault();closeSearch(true);selectChest(result.id,true);}
  }
});
document.addEventListener('keydown',event=>{
  if(document.querySelector('dialog[open]')) return;
  if(event.key==='Escape') {picked=null;clearDrag();closeSearch(true);renderInspector();markSelection();return;}
  if(event.target.matches('input,textarea,[contenteditable]')) return;
  if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='z') {event.preventDefault();event.shiftKey?redo():undo();}
  if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='y') {event.preventDefault();redo();}
  if((event.key==='Enter'||event.key===' ') && event.target.id==='stagingDrop' && picked) {event.preventDefault();moveChest(picked,null);}
});
render();
if(startupError) showError(startupError);
else if(migratedCache) save();
