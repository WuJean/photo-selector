import React,{useEffect,useState} from 'react';
import {api,json} from './api';
import {TAG_CATEGORIES,CORE_TAGS} from '../../shared/tags.mjs';
export default function ClassificationSettings({notify}) {
 const [library,setLibrary]=useState(null),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false);
 useEffect(()=>{api('/projects/library/tags').then(setLibrary).catch(e=>notify(e.message));},[]);
 const run=async fn=>{setBusy(true);try{await fn();}catch(e){notify(e.message);}finally{setBusy(false);}};
 if(!library)return <p>正在加载标签…</p>;
 const update=(index,patch)=>setLibrary({...library,tags:library.tags.map((t,i)=>i===index?{...t,...patch}:t)});
 return <section className="classification-settings"><p>初筛入选后自动分类。标签库修改用于后续任务，已有结果保留。</p>
 {TAG_CATEGORIES.map(category=><details key={category}><summary>{category} · {library.tags.filter(t=>t.category===category).length}</summary>{library.tags.map((t,i)=>t.category!==category?null:<div className="tag-edit-row" key={i}><input aria-label={`${category}标签名称 ${i+1}`} value={t.name} disabled={CORE_TAGS.some(v=>v.name===t.name)} onChange={e=>update(i,{name:e.target.value})}/><input aria-label={`${t.name}定义`} value={t.description} onChange={e=>update(i,{description:e.target.value})}/>{!CORE_TAGS.some(v=>v.name===t.name)&&<button onClick={()=>setLibrary({...library,tags:library.tags.filter((_,j)=>j!==i)})}>移除</button>}</div>)}{!['主体','景别'].includes(category)&&<button className="button" onClick={()=>setLibrary({...library,tags:[...library.tags,{name:'新标签',description:'',category}]})}>添加标签</button>}</details>)}
 <button className="primary" disabled={busy} onClick={()=>run(async()=>{setLibrary(await api('/projects/library/tags',json('PUT',library)));notify('标签库已保存');})}>保存标签库</button>
 <hr/><button className="button" disabled={busy} onClick={()=>setConfirm(true)}>重新分类已有入选照片</button>
 {confirm&&<div role="alert"><p>将按已保存的标签库重新分类，可能产生 AI 服务费用。已有客观描述会复用。</p><button className="primary" disabled={busy} onClick={()=>run(async()=>{await api('/settings/classification/reanalyze',json('POST',{}));setConfirm(false);notify('重新分类已排队');})}>确认重新分类</button><button className="button" onClick={()=>setConfirm(false)}>取消</button></div>}
 </section>;
}
