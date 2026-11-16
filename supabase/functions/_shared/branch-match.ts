// Reconoce a qué sucursal se refiere un paciente cuando contesta «¿en cuál sucursal te atendemos?».
// Determinístico y auditable: solo asigna cuando el mensaje nombra UNA sucursal sin ambigüedad.
export interface BranchRef { id: string; name: string }

const GENERIC_IN_NAME = new Set(["sucursal", "sede", "clinica", "consultorio", "dental"]);
const FILLER = new Set(["de", "del", "la", "el", "los", "las", "en", "a", "al", "por", "para", "me", "quiero", "prefiero", "mejor"]);

export function tokens(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// Palabras que identifican a la sucursal (sin «sucursal», «sede», «clínica»…). Si no queda ninguna, se usa el nombre completo.
function keyOf(name: string): string[] {
  const all = tokens(name).filter((word) => !FILLER.has(word));
  const key = all.filter((word) => !GENERIC_IN_NAME.has(word));
  return key.length ? key : all;
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (!phrase.length || phrase.length > haystack.length) return false;
  for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    if (phrase.every((word, j) => haystack[i + j] === word)) return true;
  }
  return false;
}

export function matchBranch(text: string, branches: BranchRef[]): BranchRef | null {
  const spoken = tokens(text);
  const words = spoken.filter((word) => !FILLER.has(word)); // «plaza sol» también reconoce «plaza del sol»
  const hits = branches
    .map((branch) => ({ branch, key: keyOf(branch.name) }))
    .filter(({ key }) => key.length && (containsPhrase(spoken, key) || containsPhrase(words, key)));
  // «Centro» y «Centro Norte»: si una coincide solo porque está contenida en otra que también coincide, gana la más específica.
  const specific = hits.filter((hit) => !hits.some((other) => other !== hit && other.key.length > hit.key.length && containsPhrase(other.key, hit.key)));
  return specific.length === 1 ? specific[0].branch : null;
}

// Revisa los últimos mensajes del paciente (de más nuevo a más viejo) y devuelve la primera sucursal inequívoca.
export function matchBranchInMessages(messages: { role?: string; content?: string }[], branches: BranchRef[], limit = 15): BranchRef | null {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0 && seen < limit; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    seen += 1;
    const hit = matchBranch(String(message.content || ""), branches);
    if (hit) return hit;
  }
  return null;
}
