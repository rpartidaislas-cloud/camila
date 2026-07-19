import { requireUser } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Modelos Gemini para generación de imagen (en orden de preferencia)
const GEMINI_IMAGE_MODELS = [
  { name: "gemini-2.5-flash-image", modalities: ["TEXT", "IMAGE"] },
  { name: "gemini-3.1-flash-image", modalities: ["TEXT", "IMAGE"] },
  { name: "gemini-3-pro-image",     modalities: ["TEXT", "IMAGE"] },
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Esta función gasta dinero real (Anthropic y Gemini). Sin esta verificación
  // respondía a un POST a pelo, sin ningún header, desde cualquier lado.
  const { user, response: authError } = await requireUser(req, CORS);
  if (authError) return authError;

  try {
    const body = await req.json();
    console.log("Llamada de:", user!.id);
    console.log("Body keys:", Object.keys(body).join(", "));

    // ── GENERAR IMAGEN CON GEMINI ──────────────────────────────────────────
    if (body.action === "generate_image") {
      const KEY = Deno.env.get("GEMINI_API_KEY");
      if (!KEY) {
        return new Response(JSON.stringify({ error: "GEMINI_API_KEY no configurada en Supabase Secrets" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 500
        });
      }

      const { imageBase64, mimeType = "image/jpeg", prompt = "Mejora la sonrisa dental con carillas naturales" } = body;
      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "imageBase64 requerido" }), {
          headers: { ...CORS, "Content-Type": "application/json" }, status: 400
        });
      }

      for (const model of GEMINI_IMAGE_MODELS) {
        console.log(`Intentando Gemini: ${model.name}`);
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent?key=${KEY}`;
          const gBody = {
            contents: [{
              parts: [
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
                { text: prompt }
              ]
            }],
            generationConfig: {
              responseModalities: model.modalities,
              temperature: 1,
            }
          };

          const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gBody)
          });
          const data = await resp.json();

          if (!resp.ok) {
            console.warn(`Gemini ${model.name} error:`, data.error?.message);
            continue;
          }

          const parts = data.candidates?.[0]?.content?.parts ?? [];
          const imgPart = parts.find((p: any) => p.inlineData);
          if (!imgPart) {
            console.warn(`Gemini ${model.name}: sin imagen en respuesta`);
            continue;
          }

          console.log(`✓ Gemini ${model.name} OK`);
          return new Response(JSON.stringify({
            imageBase64: imgPart.inlineData.data,
            mimeType: imgPart.inlineData.mimeType || "image/png",
            source: "gemini",
            model: model.name,
          }), { headers: { ...CORS, "Content-Type": "application/json" } });

        } catch (e: any) {
          console.warn(`Gemini ${model.name} excepción:`, e.message);
          continue;
        }
      }

      return new Response(JSON.stringify({
        error: "Gemini no pudo generar la imagen. Revisa los logs."
      }), { headers: { ...CORS, "Content-Type": "application/json" }, status: 500 });
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