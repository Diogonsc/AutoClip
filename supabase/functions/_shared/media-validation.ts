import jpegDecode, { init as initJpeg } from 'npm:@jsquash/jpeg@1.6.0/decode.js';
import pngDecode, { init as initPng } from 'npm:@jsquash/png@3.1.1/decode.js';
import webpDecode, { init as initWebp } from 'npm:@jsquash/webp@1.5.0/decode.js';
import { copyToArrayBuffer } from './bytes.ts';

export const MEDIA_VALIDATOR_VERSION = 'autoclip-image-wasm-1';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_000_000;

export interface ValidatedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sha256: string;
  size: number;
}

function dimensions(data: Uint8Array, mime: ValidatedImage['mime']): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (mime === 'image/png') {
    if (data.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i)=>data[i]===v)
      || String.fromCharCode(...data.slice(12,16)) !== 'IHDR') throw new Error('PNG_SIGNATURE_OR_HEADER_INVALID');
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mime === 'image/webp') {
    if (data.length < 30 || String.fromCharCode(...data.slice(0,4)) !== 'RIFF'
      || String.fromCharCode(...data.slice(8,12)) !== 'WEBP') throw new Error('WEBP_CONTAINER_INVALID');
    let offset=12;
    while(offset+8<=data.length) {
      const chunk=String.fromCharCode(...data.slice(offset,offset+4));
      const size=view.getUint32(offset+4,true); const start=offset+8;
      if(start+size>data.length) throw new Error('WEBP_CHUNK_TRUNCATED');
      if(chunk==='VP8X' && size>=10) return [1+data[start+4]+(data[start+5]<<8)+(data[start+6]<<16),1+data[start+7]+(data[start+8]<<8)+(data[start+9]<<16)];
      if(chunk==='VP8 ' && size>=10 && data[start+3]===0x9d && data[start+4]===0x01 && data[start+5]===0x2a) return [view.getUint16(start+6,true)&0x3fff,view.getUint16(start+8,true)&0x3fff];
      if(chunk==='VP8L' && size>=5 && data[start]===0x2f) { const b1=data[start+1],b2=data[start+2],b3=data[start+3],b4=data[start+4]; return [1+(((b2&0x3f)<<8)|b1),1+(((b4&0x0f)<<10)|(b3<<2)|((b2&0xc0)>>6))]; }
      offset=start+size+(size%2);
    }
    throw new Error('WEBP_IMAGE_HEADER_INVALID');
  }
  if (data.length < 4 || data[0]!==0xff || data[1]!==0xd8) throw new Error('JPEG_SIGNATURE_INVALID');
  let i=2;
  while(i+4<=data.length) {
    if(data[i]!==0xff) { i++; continue; }
    while(data[i]===0xff) i++;
    const marker=data[i++];
    if(marker===0xd9 || marker===0xda) break;
    if(marker===0x01 || (marker>=0xd0 && marker<=0xd7)) continue;
    if(i+2>data.length) throw new Error('JPEG_TRUNCATED');
    const length=view.getUint16(i); if(length<2 || i+length>data.length) throw new Error('JPEG_SEGMENT_TRUNCATED');
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if(length<7) throw new Error('JPEG_SOF_INVALID');
      return [view.getUint16(i+5),view.getUint16(i+3)];
    }
    i+=length;
  }
  throw new Error('JPEG_DIMENSIONS_MISSING');
}

async function initDecoders() {
  const load = async (specifier: string) => WebAssembly.compile(await Deno.readFile(new URL(import.meta.resolve(specifier))));
  await Promise.all([
    initJpeg(await load('npm:@jsquash/jpeg@1.6.0/codec/dec/mozjpeg_dec.wasm')),
    initPng(await load('npm:@jsquash/png@3.1.1/codec/pkg/squoosh_png_bg.wasm')),
    initWebp(await load('npm:@jsquash/webp@1.5.0/codec/dec/webp_dec.wasm')),
  ]);
}
let decoders: Promise<void> | undefined;

export async function validateImage(data: Uint8Array, claimedMime: string): Promise<ValidatedImage> {
  if(data.byteLength===0) throw new Error('EMPTY_FILE');
  if(data.byteLength>MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
  if(!['image/jpeg','image/png','image/webp'].includes(claimedMime)) throw new Error('IMAGE_MIME_UNSUPPORTED');
  const mime=claimedMime as ValidatedImage['mime'];
  const [width,height]=dimensions(data,mime);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<360||height<360||width>MAX_DIMENSION||height>MAX_DIMENSION||width*height>MAX_PIXELS) throw new Error('IMAGE_DIMENSIONS_UNSUPPORTED');
  decoders ??= initDecoders();
  await decoders;
  const decoderInput = copyToArrayBuffer(data);
  const decoded = mime==='image/jpeg' ? await jpegDecode(decoderInput) : mime==='image/png' ? await pngDecode(decoderInput) : await webpDecode(decoderInput);
  if(decoded.width!==width||decoded.height!==height||!decoded.data||decoded.data.byteLength<width*height*4) throw new Error('IMAGE_DECODE_INVALID');
  const digest=await crypto.subtle.digest('SHA-256',copyToArrayBuffer(data));
  const sha256=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  return {mime,width,height,sha256,size:data.byteLength};
}
