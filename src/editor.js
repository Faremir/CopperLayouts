// Dialog drafts are committed together, so Cancel never changes the layout.
let chestDraft=null, chestTarget=null, chestIsNew=false, floorDraft=null, floorIsNew=false;
const catalogEntries=ITEM_CATALOG.map(item=>({name:item.displayName,itemId:'minecraft:'+item.name,
  search:normalize(item.displayName+' '+item.name+' minecraft:'+item.name).replace(/_/g,' ')}));

function openChestEditor(id=null,target=null) {
  const c=id?indexes.chests.get(id):null;
  if(id&&!c) return;
  picked=null;markSelection();renderInspector();
  chestDraft=c?structuredClone(c):{id:'chest-'+crypto.randomUUID(),label:'New chest',family:'',role:'',items:[],sourceSlot:'',sourceGroup:''};
  chestTarget=target;chestIsNew=!c;
  $('chestEditorHeading').textContent=c?'Edit chest':'Create chest';
  $('chestName').value=chestDraft.label;
  $('saveChest').textContent=c?'Save chest':'Create chest';
  $('catalogSearch').value='';
  $('chestEditError').hidden=true;
  renderDraftItems();renderCatalog();
  $('chestEditor').showModal();
  $('chestName').focus();
  if(!c) $('chestName').select();
}

function renderDraftItems() {
  $('draftItemCount').textContent=chestDraft.items.length;
  $('draftItems').innerHTML=chestDraft.items.length?chestDraft.items.map((item,i)=>`<div class="draft-item"><input data-item-name="${i}" aria-label="Item name ${i+1}" value="${escapeHTML(item.name)}" required maxlength="500" autocomplete="off"><button type="button" class="quiet remove-item" data-remove-item="${i}" aria-label="Remove ${escapeHTML(item.name)}">✕</button></div>`).join(''):'<p class="empty-detail">No items yet.</p>';
}

function catalogMatches(query) {
  const normalized=normalize(query).replace(/_/g,' ').trim();
  if(!normalized) return [];
  const words=normalized.split(/\s+/);
  return catalogEntries.filter(item=>words.every(w=>item.search.includes(w))).sort((a,b)=>{
    const rank=item=>normalize(item.name)===normalized?0:normalize(item.name).startsWith(normalized)?1:2;
    return rank(a)-rank(b)||a.name.localeCompare(b.name);
  });
}

function renderCatalog() {
  const query=$('catalogSearch').value.trim(),results=$('catalogResults');
  const matches=catalogMatches(query);
  results.hidden=!query;
  results.innerHTML=query?matches.slice(0,20).map(item=>`<button type="button" data-add-item="${escapeHTML(item.itemId)}"><span>${escapeHTML(item.name)}</span><small>${escapeHTML(item.itemId)}</small><span aria-hidden="true">＋</span></button>`).join('')+`<button type="button" class="custom-item" data-custom-item="true"><span>Add custom: ${escapeHTML(query)}</span><span aria-hidden="true">＋</span></button>`:'';
}

function addDraftItem(item) {
  chestDraft.items.push({name:item.name,itemId:item.itemId||''});
  renderDraftItems();
  $('draftItems').lastElementChild?.scrollIntoView({block:'nearest'});
  $('catalogSearch').focus({preventScroll:true});
}

function openFloorEditor(id=null) {
  const f=id===null?null:indexes.floors.get(id);
  if(id!==null&&!f) return;
  floorIsNew=!f;
  floorDraft=f?structuredClone(f):{id:Math.max(-1,...layout.floors.map(f=>f.id))+1,name:'New floor',shortName:'New floor',walls:['T','R','B','L']};
  $('floorEditorHeading').textContent=f?'Edit floor':'Create floor';
  $('floorTitle').value=floorDraft.name;
  for(const input of $('floorForm').querySelectorAll('input[name=wall]')) input.checked=floorDraft.walls.includes(input.value);
  $('deleteFloor').hidden=!f;
  $('floorEditError').hidden=true;
  $('floorEditor').showModal();$('floorTitle').focus();
  if(!f) $('floorTitle').select();
}

$('newChest').addEventListener('click',()=>openChestEditor());
$('newFloor').addEventListener('click',()=>openFloorEditor());
$('editFloor').addEventListener('click',()=>openFloorEditor(floor));
$('catalogSearch').addEventListener('input',renderCatalog);
$('catalogSearch').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&$('catalogSearch').value.trim()) {
    event.preventDefault();
    const first=catalogMatches($('catalogSearch').value)[0];
    addDraftItem(first||{name:$('catalogSearch').value.trim(),itemId:''});
  }
});
$('draftItems').addEventListener('input',event=>{
  if(event.target.dataset.itemName!==undefined) chestDraft.items[Number(event.target.dataset.itemName)].name=event.target.value;
});
document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  if(button.dataset.close) {$(button.dataset.close).close();return;}
  if(button.dataset.removeItem!==undefined) {chestDraft.items.splice(Number(button.dataset.removeItem),1);renderDraftItems();return;}
  if(button.dataset.addItem) {const item=catalogEntries.find(i=>i.itemId===button.dataset.addItem);if(item)addDraftItem(item);return;}
  if(button.dataset.customItem) addDraftItem({name:$('catalogSearch').value.trim(),itemId:''});
});
$('chestForm').addEventListener('submit',event=>{
  event.preventDefault();
  try {
    const old=indexes.chests.get(chestDraft.id);
    const changed=old&&JSON.stringify(old.items)!==JSON.stringify(chestDraft.items);
    const nextChest={...chestDraft,label:$('chestName').value.trim(),items:chestDraft.items.map(i=>({...i,name:i.name.trim()})),
      family:changed?'':chestDraft.family,role:changed?'':chestDraft.role};
    const next=Layout.saveChest(layout,nextChest,chestIsNew?chestTarget:null);
    selected=nextChest.id;
    $('chestEditor').close();
    commit(next,chestIsNew?'Chest created':'Chest updated');
  } catch(error) {$('chestEditError').textContent=error.message;$('chestEditError').hidden=false;}
});
$('floorForm').addEventListener('submit',event=>{
  event.preventDefault();
  try {
    const name=$('floorTitle').value.trim();
    const walls=[...$('floorForm').querySelectorAll('input[name=wall]:checked')].map(i=>i.value);
    const next=Layout.saveFloor(layout,{...floorDraft,name,shortName:name,walls});
    const staged=next.staging.length-layout.staging.length;
    floor=floorDraft.id;
    $('floorEditor').close();
    commit(next,staged?`${staged} chests moved to staging`:floorIsNew?'Floor created':'Floor updated');
  } catch(error) {$('floorEditError').textContent=error.message;$('floorEditError').hidden=false;}
});
$('deleteFloor').addEventListener('click',()=>{
  const next=Layout.deleteFloor(layout,floorDraft.id);
  $('floorEditor').close();
  commit(next,'Floor removed · its chests are in staging');
});
