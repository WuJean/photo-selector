import { Worker } from 'node:worker_threads';
// Serialize the memory-heavy codec while ordinary uploads remain concurrent.
let tail=Promise.resolve();
export function decodeHeif(file,target) {
 const job=tail.then(()=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./heif-worker.mjs',import.meta.url),{workerData:{file,target},resourceLimits:{maxOldGenerationSizeMb:512}});
  const timer=setTimeout(()=>{worker.terminate();reject(new Error('HEIC 解码超时，请重试或导出为 JPEG'));},60000);
  const finish=(error)=>{clearTimeout(timer);worker.terminate();error?reject(error):resolve();};
  worker.once('message',result=>finish(result.error?new Error(result.error):null));
  worker.once('error',finish);
  worker.once('exit',code=>{clearTimeout(timer); if(code)reject(new Error('HEIC 解码失败'));});
 }));
 tail=job.catch(()=>{}); return job;
}
