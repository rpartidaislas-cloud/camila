export type FileRule = { max: number; mime: string[] };
export const FILE_RULES: Record<string, FileRule> = {
  'smyl-case-photos': { max: 10 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp'] },
  'smyl-radiographs': { max: 20 * 1024 * 1024, mime: ['image/jpeg','image/png'] },
  'smyl-clinical-files': { max: 20 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp','application/pdf'] },
  'smyl-proposal-photos': { max: 8 * 1024 * 1024, mime: ['image/jpeg'] },
  'smyl-professional-cv': { max: 10 * 1024 * 1024, mime: ['application/pdf'] },
  'smyl-professional-cases': { max: 10 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp','application/pdf'] },
};
export function bytesHex(bytes: Uint8Array): string { return Array.from(bytes).map((x)=>x.toString(16).padStart(2,'0')).join(''); }
export function detectMime(bytes: Uint8Array): string | null {
  if(bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9)return'image/jpeg';
  if(bytes.length>=20&&bytesHex(bytes.slice(0,8))==='89504e470d0a1a0a'&&new TextDecoder().decode(bytes.slice(-8,-4))==='IEND')return'image/png';
  if(bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return'image/webp';
  if(bytes.length>=8&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-'&&new TextDecoder().decode(bytes.slice(-2048)).includes('%%EOF'))return'application/pdf';
  return null;
}
export function unsafePdf(bytes: Uint8Array): boolean {
  return /\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile|RichMedia|XFA)\b/i.test(new TextDecoder('latin1').decode(bytes));
}
export async function inspectFile(bytes: Uint8Array,claimedMime?:string,claimedSize?:number,claimedSha?:string) {
  const mime=detectMime(bytes);
  const sha256=bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  const reason=claimedSize!==undefined&&bytes.length!==claimedSize?'El tamaño real no coincide.':claimedMime&&mime!==claimedMime?'El tipo real no coincide.':claimedSha&&sha256!==claimedSha?'La huella del archivo no coincide.':mime==='application/pdf'&&unsafePdf(bytes)?'El PDF contiene acciones activas no permitidas.':mime?null:'El formato real no está permitido.';
  return {mime,size:bytes.length,sha256,reason};
}
