import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import libheif from 'libheif-js';
import sharp from 'sharp';
try {
 const images = new libheif.HeifDecoder().decode(await readFile(workerData.file));
 const image = images[0];
 if (!image) throw new Error('HEIC 图片无法解码');
 const width=image.get_width(),height=image.get_height();
 if (!width || !height || width*height>120000000) throw new Error('图片尺寸超过限制');
 const decoded = await new Promise((resolve,reject)=>image.display({data:new Uint8ClampedArray(width*height*4),width,height}, result=>result?resolve(result):reject(new Error('HEIC 图片无法解码'))));
 await sharp(Buffer.from(decoded.data),{raw:{width,height,channels:4}}).toColourspace('srgb').jpeg({quality:95}).toFile(workerData.target);
 parentPort.postMessage({ok:true});
} catch(e) { parentPort.postMessage({error:e.message}); }
