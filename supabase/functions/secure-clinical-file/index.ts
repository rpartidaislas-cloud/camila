// Verifica archivos privados recién subidos antes de que puedan vincularse a datos clínicos.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

type Rule = { max: number; mime: string[] };
const RULES: Record<string, Rule> = {
  'smyl-case-photos': { max: 10 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp'] },
  'smyl-radiographs': { max: 20 * 1024 * 1024, mime: ['image/jpeg','image/png'] },
  'smyl-clinical-files': { max: 20 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp','application/pdf'] },
  'smyl-proposal-photos': { max: 8 * 1024 * 1024, mime: ['image/jpeg'] },
  'smyl-professional-cv': { max: 10 * 1024 * 1024, mime: ['application/pdf'] },
  'smyl-professional-cases': { max: 10 * 1024 * 1024, mime: ['image/jpeg','image/png','image/webp','application/pdf'] },
};

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function hex(bytes: Uint8Array): string { return Array.from(bytes).map((x) => x.toString(16).padStart(2,'0')).join(''); }
function detectedMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff && bytes[bytes.length-2]===0xff && bytes[bytes.length-1]===0xd9) return 'image/jpeg';
  if (bytes.length >= 20 && hex(bytes.slice(0,8))==='89504e470d0a1a0a' && new TextDecoder().decode(bytes.slice(-8,-4))==='IEND') return 'image/png';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP') return 'image/webp';
  if (bytes.length >= 8 && new TextDecoder().decode(bytes.slice(0,5))==='%PDF-' && new TextDecoder().decode(bytes.slice(-2048)).includes('%%EOF')) return 'application/pdf';
  return null;
}
function unsafePdf(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return /\/(JavaScript|JS|OpenAction|Launch|EmbeddedFile|RichMedia|XFA)\b/i.test(text);
}
async function mark(bucket: string,path: string,tenant: string,status: 'clean'|'rejected',details: Record<string, unknown>) {
  const row = { bucket_id: bucket, object_path: path, tenant_id: tenant, status, ...details, verified_at: new Date().toISOString() };
  const saved = await admin.from('smyl_file_security').upsert(row,{ onConflict:'bucket_id,object_path' });
  if (saved.error) throw saved.error;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok',{ headers:CORS });
  if (req.method !== 'POST') return reply(405,{ error:'Método no permitido.' });
  const auth = await requireUser(req,CORS);
  if (auth.response) return auth.response;
  try {
    const body = await req.json();
    const bucket = String(body?.bucket || '');
    const path = String(body?.path || '');
    const claimedMime = String(body?.mime_type || '').toLowerCase();
    const claimedSize = Number(body?.size_bytes);
    const claimedSha = String(body?.sha256 || '').toLowerCase();
    const rule = RULES[bucket];
    if (!rule || !path || path.length>700 || path.startsWith('/') || path.includes('..') || path.split('/')[0]!==auth.tenantId) return reply(400,{ error:'Ruta de archivo no válida.' });
    if (!rule.mime.includes(claimedMime) || !Number.isSafeInteger(claimedSize) || claimedSize<16 || claimedSize>rule.max || !/^[0-9a-f]{64}$/.test(claimedSha)) return reply(400,{ error:'Metadatos de archivo no válidos.' });
    const downloaded = await admin.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) return reply(404,{ error:'No se encontró el archivo privado.' });
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const mime = detectedMime(bytes);
    const sha = hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
    const rejected = bytes.length!==claimedSize ? 'El tamaño real no coincide.' : mime!==claimedMime ? 'El tipo real no coincide.' : sha!==claimedSha ? 'La huella del archivo no coincide.' : mime==='application/pdf' && unsafePdf(bytes) ? 'El PDF contiene acciones activas no permitidas.' : null;
    if (rejected) {
      await mark(bucket,path,auth.tenantId!,'rejected',{ verified_mime_type:mime,verified_size_bytes:bytes.length,verified_sha256:sha,rejection_reason:rejected,verified_by:auth.user!.id });
      await admin.storage.from(bucket).remove([path]);
      return reply(422,{ error:'El archivo no superó la verificación de seguridad.' });
    }
    await mark(bucket,path,auth.tenantId!,'clean',{ verified_mime_type:mime,verified_size_bytes:bytes.length,verified_sha256:sha,rejection_reason:null,verified_by:auth.user!.id });
    return reply(200,{ ok:true,mime_type:mime,size_bytes:bytes.length,sha256:sha });
  } catch (error) {
    console.error('[secure-clinical-file]',error instanceof Error?error.message:'error desconocido');
    return reply(500,{ error:'No se pudo verificar el archivo. Intenta de nuevo.' });
  }
});
