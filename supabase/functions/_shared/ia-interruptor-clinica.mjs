// Interruptor de la IA de la clínica (task-id smyl-ia-interruptor). Lógica PURA, sin red ni Deno.
// El interruptor vive en LANA (`ia_interruptor`); SMYL lo consulta y lo cambia por `GET/PUT /ia/interruptor` de camila-api.

// Roles de SMYL que pueden apagar o encender la IA: el dueño de la clínica y el perfil administrador (rol de sistema `administrador`;
// el `propietario` ya cuenta como dueño). Cualquier otro (recepción, profesional, finanzas, sin rol) solo puede CONSULTAR el estado.
export const ROLES_DE_SISTEMA_ADMIN = Object.freeze(["propietario", "administrador"]);

/** @returns {"owner"|"admin"|null} el rol que se declara a LANA en X-SMYL-Actor-Role, o null si no puede cambiar el interruptor. */
export function rolParaInterruptor({ esDueno, codigosDeRol }) {
  if (esDueno === true) return "owner";
  const codigos = Array.isArray(codigosDeRol) ? codigosDeRol : [];
  return codigos.some((c) => ROLES_DE_SISTEMA_ADMIN.includes(String(c || "").toLowerCase())) ? "admin" : null;
}

// ¿Debe callar el asistente público del perfil? `lectura`: { vinculada, status, body }.
//   - Clínica sin LANA vinculada: no hay interruptor que consultar -> responde (no hay nada que la clínica haya podido apagar).
//   - 404: LANA todavía no tiene la ruta (orden de despliegue): responde, para no apagar a todas las clínicas por un despliegue pendiente.
//   - 200 con `negocio.apagada === true` o `global.apagada === true`: calla.
//   - Cualquier otra cosa (error de red, 5xx, 401/403, cuerpo ilegible): falla CERRADO, calla.
export function decidirAsistentePublico(lectura) {
  const l = lectura && typeof lectura === "object" ? lectura : {};
  if (l.vinculada === false) return { apagada: false, motivo: "sin_lana" };
  if (l.status === 404) return { apagada: false, motivo: "ruta_ausente" };
  const b = l.body && typeof l.body === "object" ? l.body : null;
  if (l.status !== 200 || !b || typeof b.negocio !== "object" || b.negocio === null) return { apagada: true, motivo: "error" };
  if (b.negocio.apagada === true) return { apagada: true, motivo: "negocio" };
  if (b.negocio.apagada !== false) return { apagada: true, motivo: "error" };
  if (b.global && b.global.apagada === true) return { apagada: true, motivo: "global" };
  return { apagada: false, motivo: "" };
}
