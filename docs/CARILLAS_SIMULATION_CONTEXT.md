# Carillas dentales — documento de contexto técnico para simulación (CAMILA)

> Documento de referencia clínica/estética recopilado de fuentes académicas y técnicas para alimentar el contexto de desarrollo del simulador de carillas de CAMILA. Usa guía de color VITA Classical como estándar por el momento.

---

## 1. Guía de color VITA Classical (A1–D4)

Es el sistema de referencia más usado en odontología para determinar y comunicar el color dental. Agrupa 16 tonos naturales en 4 familias por **matiz (hue)**, y dentro de cada familia el número indica **croma/oscuridad** creciente (1 = más claro, 4 = más oscuro).

| Familia | Matiz (hue) | Tonos |
|---|---|---|
| A | Marrón-rojizo | A1, A2, A3, A3.5, A4 |
| B | Amarillo-rojizo | B1, B2, B3, B4 |
| C | Grisáceo | C1, C2, C3, C4 |
| D | Gris-rojizo | D2, D3, D4 |

**Orden por valor (luminosidad), de más claro a más oscuro:**

```text
B1 → A1 → B2 → D2 → A2 → C1 → C2 → D4 → A3 → D3 → B3 → A3.5 → B4 → C3 → A4 → C4
```

Notas prácticas para la simulación:

- **A1 y B1** son los tonos más claros y los más solicitados en carillas estéticas. A1 tiene un matiz cálido-marfil natural; B1 es el blanco más brillante y frío de la guía natural.
- **A2** se considera cercano al tono promedio de un adulto sin tratamiento estético.
- **A3 / A3.5** son tonos más cálidos, típicos de dientes no tratados o con exposición a café, vino o tabaco.
- Existe **VITA 3D-Master**, con 26 tonos organizados por Luminosidad, Croma y Matiz, útil si en el futuro se requiere mayor precisión.
- Existen **VITA Bleached Shades** (0M1, 0M2, 0M3) para resultados más allá del rango natural.
- El umbral de percepción típico usado en estudios es **ΔE00 ≈ 2.5**.
- No existe una tabla RGB/hex oficial de VITA de dominio público; para simulación visual conviene una paleta aproximada calibrada contra fotografías clínicas reales.

---

## 2. Tipos de carillas y espesores clínicos

### Por material

- **Porcelana feldespática:** excelente reproducción de translucidez y opalescencia; referencia histórica para casos de alta exigencia estética.
- **Disilicato de litio (e.max):** mayor resistencia mecánica y buena estética; habitual en espesores mínimos a moderados.
- **Composite:** aplicación directa, económica y reparable, con menor estabilidad de color y desgaste que la cerámica.

### Por diseño de preparación

| Clase | Reducción de esmalte | Descripción |
|---|---|---|
| Sin preparación (no-prep) | 0–0.3 mm | Conserva 95–100% del esmalte; requiere posición favorable y cambio limitado. |
| Mínimamente invasiva | 0.3–0.5 mm | Conserva 80–95% del esmalte; útil cuando la posición o forma no permiten el diseño ideal sin preparación. |
| Preparación convencional | 0.5–0.7 mm | Permite mayor cambio de tono y forma; margen chamfer aproximado de 0.3 mm. |

Puntos clínicos relevantes:

- El espesor mínimo fabricable de forma predecible ronda **0.5 mm**.
- Cuanto mayor el cambio de tono, mayor preparación o espesor suele requerirse para enmascarar el sustrato.
- El borde incisal normalmente se prepara con una leve inclinación palatina para permitir estratificación.

---

## 3. Proporciones estéticas y diseño de sonrisa

### 3.1 Relación ancho/alto del incisivo central

- Proporción preferida: **75–78%**.
- Rango aceptable: **75–80%**.

### 3.2 Proporción áurea

- El lateral se muestra aproximadamente al **62%** del ancho visible del central.
- El canino se muestra aproximadamente al **62%** del ancho visible del lateral.
- No debe imponerse rígidamente: suele producir laterales demasiado angostos.

