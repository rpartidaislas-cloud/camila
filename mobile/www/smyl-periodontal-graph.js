/* The diagram is a read-only projection of the clinical examination. Distances are apical-positive. */
(function () {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  let graphCount = 0;
  const arches = {
    upper:['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28'],
    lower:['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38']
  };
  const positions = {MB:'Mesial', B:'Central', DB:'Distal', ML:'Mesial', L:'Central', DL:'Distal'};
  // Horizontal space and probing-site positions follow the different crown widths.
  // The two halves mirror each other around the central incisors.
  const geometry = {
    upper:{widths:[59,51,56,62,60,80,75,74],offsets:[18,15,17,19,18,27,25,23]},
    lower:{widths:[43,47,51,56,62,81,76,72],offsets:[13,14,15,17,18,28,26,24]}
  };
  const plotHeight = 208, origin = 7, bandHeight = 30;
  const totalHeight = plotHeight + origin * 2 + bandHeight;
  const mm = value => value == null ? 'Sin medir' : value + ' mm';
  const archOf = tooth => arches.lower.includes(tooth) ? 'lower' : 'upper';
  const faceOf = site => ['ML','L','DL'].includes(site) ? 'interior' : 'vestibular';
  function sitesOnFace(tooth, face) {
    const codes = face === 'vestibular' ? ['MB','B','DB'] : ['ML','L','DL'];
    // Both surfaces keep the patient's right on the left of the screen.
    return tooth[0] === '1' || tooth[0] === '4' ? codes.reverse() : codes;
  }
  function html(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function svg(tag, attrs, text) {
    const el = document.createElementNS(ns,tag);
    for (const [key,value] of Object.entries(attrs || {})) el.setAttribute(key,String(value));
    if (text != null) el.textContent = text;
    return el;
  }
  function control(text, cls, action) {
    const el = html('button', cls, text); el.type = 'button'; el.addEventListener('click',action); return el;
  }
  function selectControl(caption, choices) {
    const label = html('label','pg-select-label');
    const text = html('span','',caption), select = html('select','pg-select');
    select.setAttribute('aria-label',caption);
    for (const [key,title] of choices) select.add(new Option(title,key));
    label.append(text,select);
    return {label,select};
  }
  function readPoint(exam, missing, tooth, site) {
    const raw = !missing.has(tooth) ? exam?.teeth?.[tooth]?.[site] : null;
    const depth = Number.isInteger(raw?.depth) ? raw.depth : null;
    const margin = Number.isInteger(raw?.margin) ? raw.margin : null;
    return {tooth, site, depth, margin, bottom:depth !== null && margin !== null ? margin + depth : null,
      bleeding:typeof raw?.bleeding === 'boolean' ? raw.bleeding : null};
  }
  function anatomyPaint(diagram) {
    const id = 'pg-anatomy-' + (++graphCount), defs = svg('defs');
    for (const [material, stops] of [
      ['enamel', [[0,'#d9dbdf'], [.17,'#f3f3ed'], [.4,'#fffcf3'], [.7,'#f9f6e9'], [1,'#cad1c9']]],
      ['root', [[0,'#c9b79a'], [.25,'#e4d6bc'], [.52,'#f1e6d2'], [1,'#d1c1a8']]]
    ]) {
      const paintId = id + '-' + material, gradient = svg('linearGradient',{id:paintId});
      for (const [offset,color] of stops) gradient.append(svg('stop',{offset,'stop-color':color}));
      defs.append(gradient);
      diagram.style.setProperty('--pg-'+material+'-paint','url(#'+paintId+')');
    }
    return defs;
  }
  // Original schematic elevations. Each profile shares a cervical origin and has a
  // separate crown and root so their junction remains legible behind the chart.
  // Mesial is at positive x in the master drawing. The left quadrants are mirrored.
  const profiles = {
    upperCentral: {
      crown: 'M-18 0 C-20 -9 -25 -18 -27 -30 C-29 -40 -28 -48 -25 -52 Q-23 -55 -18 -55 C-7 -55 5 -54 16 -55 Q24 -56 26 -53 C27 -47 26 -34 25 -26 C24 -15 20 -6 18 0 Q1 10 -18 0Z',
      root: 'M-18 -3 C-18 14 -15 31 -11 47 C-9 57 -8 68 -6 73 Q-4 78 -1 74 C4 68 8 54 11 42 Q18 16 18 -3Z',
      shade: 'M-24 -50 C-26 -37 -19 -22 -15 -15 Q-10 -5 -4 2 Q-12 2 -17 -2 C-20 -15 -26 -27 -26 -37 Q-27 -46 -24 -50Z',
      relief: 'M-17 -48 Q-8 -50 -3 -48 M5 -48 Q13 -50 19 -49 M-11 -35 Q-9 -25 -7 -20',
      inner: 'M-20 -42 C-16 -30 -12 -15 -4 -12 Q0 -16 5 -12 C12 -15 17 -31 20 -42 M-6 -8 Q0 -14 7 -9',
      rootDetail: 'M7 10 C6 28 2 45 -2 59'
    },
    upperLateral: {
      crown: 'M-14 0 C-19 -8 -23 -21 -24 -31 C-25 -43 -22 -49 -16 -51 C-10 -53 -3 -51 7 -52 Q19 -55 21 -49 C24 -39 21 -15 15 0 Q1 9 -14 0Z',
      root: 'M-14 -2 C-14 13 -12 30 -10 45 C-9 57 -8 66 -9 72 Q-10 78 -6 76 C1 72 6 57 9 42 Q15 14 15 -2Z',
      shade: 'M-21 -45 C-21 -32 -16 -20 -13 -16 Q-8 -7 -6 1 Q-11 1 -14 -3 C-17 -13 -23 -26 -23 -36 Q-23 -41 -21 -45Z',
      relief: 'M-15 -45 Q-7 -48 -1 -46 M4 -46 L14 -47',
      inner: 'M-17 -39 C-12 -22 -9 -14 -2 -11 Q1 -16 6 -13 Q13 -24 16 -40 M-5 -7 Q0 -12 5 -8',
      rootDetail: 'M5 10 C5 25 1 45 -3 58'
    },
    lowerCentral: {
      crown: 'M-13 0 C-17 -11 -19 -25 -19 -38 L-19 -46 Q-19 -49 -15 -49 Q0 -48 15 -49 Q19 -50 19 -46 C20 -34 17 -11 13 0 Q0 7 -13 0Z',
      root: 'M-13 -2 C-13 14 -10 31 -7 48 Q-5 62 -3 69 Q-1 75 2 71 C6 65 7 54 9 41 Q13 15 13 -2Z',
      shade: 'M-17 -44 Q-16 -27 -10 -13 L-5 0 Q-9 1 -12 -2 C-15 -14 -19 -33 -17 -44Z',
      relief: 'M-13 -44 Q-4 -45 1 -44 M5 -44 L13 -44',
      inner: 'M-13 -38 Q-7 -17 -2 -13 Q1 -16 5 -13 Q11 -27 13 -39',
      rootDetail: 'M4 13 Q4 36 0 56'
    },
    lowerLateral: {
      crown: 'M-14 0 Q-21 -17 -21 -33 C-22 -44 -20 -47 -15 -48 Q-6 -49 3 -50 L16 -52 Q20 -52 20 -47 C22 -31 17 -11 14 0 Q1 8 -14 0Z',
      root: 'M-14 -2 C-14 14 -11 32 -9 47 Q-6 61 -7 70 Q-8 77 -4 74 C2 70 7 55 10 39 Q15 11 14 -2Z',
      shade: 'M-18 -42 Q-17 -26 -12 -16 L-5 0 Q-10 1 -13 -3 C-16 -13 -21 -31 -18 -42Z',
      relief: 'M-14 -42 Q-7 -44 -1 -44 M4 -45 L14 -47',
      inner: 'M-16 -36 Q-10 -18 -3 -13 Q0 -17 4 -13 Q12 -22 15 -41',
      rootDetail: 'M5 12 C5 29 2 45 -1 58'
    },
    upperCanine: {
      crown: 'M-17 0 C-22 -9 -26 -24 -25 -36 Q-23 -41 -15 -45 Q-5 -50 1 -56 Q4 -59 7 -55 L20 -43 Q25 -39 25 -32 C25 -20 21 -7 17 0 Q0 10 -17 0Z',
      root: 'M-17 -2 C-18 14 -16 34 -12 52 C-10 64 -8 75 -9 81 Q-10 88 -6 86 C3 80 7 62 11 44 Q18 18 17 -2Z',
      shade: 'M-22 -34 Q-12 -39 -3 -46 C-12 -32 -12 -15 -6 1 Q-14 0 -17 -6 Q-23 -21 -22 -34Z',
      relief: 'M-15 -39 Q-3 -44 3 -50 C4 -39 6 -26 3 -18 M9 -47 Q15 -42 18 -39',
      inner: 'M-18 -33 Q-10 -29 -5 -17 M4 -48 Q8 -32 5 -18 M17 -34 Q12 -25 10 -18 M-7 -10 Q0 -18 8 -12',
      rootDetail: 'M7 11 C7 34 3 53 -3 71'
    },
    lowerCanine: {
      crown: 'M-15 0 C-20 -11 -24 -23 -23 -34 Q-25 -38 -17 -42 Q-4 -48 3 -55 Q6 -58 9 -53 L19 -43 Q22 -39 22 -31 C21 -18 17 -6 15 0 Q0 9 -15 0Z',
      root: 'M-15 -2 C-16 13 -14 33 -10 52 C-7 64 -6 72 -6 78 Q-6 84 -2 81 C5 74 9 55 11 40 Q16 12 15 -2Z',
      shade: 'M-20 -33 Q-13 -37 -7 -40 C-14 -25 -10 -10 -4 1 Q-12 0 -15 -5 Q-20 -17 -20 -33Z',
      relief: 'M-14 -37 Q-3 -42 4 -49 Q7 -34 5 -22',
      inner: 'M-16 -32 Q-9 -26 -4 -16 M5 -48 Q9 -33 6 -18 M-6 -10 Q0 -15 6 -11',
      rootDetail: 'M6 11 Q7 40 -1 66'
    },
    upperFirstPremolar: {
      crown: 'M-19 0 C-22 -8 -29 -15 -28 -28 Q-28 -34 -22 -38 Q-10 -44 -4 -50 Q-1 -53 4 -49 L16 -40 Q26 -38 28 -31 C30 -22 25 -11 19 0 Q1 10 -19 0Z',
      root: 'M-19 -2 C-19 14 -16 27 -15 42 C-14 52 -14 62 -15 68 Q-16 73 -12 71 C-5 66 0 50 3 39 Q9 14 11 -2Z',
      back: 'M-10 -2 Q-5 19 1 37 C5 50 7 60 10 67 Q13 72 15 67 C18 58 17 44 17 32 Q16 12 20 -2Z',
      shade: 'M-24 -31 Q-15 -36 -6 -43 C-15 -28 -14 -11 -6 1 Q-15 1 -19 -6 C-23 -13 -27 -24 -24 -31Z',
      relief: 'M-17 -33 Q-8 -37 -2 -44 Q2 -37 9 -34 M-2 -44 Q3 -31 2 -22',
      inner: 'M-18 -28 Q-9 -34 -4 -39 Q4 -35 12 -31 M-5 -37 Q-2 -30 -3 -21',
      rootDetail: 'M-7 12 Q-6 36 -12 58'
    },
    upperSecondPremolar: {
      crown: 'M-18 0 C-23 -9 -28 -19 -27 -30 Q-27 -35 -20 -39 L-9 -44 Q-4 -50 1 -48 L14 -41 Q24 -40 27 -33 C30 -21 23 -8 18 0 Q0 9 -18 0Z',
      root: 'M-18 -2 C-18 12 -15 28 -11 44 C-9 54 -8 63 -9 69 Q-10 75 -6 73 C2 68 7 54 11 39 Q18 15 18 -2Z',
      shade: 'M-23 -32 Q-16 -37 -8 -40 C-14 -25 -12 -11 -5 1 Q-14 1 -18 -6 C-21 -13 -25 -23 -23 -32Z',
      relief: 'M-16 -34 Q-8 -37 -4 -42 Q1 -37 9 -35 M-4 -42 Q0 -32 -1 -23',
      inner: 'M-17 -29 Q-10 -35 -4 -39 Q4 -36 13 -32 M-5 -37 Q-2 -30 -3 -22',
      rootDetail: 'M6 11 Q5 40 -3 60'
    },
    lowerFirstPremolar: {
      crown: 'M-17 0 Q-24 -10 -26 -25 Q-28 -32 -19 -36 C-12 -39 -6 -47 -2 -49 Q1 -50 4 -47 Q13 -39 21 -36 Q26 -33 25 -24 Q23 -10 17 0 Q0 9 -17 0Z',
      root: 'M-17 -2 C-17 11 -15 27 -11 42 C-8 52 -7 61 -7 67 Q-7 74 -3 71 C4 65 9 48 12 32 Q17 12 17 -2Z',
      shade: 'M-22 -28 Q-14 -33 -8 -40 C-15 -24 -11 -9 -4 1 Q-12 1 -17 -5 Q-23 -15 -22 -28Z',
      relief: 'M-16 -31 Q-8 -36 -1 -43 Q7 -36 13 -34 M-1 -42 Q3 -32 2 -22',
      inner: 'M-17 -29 Q-10 -32 -3 -35 Q5 -32 11 -29 M-3 -34 Q-2 -28 -3 -22',
      rootDetail: 'M5 12 Q6 35 -1 58'
    },
    lowerSecondPremolar: {
      crown: 'M-18 0 C-23 -6 -28 -17 -28 -28 Q-28 -35 -21 -38 L-10 -42 Q-5 -47 -1 -45 C5 -40 10 -40 14 -40 Q23 -41 27 -34 C31 -24 25 -10 18 0 Q1 9 -18 0Z',
      root: 'M-18 -2 C-18 13 -15 29 -11 44 C-9 53 -8 62 -9 69 Q-10 75 -6 73 C2 70 8 52 12 36 Q19 12 18 -2Z',
      shade: 'M-24 -30 Q-18 -35 -10 -37 C-16 -24 -13 -10 -5 1 Q-15 1 -19 -6 C-21 -11 -26 -23 -24 -30Z',
      relief: 'M-17 -32 Q-10 -35 -4 -39 Q3 -34 8 -33 M-4 -38 Q0 -31 -1 -24',
      inner: 'M-19 -28 Q-12 -35 -7 -35 Q-2 -32 2 -31 Q8 -36 14 -33 M2 -30 Q4 -26 4 -22',
      rootDetail: 'M6 11 Q6 36 -2 59'
    },
    upperMolar: {
      crown: 'M-27 0 C-29 -7 -37 -14 -37 -25 Q-38 -33 -31 -35 Q-26 -40 -21 -40 C-15 -40 -9 -34 -5 -34 Q3 -38 10 -43 Q16 -48 22 -43 Q27 -39 32 -38 C38 -34 38 -22 35 -14 L27 0 Q4 10 -17 4 Q-23 4 -27 0Z',
      root: 'M-27 -2 C-26 12 -27 27 -29 42 C-31 52 -33 59 -34 63 Q-35 69 -31 67 C-23 63 -16 48 -11 35 Q-6 21 -1 20 C5 18 8 30 11 41 C13 51 17 61 22 66 Q27 71 28 66 C29 59 27 49 26 39 Q24 16 28 -3Z',
      back: 'M-11 -4 C-8 17 -7 33 -7 52 C-7 63 -6 71 -6 77 Q-6 82 -2 80 C5 75 9 59 11 46 Q15 21 14 -3Z',
      shade: 'M-31 -30 Q-25 -35 -20 -35 Q-14 -32 -10 -31 C-15 -24 -11 -11 -3 1 Q-18 4 -25 -2 C-27 -10 -35 -20 -31 -30Z',
      relief: 'M-29 -29 Q-23 -34 -19 -34 Q-13 -32 -6 -28 C-5 -23 -4 -19 -5 -15 M-5 -28 Q5 -31 13 -38 Q17 -42 23 -36',
      inner: 'M-29 -25 Q-21 -32 -15 -33 Q-9 -34 -3 -29 Q6 -31 14 -39 M-3 -29 Q-4 -24 -2 -18',
      rootDetail: 'M-17 13 Q-18 35 -26 53 M17 13 Q16 34 22 52'
    },
    lowerMolar: {
      crown: 'M-28 0 C-31 -8 -39 -14 -38 -25 Q-38 -32 -31 -34 Q-27 -38 -23 -35 Q-18 -34 -14 -37 Q-7 -43 -2 -40 L3 -37 Q8 -34 13 -40 Q18 -45 23 -43 L32 -38 C39 -35 39 -27 37 -19 Q32 -6 27 0 Q2 10 -19 4Z',
      root: 'M-28 -2 C-26 12 -26 24 -31 39 Q-36 54 -35 62 Q-35 66 -31 65 C-20 60 -9 45 -5 28 Q-2 20 2 20 C8 20 11 33 11 43 Q10 58 15 68 Q17 72 22 68 C30 58 32 42 29 24 Q26 9 28 -3Z',
      shade: 'M-33 -27 Q-28 -31 -23 -30 Q-20 -29 -17 -30 C-22 -19 -14 -7 -5 1 Q-18 4 -25 -2 C-29 -9 -36 -18 -33 -27Z',
      relief: 'M-31 -27 Q-27 -32 -23 -29 L-18 -26 M-18 -26 Q-18 -21 -16 -19 M-17 -27 Q-9 -29 -5 -34 Q-1 -36 4 -32 L8 -29 Q14 -31 19 -37 M8 -29 Q8 -23 10 -18',
      inner: 'M-28 -26 Q-18 -34 -12 -35 Q-8 -35 -2 -30 Q7 -34 13 -37 Q18 -40 22 -35 M-2 -30 Q0 -23 -1 -18',
      rootDetail: 'M-16 13 Q-17 38 -27 52 M19 13 Q26 40 19 59'
    },
    upperSecondMolar: {
      crown: 'M-26 0 C-30 -8 -38 -16 -36 -27 Q-36 -33 -29 -36 Q-23 -42 -17 -38 Q-10 -33 -5 -34 Q2 -36 10 -43 Q16 -48 23 -41 L31 -37 C37 -32 38 -23 34 -14 L26 0 Q4 10 -17 4Z',
      root: 'M-26 -2 Q-25 18 -27 35 C-28 46 -31 55 -33 61 Q-35 67 -31 66 C-23 62 -16 48 -11 35 Q-7 24 -3 22 C3 20 7 34 9 44 Q12 60 17 66 Q20 71 23 66 C26 58 24 46 24 35 Q23 12 27 -3Z',
      back: 'M-11 -3 Q-6 20 -7 40 C-7 54 -9 66 -10 73 Q-10 79 -6 77 C3 73 8 56 10 44 Q13 21 13 -3Z',
      shade: 'M-31 -30 Q-26 -35 -19 -34 L-10 -30 C-16 -22 -11 -9 -4 1 Q-19 3 -25 -3 C-29 -11 -34 -21 -31 -30Z',
      relief: 'M-27 -28 Q-21 -34 -16 -31 L-6 -27 Q2 -30 12 -37 M-6 -27 Q-6 -22 -5 -16',
      inner: 'M-26 -24 Q-20 -31 -13 -33 Q-8 -34 -2 -28 Q6 -31 12 -37 M-2 -28 Q0 -24 -1 -19',
      rootDetail: 'M-16 14 Q-16 35 -25 51 M15 13 Q14 35 18 52'
    },
    lowerSecondMolar: {
      crown: 'M-27 0 Q-36 -11 -37 -23 Q-39 -32 -31 -35 L-23 -39 Q-17 -44 -10 -38 Q-5 -33 -1 -34 Q6 -37 12 -41 Q18 -46 24 -41 L31 -37 C38 -33 38 -25 35 -17 Q31 -6 26 0 Q2 10 -19 4Z',
      root: 'M-27 -2 C-25 10 -25 26 -27 40 Q-30 54 -29 62 Q-28 66 -25 64 C-18 59 -11 45 -7 32 Q-4 22 0 22 C6 22 9 35 10 46 Q11 61 14 67 Q16 72 20 68 C25 62 27 48 26 33 Q24 13 27 -3Z',
      shade: 'M-32 -27 Q-26 -32 -21 -34 Q-14 -36 -9 -30 C-17 -20 -12 -8 -5 1 Q-18 3 -25 -3 Q-32 -15 -32 -27Z',
      relief: 'M-28 -27 Q-20 -34 -15 -34 Q-9 -30 -2 -27 Q7 -30 15 -36 M-2 -27 Q-2 -22 0 -17',
      inner: 'M-25 -25 Q-18 -32 -11 -33 Q-6 -31 -1 -28 Q8 -32 15 -37 M-1 -28 L0 -19',
      rootDetail: 'M-16 13 Q-16 34 -22 50 M17 12 Q21 37 17 55'
    },
    upperThirdMolar: {
      crown: 'M-23 0 C-27 -7 -33 -16 -34 -25 Q-34 -32 -28 -35 Q-24 -40 -18 -38 L-9 -34 Q-4 -32 2 -36 L12 -40 Q18 -42 23 -37 Q31 -35 33 -29 C36 -21 30 -7 23 0 Q2 9 -23 0Z',
      root: 'M-23 -2 C-22 10 -21 28 -25 39 Q-29 51 -32 56 Q-34 61 -29 60 Q-17 55 -7 39 Q-4 49 -13 61 Q-16 66 -12 67 C-2 67 9 55 14 43 Q25 22 24 -3Z',
      shade: 'M-29 -28 Q-24 -34 -19 -33 L-12 -30 C-16 -21 -12 -9 -4 1 Q-16 2 -22 -3 Q-29 -13 -29 -28Z',
      relief: 'M-24 -28 Q-18 -33 -12 -28 L-7 -25 Q1 -28 9 -34 M-7 -25 Q-6 -20 -7 -16',
      inner: 'M-24 -25 Q-17 -33 -11 -31 L-4 -26 Q5 -30 11 -34 M-4 -26 L-3 -18',
      rootDetail: 'M10 11 Q8 36 -4 51'
    },
    lowerThirdMolar: {
      crown: 'M-24 0 C-30 -9 -36 -17 -34 -28 Q-34 -33 -27 -34 L-20 -36 Q-16 -38 -11 -35 Q-5 -32 1 -36 Q7 -42 13 -39 L20 -35 Q28 -35 31 -29 C35 -19 29 -7 23 0 Q1 9 -24 0Z',
      root: 'M-24 -2 Q-22 15 -23 29 C-24 40 -28 50 -32 55 Q-35 61 -30 60 C-19 58 -10 48 -5 36 Q-2 49 -7 60 Q-11 66 -6 66 C3 65 14 54 17 42 Q24 19 24 -3Z',
      shade: 'M-30 -27 Q-23 -32 -17 -31 C-21 -22 -13 -8 -5 1 Q-16 2 -23 -4 Q-30 -15 -30 -27Z',
      relief: 'M-24 -27 Q-19 -31 -13 -29 L-8 -26 Q0 -27 7 -33 M-8 -26 Q-7 -22 -7 -18',
      inner: 'M-24 -25 Q-17 -32 -11 -30 L-4 -26 Q4 -30 10 -33 M-4 -26 L-3 -18',
      rootDetail: 'M10 12 Q7 39 -2 52'
    }
  };

  const archProfiles = {
    upper: ['upperCentral','upperLateral','upperCanine','upperFirstPremolar','upperSecondPremolar','upperMolar','upperSecondMolar','upperThirdMolar'],
    lower: ['lowerCentral','lowerLateral','lowerCanine','lowerFirstPremolar','lowerSecondPremolar','lowerMolar','lowerSecondMolar','lowerThirdMolar']
  };
  function toothDrawing(tooth, arch, x, zero, size = 1, face = 'vestibular') {
    const ordinal = Number(tooth[1]), name = archProfiles[arch][ordinal - 1], shape = profiles[name];
    const scale = size * (ordinal === 7 ? 0.93 : 1);
    const sx = tooth[0] === '1' || tooth[0] === '4' ? scale : -scale;
    const sy = arch === 'upper' ? -scale : scale;
    const group = svg('g',{
      transform:'translate('+x+' '+zero+') scale('+sx+' '+sy+')',
      class:'pg-tooth', 'data-family':name, 'aria-hidden':'true'
    });
    const layer = (geometry, style) => group.append(svg('path',{d:geometry,class:style}));
    if (shape.back && face === 'vestibular') layer(shape.back,'pg-root-back');
    layer(shape.root,'pg-root');
    layer(shape.rootDetail,'pg-root-detail');
    if (shape.back && face === 'interior') layer(shape.back,'pg-root pg-root-near');
    layer(shape.crown,'pg-enamel');
    layer(shape.shade,'pg-crown-shade');
    layer(face === 'interior' ? shape.inner : shape.relief,'pg-anatomy-detail');
    return group;
  }
  function mount(host, initial) {
    let options = {...initial};
    const figureHeight = totalHeight + (options.followOnly ? 24 : 0);
    let missing = new Set(Array.from(options.missingTeeth || [],String));
    let arch = archOf(String(options.tooth)), face = faceOf(options.site), showProbe = true, destroyed = false;
    let tooth = arches[arch].includes(String(options.tooth)) && !missing.has(String(options.tooth)) ? String(options.tooth) : preferredTooth(arch);
    let site = Object.hasOwn(positions,options.site) ? options.site : preferredSite(tooth,face);
    let points = [], width;
    const section = html('section','pg-shell'); section.setAttribute('aria-label','Gráfica periodontal');
    const controls = html('div','pg-controls');
    const archControl = selectControl('Arcada',[['upper','Superior'],['lower','Inferior']]);
    const faceControl = selectControl('Cara',[['vestibular','Vestibular'],['interior','Palatina']]);
    const probe = control('Sonda virtual','pg-probe-toggle',() => {
      showProbe = !showProbe; render();
    });
    const probeIcon = svg('svg',{viewBox:'0 0 20 20',width:16,height:16,fill:'none','aria-hidden':'true'});
    probeIcon.append(svg('path',{d:'M13.8 2.6l2.1 1.6-6.6 8.6-1.5.8-3.5 4.3m3.5-4.3 1.8 1.4m.7-5.2 1.8 1.3m.2-4 1.9 1.3',stroke:'currentColor','stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round'}));
    probe.prepend(probeIcon);
    controls.append(archControl.label,faceControl.label,probe);
    const figure = html('figure','pg-figure'), orientation = html('div','pg-orientation');
    orientation.append(html('span','','Esquema · de derecha a izquierda del paciente'),html('span','','Desliza para recorrer'));
    const panel = html('div','pg-plot-panel'), viewport = html('div','pg-viewport'), strip = html('div','pg-strip');
    const rail = html('div','pg-axis-rail'), axis = svg('svg',{class:'pg-axis',viewBox:'0 0 35 '+figureHeight,'aria-hidden':'true',preserveAspectRatio:'none'});
    const diagram = svg('svg',{class:'pg-diagram',height:figureHeight,role:'group','aria-label':'Sitios periodontales'});
    const paint = anatomyPaint(diagram);
    rail.append(axis); strip.append(rail,diagram); viewport.append(strip); panel.append(viewport);
    const legend = html('figcaption','pg-legend');
    for (const [code,name] of [['margin','Margen gingival'],['bottom','Fondo de sondaje'],['zero','Referencia clínica · 0 mm']]) {
      const key = html('span','pg-key',name); const mark = html('i','pg-key-'+code); mark.setAttribute('aria-hidden','true');key.prepend(mark);legend.append(key);
    }
    figure.append(orientation,panel,legend);
    const info = html('div','pg-site-info'), infoTitle = html('strong','pg-site-title'), siteControls = html('div','pg-site-controls');
    siteControls.setAttribute('role','group'); siteControls.setAttribute('aria-label','Sitio seleccionado');
    const edit = control('Editar sitio','pg-edit',() => options.onEdit?.(tooth,site));
    const head = html('div','pg-info-head');head.append(infoTitle,siteControls,edit);
    const measurements = html('dl','pg-readings'), note = html('p','pg-note');
    info.append(head,measurements,note);
    if (options.followOnly) {
      // Navigation belongs to the guided recording. Keep the plot scrollable.
      viewport.tabIndex = 0;
      viewport.setAttribute('aria-label','Vista previa del sondaje guiado');
      diagram.setAttribute('role','img');
      diagram.setAttribute('aria-label','Gráfica de la pieza durante el sondaje guiado');
      legend.append(html('span','pg-key','Fila inferior: sondaje en mm'));
      section.append(figure);
    } else section.append(controls,figure,info);
    host.replaceChildren(section);

    function preferredTooth(nextArch) {
      return arches[nextArch].find(id=>!missing.has(id)&&Object.keys(options.exam?.teeth?.[id] || {}).length)
        || arches[nextArch].find(id=>!missing.has(id)) || arches[nextArch][0];
    }
    function preferredSite(id, side) {
      const sites=side==='vestibular'?['MB','B','DB']:['ML','L','DL'];
      return sites.find(s=>readPoint(options.exam,missing,id,s).bottom!==null)
        || sites.find(s=>options.exam?.teeth?.[id]?.[s]) || sites[1];
    }
    function layers() {
      const all = [];
      let start = 0;
      arches[arch].forEach(id => {
        const family = Number(id[1]) - 1, size = geometry[arch].widths[family], offset = geometry[arch].offsets[family];
        const center = start + size / 2, edges = [start, center-offset/2, center+offset/2, start+size];
        sitesOnFace(id,face).forEach((code,index) => {
          all.push({...readPoint(options.exam,missing,id,code), x:center+(index-1)*offset,
            left:edges[index], right:edges[index+1]});
        });
        start += size;
      });
      return all;
    }
    function scale() {
      const values=points.flatMap(p=>[p.margin,p.bottom]).filter(v=>v!==null);
      // Reserve room on both sides of the cervical reference for the complete anatomy.
      // With one extreme reading, extend the opposite end of the ruler instead of shrinking a tooth.
      const observedMin=Math.floor(Math.min(-11,...values)/2)*2, observedMax=Math.ceil(Math.max(17,...values)/2)*2 + 1;
      const crownRoom = 60, rootRoom = 90;
      const min=Math.min(observedMin,-Math.ceil(observedMax*crownRoom/(plotHeight-crownRoom)));
      const max=Math.max(observedMax,Math.ceil(-min*rootRoom/(plotHeight-rootRoom)));
      const unit=plotHeight/(max-min), above=arch === 'upper';
      return {min,max,unit,y:v=>origin+(above?max-v:v-min)*unit};
    }
    function drawGrid({min,max,unit,y}) {
      axis.replaceChildren(); diagram.replaceChildren(paint);
      const grid=svg('g',{'aria-hidden':'true'});
      for (let v=min;v<=max;v++) {
        if (unit<5.5 && Math.abs(v)%2!==0) continue;
        const major=v%((unit<7)?4:2)===0, cls=v===0?'pg-grid-zero':major?'pg-grid-major':'pg-grid-minor';
        grid.append(svg('line',{x1:0,x2:width,y1:y(v),y2:y(v),class:cls}));
        if (major && !(v===max || v===min)) {
          axis.append(svg('text',{x:29,y:y(v)+3.6,class:v===0?'pg-axis-zero':'','text-anchor':'end'},String(v)));
        }
      }
      axis.append(svg('text',{x:28,y:totalHeight-11,'text-anchor':'end'},'mm'));
      return grid;
    }
    function drawLines(y) {
      const traces=svg('g',{'aria-hidden':'true'});
      for(let i=1;i<points.length;i++){
        const a=points[i-1], b=points[i];
        if(a.bottom!==null && b.bottom!==null){
          const path='M'+a.x+' '+y(a.margin)+'L'+b.x+' '+y(b.margin)+'L'+b.x+' '+y(b.bottom)+'L'+a.x+' '+y(a.bottom)+'Z';
          traces.append(svg('path',{'data-band':'',d:path,class:'pg-band'}));
        }
      }
      for (const metric of ['bottom','margin']) {
        let segment=[];
        const flush=()=>{
          if(segment.length>1)traces.append(svg('polyline',{'data-line':metric,points:segment.map(p=>p.x+','+y(p[metric])).join(' '),class:'pg-line-'+metric}));
          segment=[];
        };
        for(const p of points){ if(p[metric]===null)flush();else segment.push(p); } flush();
      }
      for(const p of points){
        const attr={'data-tooth':p.tooth,'data-site':p.site};
        if(p.bottom!==null)traces.append(svg('rect',{...attr,'data-mark':'bottom',x:p.x-3.5,y:y(p.bottom)-3.5,width:7,height:7,rx:1,class:'pg-mark-bottom'}));
        if(p.margin!==null)traces.append(svg('circle',{...attr,'data-mark':'margin',cx:p.x,cy:y(p.margin),r:3,class:'pg-mark-margin'}));
      }
      return traces;
    }
    function drawProbe(p,{y,unit}) {
      if(!showProbe || p?.bottom==null)return;
      const x=p.x+4, tip=y(p.bottom), direction=arch==='upper'?1:-1;
      const limit=direction>0?plotHeight+origin-tip:tip-origin;
      const height=Math.min(limit,unit*(Math.max(p.depth+3,7)));
      if(height<=0)return;
      const group=svg('g',{'data-probe':'','aria-hidden':'true'});
      const tilt=Math.min(.16,17/height);
      const shaft={x1:x,y1:tip,x2:x+height*tilt,y2:tip+direction*height};
      group.append(svg('line',{...shaft,class:'pg-probe-edge'}),svg('line',{...shaft,class:'pg-probe-shaft'}));
      for(let i=1;i*unit<height;i++){
        const yy=tip+direction*i*unit, xx=x+tilt*i*unit, len=i%5===0?7:3;
        group.append(svg('line',{x1:xx-2.5,x2:xx+len,y1:yy,y2:yy,class:'pg-probe-tick'}));
      }
      const marginX=x+p.depth*unit*tilt;
      group.append(svg('line',{x1:p.x+3,x2:marginX,y1:y(p.margin),y2:y(p.margin),class:'pg-probe-cap'}));
      group.append(svg('circle',{cx:x,cy:tip,r:2.6,class:'pg-probe-tip'}));
      diagram.append(group);
    }
    function drawHits(p) {
      const hits=svg('g',{}), yLabel=totalHeight-12;
      // Each site occupies a complete vertical strip. The visible trace is never a drag handle.
      for(const item of points) {
        const selected=item.tooth===tooth&&item.site===site;
        if (options.followOnly) {
          if (!missing.has(item.tooth)) diagram.append(svg('text',{x:item.x,y:figureHeight-10,
            'text-anchor':'middle',class:'pg-guide-depth'+(selected?' pg-current':''),
            'data-guide-tooth':item.tooth,'data-guide-site':item.site},item.depth ?? '—'));
          continue;
        }
        const group=svg('g',{role:'button',tabindex:selected?'0':'-1','aria-pressed':selected,'aria-disabled':missing.has(item.tooth),
          'data-tooth':item.tooth,'data-site':item.site,'aria-label':'Pieza '+item.tooth+', '+positions[item.site]+(missing.has(item.tooth)?', ausente':', sondaje '+mm(item.depth)+', margen '+mm(item.margin))});
        group.append(svg('rect',{x:item.left,y:0,width:item.right-item.left,height:totalHeight,class:'pg-hit'}));
        hits.append(group);
      }
      arches[arch].forEach((id,i)=>{
        const x=points[i*3+1].x, label=svg('text',{x,y:yLabel,'text-anchor':'middle',class:'pg-tooth-label'+(tooth===id?' pg-current':'')+(missing.has(id)?' pg-missing-label':'')},id);
        diagram.append(label);
      });
      if (p) diagram.append(svg('line',{x1:p.x,x2:p.x,y1:origin,y2:plotHeight+origin,class:'pg-site-guide'}));
      if (!options.followOnly) diagram.append(hits);
    }
    function drawReadings(p) {
      infoTitle.textContent='Pieza '+tooth;
      const readOnly=options.canEdit===false;
      edit.hidden=typeof options.onEdit!=='function'; edit.disabled=missing.has(tooth);
      edit.textContent=readOnly?'Ver pieza':'Editar sitio';
      siteControls.replaceChildren();
      for (const code of (face==='vestibular'?['MB','B','DB']:['ML','L','DL'])){
        const b=control(positions[code],'pg-site-choice',()=>selectSite(tooth,code,'control'));
        b.dataset.site=code;b.setAttribute('aria-pressed',String(site===code));b.disabled=missing.has(tooth);siteControls.append(b);
      }
      measurements.replaceChildren();
      for(const [name,value] of [['Sondaje',mm(p.depth)],['Margen gingival',mm(p.margin)],['Sangrado',p.bleeding===null?'Sin medir':p.bleeding?'Sí':'No']]){
        const pair=html('div'); pair.append(html('dt','',name),html('dd','',value));measurements.append(pair);
      }
      note.textContent=missing.has(tooth)?'Pieza ausente en el odontograma.':p.margin===null&&p.depth!==null?'Registra el margen gingival para ubicar el fondo de sondaje en la gráfica.':p.margin===null&&p.depth===null?'Este sitio está pendiente de medición.':p.depth===null?'Registra la profundidad de sondaje para completar el perfil de este sitio.':showProbe?'Sonda esquemática graduada cada 1 mm.':'';
      note.hidden=!note.textContent;
    }
    function bringIntoView(center=false) {
      const index=points.findIndex(p=>p.tooth===tooth&&p.site===site);
      if(index<0 || !viewport.clientWidth)return;
      const factor=diagram.getBoundingClientRect().width/width;
      const x=points[index].x*factor, left=viewport.scrollLeft, size=viewport.clientWidth-rail.offsetWidth, pad=geometry[arch].widths[Number(tooth[1])-1]*.55*factor;
      if(center || x<left+pad || x>left+size-pad) viewport.scrollLeft=Math.max(0,x-size/2);
    }
    function focusSelection() {
      const target=diagram.querySelector('[role="button"][aria-pressed="true"][aria-disabled="false"]') || archControl.select;
      target.focus({preventScroll:true});
      bringIntoView();
    }
    function render() {
      if(destroyed)return;
      archControl.select.value=arch;
      faceControl.select.options[1].text=arch==='upper'?'Palatina':'Lingual';
      faceControl.select.value=face;
      probe.setAttribute('aria-pressed',String(showProbe));
      width = 2 * geometry[arch].widths.reduce((sum,cell) => sum + cell, 0);
      diagram.setAttribute('width',width);
      diagram.setAttribute('viewBox','0 0 '+width+' '+figureHeight);
      points=layers();
      const mapped=scale(), grid=drawGrid(mapped), selected=points.find(p=>p.tooth===tooth&&p.site===site);
      if(selected)diagram.append(svg('rect',{x:selected.left,y:0,width:selected.right-selected.left,height:plotHeight+origin*2,class:'pg-site-column','aria-hidden':'true'}));
      diagram.append(grid);
      for(const [i,id] of arches[arch].entries()){
        const center=points[i*3+1].x;
        if(!missing.has(id))diagram.append(toothDrawing(id,arch,center,mapped.y(0),1,face));
        else diagram.append(svg('text',{x:center,y:mapped.y(0)-6,'text-anchor':'middle',class:'pg-missing-label'},'Ausente'));
      }
      diagram.append(drawLines(mapped.y));
      drawProbe(selected,mapped);
      drawHits(selected);
      if(selected)drawReadings(selected);
    }
    function selectSite(id,code,focusTarget) {
      if(!arches[arch].includes(id)||missing.has(id)||!Object.hasOwn(positions,code))return;
      tooth=id;site=code;
      render();bringIntoView();
      if(focusTarget==='plot') diagram.querySelector('[role="button"][aria-pressed="true"]')?.focus({preventScroll:true});
      if(focusTarget==='control') siteControls.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
      options.onSelect?.(tooth,site);
    }
    diagram.addEventListener('click',event=>{
      const hit=event.target.closest('[role="button"][data-site]');
      if(hit)selectSite(hit.dataset.tooth,hit.dataset.site,'plot');
    });
    diagram.addEventListener('keydown',event=>{
      const hit=event.target.closest('[role="button"][data-site]');if(!hit)return;
      const enabled=points.filter(p=>!missing.has(p.tooth));
      const index=enabled.findIndex(p=>p.tooth===hit.dataset.tooth&&p.site===hit.dataset.site);
      if(index<0)return;
      let nextIndex;
      switch(event.key){
        case 'ArrowLeft': nextIndex=Math.max(0,index-1);break;
        case 'ArrowRight': nextIndex=Math.min(enabled.length-1,index+1);break;
        case 'Home': nextIndex=0;break;
        case 'End': nextIndex=enabled.length-1;break;
        case 'Enter': case ' ': nextIndex=index;break;
        default:return;
      }
      event.preventDefault();
      const next=enabled[nextIndex];selectSite(next.tooth,next.site,'plot');
    });
    archControl.select.addEventListener('change',()=>{
      arch=archControl.select.value;tooth=preferredTooth(arch);site=preferredSite(tooth,face);
      render();bringIntoView(true);options.onSelect?.(tooth,site);
    });
    faceControl.select.addEventListener('change',()=>{
      const old=site;
      face=faceControl.select.value;
      const ordered=sitesOnFace(tooth,face);
      site=ordered.find(s=>positions[s]===positions[old]);
      render();bringIntoView();options.onSelect?.(tooth,site);
    });
    render();
    requestAnimationFrame(()=>{if(!destroyed)bringIntoView(true);});
    return {
      update(next={}) {
        if(destroyed)return;
        const previousTooth=tooth, previousSite=site;
        const externalTooth=next.tooth!=null&&String(next.tooth)!==String(options.tooth);
        const externalSite=next.site!=null&&next.site!==options.site;
        options={...options,...next}; missing=new Set(Array.from(options.missingTeeth||[],String));
        const id=String(options.tooth);
        if(externalTooth && arches[archOf(id)].includes(id)){arch=archOf(id);tooth=id;}
        if(missing.has(tooth))tooth=preferredTooth(arch);
        if((externalTooth||externalSite) && Object.hasOwn(positions,next.site)){site=next.site;face=faceOf(site);}
        else if(tooth!==previousTooth)site=preferredSite(tooth,face);
        const focused=diagram.contains(document.activeElement)?'plot':siteControls.contains(document.activeElement)?'control':'';
        render();
        if(previousTooth!==tooth||previousSite!==site)bringIntoView();
        if(focused==='plot')focusSelection();
        if(focused==='control')siteControls.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
      },
      focusSelection,
      destroy(){destroyed=true;section.remove();}
    };
  }
  window.SmylPeriodontalGraph=Object.freeze({mount});
})();
