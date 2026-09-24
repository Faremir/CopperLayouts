/* Item identities come from the bundled registry; custom labels remain editable. */
const Catalog = (() => {
  const normalize = value => String(value).toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,' ').trim();
  function create(entries) {
    const byId=new Map(entries.map(item=>['minecraft:'+item.name,{name:item.displayName,itemId:'minecraft:'+item.name}]));
    const byName=new Map(),byDisplay=new Map();
    for(const item of entries) {
      const key=normalize(item.displayName);
      if(!byDisplay.has(key)) byDisplay.set(key,new Set());
      byDisplay.get(key).add('minecraft:'+item.name);
    }
    for(const item of entries) for(const key of new Set([normalize(item.name),normalize(item.displayName)])) {
      if(!byName.has(key)) byName.set(key,new Set());
      byName.get(key).add('minecraft:'+item.name);
    }
    const aliases={potions:['potion'],'splash potions':['splash_potion'],'lingering potions':['lingering_potion'],
      'tipped arrows':['tipped_arrow'],'dry grass':['short_dry_grass','tall_dry_grass'],
      'netherite upgrade template':['netherite_upgrade_smithing_template'],
      'lapis lazuli block':['lapis_block'],'target block':['target']};
    for(const material of ['gold','copper','iron','leather']) {
      const prefix=material==='gold'?'golden':material;
      aliases[material+' armor']=['helmet','chestplate','leggings','boots'].map(piece=>prefix+'_'+piece);
      if(material!=='leather') aliases[material+' tools']=['axe','pickaxe','shovel','hoe','sword','spear'].map(piece=>prefix+'_'+piece);
    }
    function resolveLegacy(name) {
      const key=normalize(name);
      const matches=byDisplay.get(key)?.size===1?byDisplay.get(key):byName.get(key);
      const ids=aliases[key]?.map(id=>'minecraft:'+id) || (matches?.size===1?[...matches]:[]);
      return ids.map(id=>{
        const item=byId.get(id);
        if(!item) throw new Error(`Unknown catalog item: ${id}`);
        return {...item};
      });
    }
    function repairPreset(doc,preset,legacy) {
      const current=new Map(preset.chests.map(c=>[c.id,c]));
      return {...doc,chests:doc.chests.map(chest=>{
        const previous=legacy[chest.id],corrected=current.get(chest.id);
        if(!previous||!corrected) return chest;
        const untouched=chest.items.length===previous.names.length&&chest.items.every((item,i)=>!item.itemId&&item.name===previous.names[i]);
        if(untouched) return {...chest,label:chest.label===previous.label?corrected.label:chest.label,
          family:corrected.items.length?chest.family:'',role:corrected.items.length?chest.role:'',
          items:corrected.items.map(item=>({...item}))};
        // A user-edited preset keeps custom entries and aliases. Only known old names are linked.
        return {...chest,items:chest.items.flatMap(item=>{
          if(item.itemId||!previous.names.includes(item.name)) return [item];
          const resolved=resolveLegacy(item.name);
          return resolved.length?resolved:[item];
        })};
      })};
    }
    return {byId,resolveLegacy,repairPreset};
  }
  return {create};
})();
if(typeof module!=='undefined'&&module.exports) module.exports=Catalog;
