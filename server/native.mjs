import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export class NativeBridge {
 constructor(binary=path.resolve('.build/release/VisionWorker')) {this.binary=binary;this.pending=new Map();this.available=process.platform==='darwin'&&existsSync(binary);}
 start(){
  if(this.child)return;
  if(!this.available)throw new Error('本地 Vision 未构建，请运行 npm run build:vision');
  const child=spawn(this.binary,[],{stdio:['pipe','pipe','ignore']});this.child=child;
  createInterface({input:child.stdout}).on('line',line=>{try{const message=JSON.parse(line);const p=this.pending.get(message.id);if(p){clearTimeout(p.timer);this.pending.delete(message.id);message.error?p.reject(new Error(message.error)):p.resolve(message);}}catch{}});
  child.on('error',e=>this.fail(e));child.on('exit',()=>{this.child=null;this.fail(new Error('本地模型进程已退出'));});
 }
 fail(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
 request(value){this.start();return new Promise((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('本地处理超时'));},60_000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({...value,id})+'\n');});}
 close(){this.child?.kill();this.child=null;this.fail(new Error('服务已停止'));}
}
