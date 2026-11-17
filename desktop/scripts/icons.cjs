// Small original T glyph, rasterized directly; no downloaded assets.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const dir=path.resolve(__dirname,'../assets');fs.mkdirSync(dir,{recursive:true});
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;}
function chunk(name,bytes){const type=Buffer.from(name),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);type.copy(out,4);bytes.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([type,bytes])),bytes.length+8);return out;}
function png(color,size=256){
  const raw=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*(size*4+1)+1+x*4,px=(x+.5)*256/size,py=(y+.5)*256/size,cx=Math.max(48,Math.min(207,px)),cy=Math.max(48,Math.min(207,py));
    const inside=(px-cx)**2+(py-cy)**2<=48**2;
    const glyph=(px>=63&&px<193&&py>=65&&py<98)||(px>=110&&px<146&&py>=95&&py<194);
    const value=glyph?[255,255,255]:color;for(let k=0;k<3;k++)raw[i+k]=value[k];raw[i+3]=inside?255:0;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
for(const [name,color] of Object.entries({app:[198,91,101],active:[198,91,101],idle:[154,151,154],unknown:[184,142,67]}))fs.writeFileSync(path.join(dir,name+'.png'),png(color));
const sizes=[16,20,24,32,40,48,64,128,256],images=sizes.map(size=>png([198,91,101],size));
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){
 const entry=6+i*16;header[entry]=sizes[i]===256?0:sizes[i];header[entry+1]=header[entry];
 header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(images[i].length,entry+8);header.writeUInt32LE(offset,entry+12);offset+=images[i].length;
}
fs.writeFileSync(path.join(dir,'app.ico'),Buffer.concat([header,...images]));
