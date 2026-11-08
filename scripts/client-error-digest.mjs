// Resumen de los errores de JavaScript del panel (smyl_client_errors) de las últimas 24 h, para la alerta diaria.
// Sólo formatea: la consulta y el envío viven en .github/workflows/smyl-alertas-errores-cliente.yml.

export const CONSULTA_ERRORES_24H = `select kind, message, coalesce(source, '') as source, coalesce(line, 0) as line,
  count(*)::int as n, count(distinct user_id)::int as usuarios, count(distinct tenant_id)::int as clinicas,
  max(created_at) as ultimo, coalesce(max(route), '') as ruta
from public.smyl_client_errors
where created_at > now() - interval '24 hours'
group by kind, message, coalesce(source, ''), coalesce(line, 0)
order by n desc, ultimo desc
limit 20`;

const recortar = (texto, max) => {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

// grupos: filas de CONSULTA_ERRORES_24H. umbral: mínimo de errores totales para considerarlo alerta.
export function resumirErrores(grupos, umbral = 1) {
  const filas = Array.isArray(grupos) ? grupos : [];
  const total = filas.reduce((s, g) => s + (Number(g.n) || 0), 0);
  const clinicas = Math.max(0, ...filas.map((g) => Number(g.clinicas) || 0));
  const alerta = total >= Math.max(1, Number(umbral) || 1);
  const lineas = [];
  if (!filas.length) {
    lineas.push('Sin errores de JavaScript del panel en las últimas 24 horas.');
  } else {
    lineas.push(`Errores de JavaScript del panel SMYL en las últimas 24 h: ${total} en ${filas.length} grupo(s) distinto(s).`);
    filas.forEach((g, i) => {
      const donde = g.source ? ` · ${recortar(g.source.split('/').pop(), 60)}${g.line ? ':' + g.line : ''}` : '';
      const ruta = g.ruta ? ` · pantalla: ${recortar(g.ruta, 30)}` : '';
      lineas.push(`${i + 1}. [${g.kind}] ${recortar(g.message, 160)}${donde}${ruta} — ${g.n} vez/veces, ${g.usuarios} usuario(s), ${g.clinicas} clínica(s)`);
    });
    lineas.push('Detalle completo en la tabla smyl_client_errors (SQL Editor de Supabase).');
  }
  return { total, grupos: filas.length, clinicas, alerta, texto: lineas.join('\n') };
}
