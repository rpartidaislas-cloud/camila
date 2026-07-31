import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Modelo de OpenAI para generación/edición de imagen
const OPENAI_IMAGE_MODEL = "gpt-image-1";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Esta función gasta dinero real (Anthropic y OpenAI). Sin esta verificación
  // respondía a un POST a pelo, sin ningún header, desde cualquier lado.
  const { user, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;

  try {
    const body = await req.json();
    console.log("Llamada de:", user?.id);
    console.log("Body keys:", Object.keys(body).join(", "));

    // ── GENERAR IMAGEN CON CHATGPT (gpt-image-1) ────────────────────────────
    if (body.action === "generate_image") {
      const KEY = Deno.env.get("OPENAI_API_KEY");
      if (!KEY) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY no configurada en Supabase Secrets" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 500
        });
      }

      const { imageBase64, mimeType = "image/jpeg", prompt = "Mejora la sonrisa dental con carillas naturales" } = body;
      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "imageBase64 requerido" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 400
        });
      }

      try {
        console.log(`Intentando OpenAI: ${OPENAI_IMAGE_MODEL}`);
        const bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
        const imageBlob = new Blob([bytes], { type: mimeType });

        const form = new FormData();
        form.append("model", OPENAI_IMAGE_MODEL);
        form.append("image", imageBlob, "foto.jpg");
        form.append("prompt", prompt);
        form.append("size", "auto");
        // PRUEBA (reversible -- para volver a "high" solo hay que cambiar
        // esta línea y redesplegar): "medium" genera en ~20-40s en vez de
        // 1-2 minutos, a cambio de un poco menos de detalle/realismo que
        // "high". "high" sigue siendo la opción recomendada para el
        // resultado final si el realismo importa más que la velocidad.
        form.append("quality", "medium");
        form.append("input_fidelity", "high");
        form.append("n", "1");

        const resp = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { "Authorization": `Bearer ${KEY}` },
          body: form,
        });
        const data = await resp.json();

        if (!resp.ok) {
          console.error("OpenAI error:", JSON.stringify(data.error));
          return new Response(JSON.stringify({
            error: data.error?.message || "OpenAI no pudo generar la imagen."
          }), { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 });
        }

        const b64 = data.data?.[0]?.b64_json;
        if (!b64) {
          console.warn("OpenAI: sin imagen en respuesta");
          return new Response(JSON.stringify({
            error: "OpenAI no devolvió ninguna imagen."
          }), { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 });
        }

        console.log(`✓ OpenAI ${OPENAI_IMAGE_MODEL} OK`);
        return new Response(JSON.stringify({
          imageBase64: b64,
          mimeType: "image/png",
          source: "openai",
          model: OPENAI_IMAGE_MODEL,
        }), { headers: { ...CORS, "Content-Type": "application/json" } });

      } catch (e: any) {
        console.error("OpenAI excepción:", e.message);
        return new Response(JSON.stringify({
          error: "OpenAI no pudo generar la imagen. Revisa los logs."
        }), { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 });
      }
    }

    // ── CLAUDE / ANTHROPIC ─────────────────────────────────────────────────
    const CLAUDE_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!CLAUDE_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
        headers: { ...CORS, "Content-Type": "application/json" }, status: 500
      });
    }

    let anthropicBody: any;
    if (body.messages) {
      anthropicBody = {
        model: body.model || "claude-opus-4-5",
        max_tokens: body.max_tokens || 4096,
        messages: body.messages,
      };
      if (body.system) anthropicBody.system = body.system;
    } else {
      const { systemPrompt, userMessage, imageBase64: imgB64, imageMimeType } = body;
      const msgText = (typeof userMessage === "string" && userMessage.trim())
        ? userMessage : "Analiza esta imagen clínica dental.";
      const messages = imgB64
        ? [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: imageMimeType || "image/jpeg", data: imgB64 } },
            { type: "text", text: msgText }
          ]}]
        : [{ role: "user", content: msgText }];
      anthropicBody = {
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: systemPrompt || "Eres un asistente dental especializado.",
        messages,
      };
    }

    console.log("Claude — modelo:", anthropicBody.model);
    const cResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });
    const cData = await cResp.json();
    if (!cResp.ok) {
      console.error("Claude error:", JSON.stringify(cData));
      return new Response(JSON.stringify({ error: cData.error?.message || "Claude error" }), {
        headers: { ...CORS, "Content-Type": "application/json" }, status: 500
      });
    }
    return new Response(JSON.stringify(cData), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("Excepción:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
    });
  }
});