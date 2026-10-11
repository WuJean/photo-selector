import sharp from 'sharp';
import exifr from 'exifr';
import { createHash } from 'node:crypto';
import { focalCategory } from '../../shared/domain.mjs';
import { cvFeatures } from '../../server/analysis.mjs';
export async function inspectImage(cloud,fileID){
  const {fileContent:bytes}=await cloud.downloadFile({fileID});
  if(bytes.length>50*1024*1024)throw new Error('图片大于 50 MB');
  const img=sharp(bytes,{limitInputPixels:120000000}), m=await img.metadata();
  if(!['jpeg','png','heif','webp'].includes(m.format))throw new Error('不支持此图片格式');
  const exif=await exifr.parse(bytes).catch(()=>null)||{};
  const rotated=await img.rotate().jpeg().toBuffer();
  const size=await sharp(rotated).metadata();
  const root=fileID.slice(fileID.indexOf('/',8)+1).replace('/originals/','/derived/');
  const upload=async (edge,suffix)=>(await cloud.uploadFile({cloudPath:root+suffix,fileContent:await sharp(rotated).resize(edge,edge,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer()})).fileID;
  const [thumbFile,previewFile,features]=await Promise.all([upload(480,'.thumb.jpg'),upload(1536,'.preview.jpg'),cvFeatures(rotated)]);
  return {width:size.width,height:size.height,size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex'),thumbFile,previewFile,...features,focal:exif.FocalLength||null,focalEquivalent:exif.FocalLengthIn35mmFormat||null,focalCategory:focalCategory(exif.FocalLengthIn35mmFormat,exif.FocalLength),camera:[exif.Make,exif.Model].filter(Boolean).join(' '),lens:exif.LensModel||'',aperture:exif.FNumber||null,iso:exif.ISO||null,shutter:exif.ExposureTime||null,takenAt:exif.DateTimeOriginal?.toISOString?.()||null};
}
