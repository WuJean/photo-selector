export * from '../../shared/domain.mjs';
export * from '../../shared/layout.mjs';
export * from '../../shared/pairing.mjs';
export * from '../../shared/tags.mjs';
export * from '../../shared/immersive.mjs';
export function visibleCards(photos,expanded=[]){const groups=new Map();for(const p of photos){const key=p.similarId||p.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}return [...groups].flatMap(([id,members])=>expanded.includes(id)?members.map(p=>({...p,count:members.length,groupId:id,expanded:true})):[{...members[0],count:members.length,groupId:id,expanded:false}]);}
