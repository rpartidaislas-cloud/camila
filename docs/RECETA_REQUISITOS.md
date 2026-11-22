# Receta médica — requisitos legales y estado de verificación

> **Estado: NO VERIFICADO contra el texto oficial.** Estos requisitos se reunieron el 2026-11-22 con búsqueda web (resúmenes y citas
> de fuentes secundarias). Los sitios oficiales (diputados.gob.mx, dof.gob.mx, gob.mx, salud.gob.mx) estaban bloqueados en la red de la
> sesión. **Un abogado o asesor sanitario debe contrastarlos con el Diario Oficial antes de usar la receta con pacientes reales.**
> No es asesoría legal.

## Qué exige hoy SMYL (y dónde se aplica)

| # | Requisito | Fuente (secundaria) | Dónde se aplica | Confianza |
|---|---|---|---|---|
| 1 | Nombre completo, domicilio completo y cédula profesional de quien prescribe, impresos | Reglamento de Insumos para la Salud, art. 29 (varias fuentes; la numeración varía entre versiones) | `smyl_issue_prescription` (cédula del perfil; domicilio de la sucursal: calle y ciudad) | Media-alta |
| 2 | Fecha y firma autógrafa | Reglamento de Insumos, art. 29 | Fecha automática; la hoja deja espacio de firma y sello. Sin firma electrónica | Media-alta |
| 3 | Por medicamento: dosis, presentación, vía, frecuencia y duración | Reglamento de Insumos, art. 30; artículo SciELO sobre requisitos legales | Función SQL (rechaza si falta alguno) + validación espejo en `smyl-prescription-model.js` | Media-alta |
| 4 | Cantidad a surtir | Regla de SMYL (práctica de farmacia) | Función SQL | Regla propia |
| 5 | Nombre genérico | Un blog; no confirmado en fuente oficial | Función SQL (obligatorio); la marca es opcional | **Baja** |
| 6 | Los cirujanos dentistas pueden prescribir | Ley General de Salud, art. 240 (estupefacientes solo en casos odontológicos) y versiones del Reglamento de Insumos | Solo se emite con perfil de profesional activo, con cédula, vinculado al usuario | Media |
| 7 | Estupefacientes/psicotrópicos requieren recetario especial con código de barras | Ley General de Salud, arts. 240-241 | **SMYL no los emite**: lista de apoyo en SQL y en el modelo + declaración obligatoria del profesional | Media (la lista NO es legal) |
| 8 | Antibióticos: receta obligatoria, retención en farmacia, tratamiento ≤ 30 días | Acuerdo del 27-may-2010 (en vigor desde 25-ago-2010); guías | Se marcan y se limitan a 30 días; aviso en pantalla (no se imprime leyenda) | Media-baja |
| 9 | La receta forma parte del expediente (conservación mínima de 5 años) | NOM-004-SSA3-2012 (según guías) | Copia congelada, folio consecutivo, no editable (solo anulación con motivo), auditoría | Media |

## Lo que NO se pudo confirmar
- **Institución que expidió el título**: ninguna fuente la menciona como requisito. Puede estar en otro reglamento (atención médica, arts. 64-65). El campo existe en el perfil y se imprime, pero no es obligatorio.
- **Leyendas obligatorias** en la hoja: no se imprime ninguna (el módulo de impresión solo muestra las que se le pasan).
- **Vigencia de la receta** y reglas finas de fracciones II/III/IV (art. 226 LGS): no se implementan.
- **Folio obligatorio** en recetas de antibióticos: una guía lo menciona; SMYL ya numera todas las recetas.
- **Receta electrónica / firma electrónica**: fuentes contradictorias (blogs). Solo impresión con firma autógrafa.
- **Listas de controlados y de antibióticos** (`smyl_issue_prescription`, `smyl-prescription-model.js`): red de apoyo, no lista legal; pueden tener falsos negativos.

## Fuentes consultadas (todas secundarias en esta sesión)
- Reglamento de Insumos para la Salud (copias): farmacopea.org.mx/Repositorio/LegislacionFiles/RIS-05-VIII-08.pdf
- Ley General de Salud, arts. 226, 240, 241: diputados.gob.mx/LeyesBiblio/pdf/LGS.pdf (vía resúmenes de búsqueda; mley.mx; leyes-mx.com)
- Acuerdo de antibióticos (DOF 27-may-2010): farmacopea.org.mx/Repositorio/LegislacionFiles/Acuerdoantibiotic27may10.pdf
- «Prescripción y receta médica: una mirada a sus requisitos legales en México», SciELO México, 2024
- «Marco jurídico de la prescripción médica en odontología», Medigraphic, 2023

## Para el abogado / asesor sanitario
1. Contrastar la tabla con el texto vigente (DOF) y confirmar números de artículo.
2. ¿Es obligatoria la institución que expidió el título? ¿Y la cédula de especialidad?
3. ¿Qué leyendas deben imprimirse? ¿Aplica alguna a antibióticos?
4. ¿Basta firma autógrafa impresa o se acepta receta electrónica?
5. Confirmar las listas de controlados y de antibióticos.
6. Plazo de conservación de la copia en SMYL y quién la conserva (clínica vs. SMYL).
