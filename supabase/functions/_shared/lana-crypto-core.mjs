// Cifrado de la credencial de LANA con rotación de llave (sin dependencias de Deno: se prueba en Node).
//
// Variables de entorno:
//   SMYL_LANA_ENCRYPTION_KEY                 llave vigente (32 bytes en base64)
//   SMYL_LANA_ENCRYPTION_KEY_VERSION         etiqueta de la vigente (por omisión "1")
//   SMYL_LANA_ENCRYPTION_KEY_PREVIOUS        llave anterior, solo mientras dura la rotación (opcional)
//   SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION etiqueta de la anterior (por omisión: la vigente menos 1 si es número)
//
// Cada credencial guarda `key_version`. Las anteriores a este cambio no la tienen y se tratan como la versión "1".

export const LEGACY_KEY_VERSION = "1";

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cleanVersion(value) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(text)) return "";
  return text;
}

export function readKeyring(env = {}) {
  const currentB64 = String(env.SMYL_LANA_ENCRYPTION_KEY || "").trim();
  if (!currentB64) throw new Error("SMYL_LANA_ENCRYPTION_KEY no configurada.");
  const currentVersion = cleanVersion(env.SMYL_LANA_ENCRYPTION_KEY_VERSION || LEGACY_KEY_VERSION);
  if (!currentVersion) throw new Error("SMYL_LANA_ENCRYPTION_KEY_VERSION no es válida.");
  const keys = [{ version: currentVersion, b64: currentB64, current: true }];
  const previousB64 = String(env.SMYL_LANA_ENCRYPTION_KEY_PREVIOUS || "").trim();
  if (previousB64) {
    let previousVersion = cleanVersion(env.SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION);
    if (!previousVersion && /^\d+$/.test(currentVersion) && Number(currentVersion) > 1) previousVersion = String(Number(currentVersion) - 1);
    if (!previousVersion) throw new Error("Falta SMYL_LANA_ENCRYPTION_KEY_PREVIOUS_VERSION.");
    if (previousVersion === currentVersion) throw new Error("La llave anterior y la vigente no pueden tener la misma versión.");
    if (previousB64 === currentB64) throw new Error("La llave anterior es igual a la vigente.");
    keys.push({ version: previousVersion, b64: previousB64, current: false });
  }
  for (const key of keys) {
    if (base64ToBytes(key.b64).length !== 32) throw new Error(`La llave de versión ${key.version} debe contener 32 bytes.`);
  }
  return { keys, currentVersion };
}

export function storedKeyVersion(lana) {
  return cleanVersion(lana?.key_version) || LEGACY_KEY_VERSION;
}

async function importKey(subtle, key, usages) {
  return subtle.importKey("raw", base64ToBytes(key.b64), "AES-GCM", false, usages);
}

export async function encryptLanaKey(apiKey, keyring, { subtle = globalThis.crypto.subtle, random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) } = {}) {
  const current = keyring.keys.find((key) => key.current);
  const iv = random(12);
  const encrypted = await subtle.encrypt({ name: "AES-GCM", iv }, await importKey(subtle, current, ["encrypt"]), new TextEncoder().encode(apiKey));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv), key_version: current.version };
}

// Primero la llave que la credencial dice tener; si falla (p. ej. una versión mal anotada) prueba las demás.
export async function decryptLanaKey(lana, keyring, { subtle = globalThis.crypto.subtle } = {}) {
  const wanted = storedKeyVersion(lana);
  const ordered = [...keyring.keys].sort((a, b) => Number(b.version === wanted) - Number(a.version === wanted));
  const iv = base64ToBytes(lana.api_key_iv);
  const data = base64ToBytes(lana.api_key_ciphertext);
  for (const key of ordered) {
    try {
      const clear = await subtle.decrypt({ name: "AES-GCM", iv }, await importKey(subtle, key, ["decrypt"]), data);
      return { apiKey: new TextDecoder().decode(clear), key_version: key.version, needsReencrypt: !key.current };
    } catch { /* siguiente llave */ }
  }
  throw new Error("No se pudo descifrar la credencial de LANA con las llaves configuradas.");
}

// Devuelve la credencial ya cifrada con la llave vigente (o null si ya lo estaba).
export async function reencryptIfNeeded(lana, keyring, deps = {}) {
  const decrypted = await decryptLanaKey(lana, keyring, deps);
  const stale = decrypted.needsReencrypt || storedKeyVersion(lana) !== keyring.currentVersion || !lana.key_version;
  if (!stale) return null;
  const encrypted = await encryptLanaKey(decrypted.apiKey, keyring, deps);
  return { ...lana, api_key_ciphertext: encrypted.ciphertext, api_key_iv: encrypted.iv, key_version: encrypted.key_version };
}
