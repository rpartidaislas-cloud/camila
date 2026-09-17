-- Bucket para simulaciones dentales generadas por la integración LANA→CAMILA
-- (endpoint analizar-foto, disparado cuando un paciente manda foto por WhatsApp/Instagram).
-- Público: la URL se incluye en el callback a LANA y LANA la almacena en smyl_analisis;
-- el dentista accede a ella desde la cotización borrador en el panel de LANA.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'camila-analisis',
  'camila-analisis',
  true,
  5242880,  -- 5 MB por archivo
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Solo service_role puede escribir (el upload lo hace la Edge Function con service key).
-- Cualquiera puede leer (bucket público, para que LANA pueda leer la URL directa).
CREATE POLICY "analisis_insert_service" ON storage.objects
  FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'camila-analisis');

CREATE POLICY "analisis_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'camila-analisis');
