import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../public/bundled-references/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
for(const entry of manifest){
 const file=new URL(entry.video.file,root);
 const valid=async()=>{try {return (await stat(file)).size===entry.video.sizeBytes&&createHash('sha256').update(await readFile(file)).digest('hex')===entry.video.sha256;}catch{return false;}};
 if(await valid()){console.log(`${entry.title}: MV 已就緒`);continue;}
 const response=await fetch(`https://github.com/tonymasing/songzu-music-os/releases/download/v0.32.19.001/${entry.video.file}`);
 if(!response.ok)throw Error(`下載失敗: ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==entry.video.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==entry.video.sha256)throw Error('MV 檔案校驗失敗');
 const tmp=new URL(entry.video.file+'.download',root);await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,file);console.log(`${entry.title}: MV 下載完成`);
}
