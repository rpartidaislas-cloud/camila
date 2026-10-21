// Verifica archivos privados recién subidos antes de que puedan vincularse a datos clínicos.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { FILE_RULES, inspectFile } from '../_shared/file-security.ts';
import { makeCors } from '../_shared/cors.ts';
const SB_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || '';
const SB_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || '';
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

async function mark(bucket: string,path: string,tenant: string,status: 'clean'|'rejected',details: Record<string, unknown>) {
  const checkedAt=new Date().toISOString();
  const row = { bucket_id: bucket, object_path: path, tenant_id: tenant, status, ...details, verified_at: checkedAt,last_checked_at:checkedAt,check_attempts:1 };
  const saved = await admin.from('smyl_file_security').upsert(row,{ onConflict:'bucket_id,object_path' });
  if (saved.error) throw saved.error;
}

Deno.serve(async (req: Request) => {
  const CORS = makeCors(req);
  const reply = (status: number, body: Record<string, unknown>): Response =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
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
    const rule = FILE_RULES[bucket];
    if (!rule || !path || path.length>700 || path.startsWith('/') || path.includes('..') || path.split('/')[0]!==auth.tenantId) return reply(400,{ error:'Ruta de archivo no válida.' });
    if (!rule.mime.includes(claimedMime) || !Number.isSafeInteger(claimedSize) || claimedSize<16 || claimedSize>rule.max || !/^[0-9a-f]{64}$/.test(claimedSha)) return reply(400,{ error:'Metadatos de archivo no válidos.' });
    const downloaded = await admin.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) return reply(404,{ error:'No se encontró el archivo privado.' });
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const inspected=await inspectFile(bytes,claimedMime,claimedSize,claimedSha);
    const mime=inspected.mime,sha=inspected.sha256,rejected=inspected.reason;
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
