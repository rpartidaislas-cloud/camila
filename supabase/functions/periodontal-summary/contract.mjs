// A closed vocabulary prevents provider input and output from containing patient identity or clinical prose.
const sites = ['MB', 'B', 'DB', 'ML', 'L', 'DL'];
const sources = ['clinical', 'photo', 'radiograph'];
const fields = ['depth', 'margin', 'bleeding'];
const numberIn = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
const validField = (field, v) => field === 'bleeding' ? typeof v === 'boolean' : numberIn(v, field === 'margin' ? -20 : 0, 20);

export function providerFacts(input) {
  if (!Array.isArray(input) || !input.length || input.length > 15) return null;
  const result = [], keys = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    let fact;
    if (sources.includes(raw.kind)) {
      if (!numberIn(raw.count, 1, 999)) return null;
      fact = { kind: raw.kind, count: raw.count };
    } else {
      if (!['site', 'change'].includes(raw.kind) || !sites.includes(raw.site)) return null;
      fact = { kind: raw.kind, site: raw.site };
      for (const field of fields) {
        if (!Object.hasOwn(raw, field)) continue;
        if (!validField(field, raw[field])) return null;
        fact[field] = raw[field];
        if (raw.kind === 'change') {
          const prev = 'previous_' + field;
          if (!validField(field, raw[prev]) || raw[prev] === raw[field]) return null;
          fact[prev] = raw[prev];
        }
      }
      if (!fields.some(field => Object.hasOwn(fact, field))) return null;
    }
    const key = fact.kind + (fact.site || '');
    if (keys.has(key) || Object.keys(raw).length !== Object.keys(fact).length) return null;
    keys.add(key);
    result.push(fact);
  }
  for (const delta of result.filter(f => f.kind === 'change')) {
    const now = result.find(f => f.kind === 'site' && f.site === delta.site);
    if (!now || !fields.every(field => !Object.hasOwn(delta, field) || now[field] === delta[field])) return null;
  }
  return result.some(f => f.kind === 'site') ? result : null;
}

export function selectedFacts(response, facts) {
  const raw = response.output_text || response.output?.flatMap(block => block.content || []).find(item => item.type === 'output_text')?.text;
  if (typeof raw !== 'string') return null;
  let indices;
  try { indices = JSON.parse(raw).indices; } catch { return null; }
  if (!Array.isArray(indices) || !indices.length || indices.length > facts.length ||
      indices.some(n => !numberIn(n, 0, facts.length - 1)) || new Set(indices).size !== indices.length) return null;
  // Preserve clinician-confirmed sources and longitudinal changes even if the model overlooked them.
  const order = new Set(indices);
  if (!indices.some(n => facts[n].kind === 'site')) order.add(facts.findIndex(f => f.kind === 'site'));
  facts.forEach((f, n) => { if (f.kind !== 'site') order.add(n); });
  return [...order];
}
