# Decision log — dental catalog

- Orchestrator: Codex; implementación única en rama `codex/dental-service-catalog`.
- Explorer: inventario de agenda, catálogo, odontograma, plan, propuesta y finanzas.
- Dental product specialist: taxonomía, unidades clínicas, trazabilidad y límites.
- Reviewer: RLS, permisos, snapshots, CFDI, baseline y riesgos de despliegue.
- Gate 0: no producción hasta recuperar/introspectar el esquema clínico canónico.
- Gate 1: catálogo v1 aditivo y opt-in; ninguna plantilla diagnostica o prescribe.
- Gate 2: claves SAT editables y fiscalmente pendientes hasta validación humana.
- Gate 3: propuesta schema 2 solo después de comprobar funciones y policies reales.
- Gate 4: pruebas independientes, responsive y paridad web/PWA antes de desplegar.

