import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const SYNC_SECRET = (Deno.env.get("GOOGLE_CALENDAR_SYNC_SECRET") || "").trim();
const admin = createClient(SB_URL, SERVICE_KEY);

function base64Url(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function hash(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  const channelId = req.headers.get("x-goog-channel-id") || "";
  const resourceId = req.headers.get("x-goog-resource-id") || "";
  const token = req.headers.get("x-goog-channel-token") || "";
  if (!channelId || !resourceId || !token || !SYNC_SECRET) return new Response(null, { status: 401 });
  const { data: connection } = await admin.from("smyl_google_calendar_connections")
    .select("id,channel_token_hash")
    .eq("channel_id", channelId)
    .eq("channel_resource_id", resourceId)
    .eq("status", "connected")
    .maybeSingle();
  if (!connection || connection.channel_token_hash !== await hash(token)) return new Response(null, { status: 401 });

  // Google espera una respuesta rápida. El trabajo real se dispara después de
  // validar el canal y es idempotente gracias a syncToken y la cola persistente.
  EdgeRuntime.waitUntil(fetch(`${SB_URL}/functions/v1/google-calendar-sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-smyl-calendar-secret": SYNC_SECRET },
    body: JSON.stringify({ connection_id: connection.id }),
  }).catch((error) => console.error("[google-calendar-webhook]", error)));
  return new Response(null, { status: 204 });
});