### 3.3 Proporción RED

- La reducción entre dientes sucesivos puede ser de **62–80%**, de forma consistente.
- Personas altas o dientes largos: RED de **62%**.
- Promedio: RED de **70%**.
- Personas bajas o dientes cortos: RED de **80%**.
- Para CAMILA se recomienda RED configurable, con valor inicial de **70%**.

### 3.4 Golden Percentage (Snow)

| Diente | % del ancho total visible |
|---|---|
| Canino (cada uno) | 10% |
| Lateral (cada uno) | 15% |
| Central (cada uno) | 25% |

### 3.5 Referencias de tamaño

- Ancho promedio del incisivo central: **~8.6 mm**.
- Ancho promedio del lateral: **~6.7 mm**.
- Ancho promedio del canino: **~7.7 mm**.
- Regla de House: altura del central ≈ 1/16 de la distancia tricion-mentón; ancho ≈ 1/16 del ancho intercigomático.

Ninguna proporción fija predice perfectamente una sonrisa natural. La proporción RED flexible se adapta mejor a cada paciente.

---

## 4. Protocolo fotográfico tipo DSD

### Fotografías recomendadas

1. Vista frontal en reposo o retraída.
2. Vista frontal de sonrisa completa.
3. Vista lateral.
4. Vista de las 12 en punto para relación borde incisal–labio inferior.

### Líneas de referencia

1. Plano interpupilar.
2. Línea media facial mediante glabela, nariz y mentón.
3. Transferencia de la cruz facial a la fotografía intraoral.
4. Línea del borde incisal de los centrales.
5. Línea de zenits gingivales de caninos.
6. Rectángulo de proporción ideal, ancho/alto aproximado de 78–80%.

Reglas clínicas:

- El borde incisal del central superior se recomienda a la altura del borde húmedo-seco del labio inferior en reposo.
- El arco de sonrisa debe armonizar con la curvatura del labio inferior.
- Desviaciones de línea media desde **~2 mm** pueden ser perceptibles.

---

## 5. Aplicación al simulador CAMILA

- **Color:** usar VITA Classical y, en el futuro, tonos bleached; evitar selectores de color libres como referencia clínica.
- **Forma:** usar RED configurable (inicial 70%, rango 62–80%) y no forzar proporción áurea estricta.
- **Ancho/alto:** mantener centrales en 75–80%; fuera de rango, señalar forma potencialmente poco natural.
- **Guías:** ofrecer línea media, plano oclusal, zenits y arco de sonrisa como capas opcionales del editor.
- **Factibilidad:** advertir que cambios grandes de tono pueden requerir mayor espesor o preparación, siempre sujetos al criterio del dentista.
- **Color:** usar ΔE00 ≈ 2.5 como referencia de cambio perceptible si se implementa comparación automática.
- **Simulación rápida:** el resultado debe conservar la fotografía original, evitar dientes idénticos o planos y mantener anatomía individual, textura, translucidez, sombras y reflejos.

---

## 6. Fuentes consultadas

- VITA Zahnfabrik — VITA classical A1–D4 y VITA 3D-Master.
- dentalcare.com — protocolo clínico de selección de tono.
- Prodenta Dental Laboratories, Beverly Hills Institute of Dental Esthetics y Styleitaliano.org — clasificación y espesores.
- PMC/NCBI — carillas feldespáticas mínimamente invasivas y no-prep.
- ScienceDirect, Dentistry Today, Pocket Dentistry y PMC — proporciones dentales.
- Operative Dentistry, OHI-S y AEGIS Dental Network — Digital Smile Design.
- PMC — diferencias de color ΔE00 y guías VITA.

> Este documento resume literatura clínica y técnica para contexto de desarrollo. No sustituye el criterio clínico del dentista tratante ni debe utilizarse como única fuente para decisiones de tratamiento real.
