/* =========================================================
   PERUKISTAN · pantalla inicial + introducción narrativa 2D pixel art
   ---------------------------------------------------------
   Capa independiente (no conoce Three.js ni la lógica de los puzzles).
   Estados: INTRO_SCREEN → STORY_SCENE_1 → STORY_SCENE_2 → STORY_SIRENS
            → STORY_SCENE_3 → (ManualUI) → partida.iniciar() en script.js
   Mientras está abierta la partida sigue en READY: sin reloj, vidas,
   criaturas ni acertijos activos. Todo se dibuja en un canvas 320×180
   escalado con image-rendering: pixelated; sonidos con WebAudio.
   ========================================================= */
(function (global) {
  'use strict';
  global.PERUKISTAN_INTRO = true;            // manual.js no se abre solo: lo abre esta capa

  const W = 320, H = 180;
  const SUBTITULO = 'Desactiva la bomba antes de que sea demasiado tarde';
  const $ = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h) e.innerHTML = h; return e; };

  /* ---------- Audio (WebAudio, se crea tras el primer gesto) ---------- */
  const A = { ctx: null, master: null, vol: 0.6, mute: false, siren: null, drone: null, calle: null };
  function audioInit() {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = global.AudioContext || global.webkitAudioContext; if (!AC) return;
    A.ctx = new AC(); A.master = A.ctx.createGain(); A.master.connect(A.ctx.destination); aplicarVol();
    const c = A.ctx;
    // Suspenso: dos graves desafinados con trémolo lento
    const g = c.createGain(); g.gain.value = 0.0001; g.connect(A.master);
    [55, 58.3].forEach((f) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; o.connect(lp); lp.connect(g); o.start(); });
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.25; lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    A.drone = g;
    // Ambiente de calle: ruido filtrado
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = c.createBufferSource(); n.buffer = buf; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 500; const ng = c.createGain(); ng.gain.value = 0.0001;
    n.connect(bp); bp.connect(ng); ng.connect(A.master); n.start(); A.calle = ng;
    // Sirena: onda con barrido (wail) controlada por ganancia
    const so = c.createOscillator(); so.type = 'square'; so.frequency.value = 780;
    const sl = c.createOscillator(), sg = c.createGain(); sl.frequency.value = 0.6; sg.gain.value = 260; sl.connect(sg); sg.connect(so.frequency); sl.start();
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800; const sv = c.createGain(); sv.gain.value = 0;
    so.connect(sf); sf.connect(sv); sv.connect(A.master); so.start(); A.siren = sv;
  }
  function aplicarVol() { if (A.master) A.master.gain.value = A.mute ? 0 : A.vol; }
  function rampa(g, v, s = 0.4) { if (A.ctx && g) { g.gain.cancelScheduledValues(A.ctx.currentTime); g.gain.setTargetAtTime(v, A.ctx.currentTime, s); } }
  function tono(f, tipo, dur, vol, t0 = 0) {
    if (!A.ctx) return; const c = A.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = tipo; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.02);
  }
  const VOCES = { 'Narrador': [330, 'triangle', 0.07], 'Señora': [560, 'sine', 0.11], 'Operador PNP': [250, 'square', 0.045], 'Policía': [190, 'sawtooth', 0.05] };
  function voz(quien) { const v = VOCES[quien] || VOCES.Narrador; tono(v[0] * (0.92 + Math.random() * 0.2), v[1], 0.05, v[2]); }
  const SFX = {
    papel() { for (let i = 0; i < 4; i++) tono(1800 + i * 300, 'sawtooth', 0.05, 0.015, i * 0.06); },
    toc() { tono(140, 'sine', 0.12, 0.12); },
    llamada() { for (let i = 0; i < 3; i++) { tono(440, 'sine', 0.35, 0.08, i * 0.9); tono(480, 'sine', 0.35, 0.08, i * 0.9); } },
    cuelga() { tono(480, 'square', 0.08, 0.05); tono(380, 'square', 0.12, 0.05, 0.1); },
    puerta() { tono(90, 'square', 0.1, 0.07); tono(70, 'square', 0.12, 0.07, 0.12); },
    paso() { tono(100, 'sine', 0.05, 0.05); }
  };
  const disparados = new Set();
  const una = (clave, fn) => { if (disparados.has(clave)) return; disparados.add(clave); fn(); };   // un sonido por evento

  /* ---------- Dibujo: utilidades y sprites ---------- */
  let g, cv;
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  let hablando = false;       // la boca se mueve mientras escribe el texto

  function interior() {
    R(0, 0, W, 150, '#d8b98c'); R(0, 108, W, 4, '#b5946a'); R(0, 112, W, 38, '#c9a678');   // pared y zócalo
    for (let x = 0; x < W; x += 20) R(x, 20, 1, 88, '#cfae80');                              // papel pintado
    R(0, 150, W, 30, '#7a4e3a'); for (let x = 0; x < W; x += 24) R(x, 150, 1, 30, '#5f3a2b'); R(0, 164, W, 1, '#5f3a2b');
    R(18, 56, 30, 94, '#5b3a22'); R(21, 59, 24, 91, '#7a4e2c'); R(40, 106, 3, 3, '#e6c34a');   // puerta
    R(92, 36, 44, 38, '#3b2a1e'); R(95, 39, 38, 32, '#8cc9ee'); R(113, 39, 2, 32, '#3b2a1e'); R(95, 53, 38, 2, '#3b2a1e');   // ventana
    R(90, 34, 8, 44, '#b83a3a'); R(130, 34, 8, 44, '#b83a3a');                                // cortinas
    R(160, 40, 22, 16, '#3b2a1e'); R(162, 42, 18, 12, '#e9d27a'); R(166, 46, 6, 6, '#c0523a'); // cuadro
    R(150, 112, 56, 38, '#e8e4da'); R(150, 112, 56, 4, '#9aa0a8'); R(158, 120, 10, 10, '#2e2e34'); R(176, 120, 10, 10, '#2e2e34'); R(190, 124, 10, 2, '#9aa0a8');   // cocina
    R(206, 120, 24, 30, '#6b4a2a'); R(208, 122, 20, 26, '#7e5a34');                            // mueble
    R(236, 96, 66, 5, '#6b4a2a'); R(240, 101, 4, 49, '#5b3a22'); R(294, 101, 4, 49, '#5b3a22'); R(236, 90, 12, 6, '#2e2e34');   // mesa + teléfono
    R(262, 84, 10, 12, '#4a8a3a'); R(260, 92, 14, 4, '#b5651d');                              // planta
  }
  function calle(noche, flash) {
    R(0, 0, W, 112, noche ? '#1c2540' : '#7fb8e6');
    if (noche) for (let i = 0; i < 18; i++) R((i * 53) % W, (i * 29) % 60, 1, 1, '#fff5c4');
    R(0, 20, 60, 92, '#8c5a3c'); R(4, 40, 14, 18, '#e8d36a'); R(30, 40, 14, 18, '#e8d36a'); R(0, 14, 62, 8, '#5a3226');   // casa izquierda
    R(150, 34, 160, 80, '#d9a066'); R(144, 24, 172, 12, '#a14a32');                                              // casa del caso
    R(160, 50, 26, 22, '#a8d4f0'); R(264, 50, 26, 22, '#a8d4f0'); R(160, 50, 26, 2, '#8c5a3c'); R(264, 50, 26, 2, '#8c5a3c');
    R(200, 62, 26, 52, '#5b3a22'); R(204, 66, 18, 48, '#7a4e2c'); R(218, 90, 3, 3, '#e6c34a');
    R(60, 60, 78, 54, '#b9b0a6'); R(60, 52, 78, 10, '#7a6a5a');                                                   // casa del fondo
    R(0, 112, W, 20, '#a9a39a'); R(0, 128, W, 4, '#8a847b');                                                       // vereda
    R(0, 132, W, 48, '#4a4d55'); for (let x = 6; x < W; x += 46) R(x, 160, 24, 3, '#e2d27a');                       // pista
    R(296, 104, 24, 10, '#3d6b2e'); R(300, 96, 16, 10, '#4a8a3a');
    if (noche) { R(0, 0, W, H, 'rgba(8,10,30,0.28)'); R(120, 30, 3, 82, '#2a2a30'); R(114, 26, 15, 5, '#f4e08a'); }
    if (flash) { g.globalAlpha = 0.22; R(0, 0, W, H, flash > 0 ? '#ff2a2a' : '#2a6aff'); g.globalAlpha = 1; }
  }
  function senora(x, y, o = {}) {
    g.save(); g.translate(Math.round(x), Math.round(y)); if (o.dir === -1) g.scale(-1, 1);
    const w = o.walk ? Math.sin(o.walk * 0.012) : 0, mood = o.mood || 0;
    R(-4, -9, 3, 9 - (w > 0.4 ? 1 : 0), '#e0b090'); R(1, -9, 3, 9 - (w < -0.4 ? 1 : 0), '#e0b090');
    R(-4, -1, 3, 1, '#2a1a14'); R(1, -1, 3, 1, '#2a1a14');
    R(-7, -23, 14, 14, '#9b2d4f'); R(-6, -9, 12, 1, '#7a2240');                  // falda
    R(-5, -34, 10, 12, '#e8d8a0'); if (o.delantal) R(-4, -26, 8, 12, '#f4f0e6');   // blusa y delantal
    R(-4, -43, 8, 9, '#e0b090'); R(-5, -46, 10, 5, '#2a1a14'); R(-3, -49, 6, 4, '#2a1a14'); R(-5, -44, 2, 6, '#2a1a14');   // cabeza, pelo, moño
    R(1, -41, 1, 1, '#1a1210'); R(-2, -41, 1, 1, '#1a1210');                       // ojos
    if (mood) { R(-3, -43, 2, 1, '#2a1a14'); R(1, -44, 2, 1, '#2a1a14'); R(0, -38, 2, 1, '#6a2a2a'); R(0, -37, 2, 1, '#6a2a2a'); }   // cejas y boca preocupada
    else { R(-1, -38, hablando && ((Date.now() / 120) | 0) % 2 ? 2 : 3, 1, '#a0504a'); }
    const bob = o.remover ? Math.round(Math.sin(o.t * 0.008) * 2) : 0;
    if (o.telefono) { R(3, -40, 2, 8, '#e0b090'); R(2, -43, 3, 6, '#1a1a1e'); }               // brazo al oído
    else if (o.nota) { R(2, -30, 7, 4, '#e0b090'); R(4, -38, 8, 10, '#f4f0dc'); R(5, -36, 5, 1, '#8a8470'); R(5, -33, 6, 1, '#8a8470'); }
    else if (o.remover) { R(2, -29 + bob, 8, 3, '#e0b090'); R(10, -33 + bob, 2, 8, '#8a6a3a'); }
    else R(-6, -33, 2, 12, '#e8d8a0');
    g.restore();
  }
  function policia(x, y, o = {}) {
    g.save(); g.translate(Math.round(x), Math.round(y)); if (o.dir === -1) g.scale(-1, 1);
    const w = Math.sin((o.walk || 0) * 0.014);
    R(-4, -12, 3, 12 - (w > 0.4 ? 1 : 0), '#3e4a28'); R(1, -12, 3, 12 - (w < -0.4 ? 1 : 0), '#3e4a28'); R(-4, -2, 4, 2, '#15150f'); R(1, -2, 4, 2, '#15150f');
    R(-6, -32, 12, 20, '#5a6b34'); R(-6, -22, 12, 2, '#15150f'); R(2, -29, 2, 2, '#e6c34a');
    R(-8, -31, 2, 12, '#5a6b34'); R(6, -31, 2, 12, '#5a6b34');
    R(-4, -40, 8, 8, '#d9a888'); R(-5, -44, 10, 5, '#2f3b20'); R(-6, -41, 12, 2, '#1d2614'); R(1, -37, 1, 1, '#1a1210'); R(-2, -37, 1, 1, '#1a1210');
    g.restore();
  }
  function paquete(x, y, t) {
    R(x - 6, y - 8, 12, 8, '#a8763c'); R(x - 6, y - 8, 12, 2, '#c4924e'); R(x - 1, y - 8, 2, 8, '#d8c48a');
    R(x - 4, y - 5, 3, 2, ((t / 400) | 0) % 2 ? '#ff2a2a' : '#5a1010'); R(x + 1, y - 4, 4, 1, '#222');   // luz roja intermitente y cable
  }
  function patrulla(x, y, t, luces) {
    R(x - 5, y + 1, 62, 3, 'rgba(0,0,0,.35)');
    R(x, y - 18, 56, 15, '#eef0f4'); R(x + 12, y - 28, 30, 11, '#eef0f4'); R(x + 15, y - 26, 11, 8, '#7ab0d8'); R(x + 28, y - 26, 11, 8, '#7ab0d8');
    R(x, y - 10, 56, 3, '#2e7d32'); R(x + 40, y - 17, 8, 6, '#e6c34a'); R(x + 41, y - 16, 6, 4, '#2e7d32');   // franja y escudo PNP
    R(x + 6, y - 5, 10, 8, '#1a1a1e'); R(x + 38, y - 5, 10, 8, '#1a1a1e'); R(x + 9, y - 2, 4, 4, '#8a8a92'); R(x + 41, y - 2, 4, 4, '#8a8a92');
    const rojo = ((t / 180) | 0) % 2 === 0;
    R(x + 18, y - 31, 8, 3, luces ? (rojo ? '#ff2a2a' : '#5a1010') : '#5a1010'); R(x + 28, y - 31, 8, 3, luces ? (rojo ? '#102a5a' : '#3a7aff') : '#102a5a');
  }
  function operador() {   // retrato en pantalla (no usa la cámara)
    R(224, 8, 88, 64, '#0b0f1a'); R(226, 10, 84, 60, '#1c2a44');
    R(256, 28, 24, 26, '#d9a888'); R(254, 22, 28, 10, '#1a1a22'); R(262, 38, 2, 2, '#1a1210'); R(272, 38, 2, 2, '#1a1210'); R(264, 46, 8, 1, '#8a3a3a');
    R(250, 30, 5, 10, '#2a2a30'); R(281, 30, 5, 10, '#2a2a30'); R(252, 40, 14, 3, '#2a2a30'); R(244, 56, 48, 14, '#5a6b34');
    R(226, 10, 84, 1, '#4aa8ff'); R(226, 69, 84, 1, '#4aa8ff');
  }

  /* ---------- Guion: escenas y viñetas ---------- */
  const N = 'Narrador', S = 'Señora', O = 'Operador PNP';
  const ESC = [
    { id: 'STORY_SCENE_1', paleta: '#d8b98c', beats: [
      { cam: [160, 90, 1], sp: N, tx: 'Todo parecía ser un día normal, hasta que recibió una nota que cambiaría lo que estaba ocurriendo en su hogar...' },
      { cam: [60, 118, 2], dur: 1900, ev: 'nota' },
      { cam: [110, 110, 2], dur: 3200, ev: 'camina' },
      { cam: [72, 112, 3], sp: S, tx: '¿Qué es esto...? No puede ser...' },
      { cam: [160, 90, 1], dur: 2600, ev: 'lee' }
    ] },
    { id: 'STORY_SCENE_2', paleta: '#c9a678', beats: [
      { cam: [180, 100, 1], sp: N, tx: 'Preocupada por lo que había encontrado afuera de su casa, decidió llamar inmediatamente a la Policía.', ev: 'llamada' },
      { cam: [250, 120, 2], dur: 2600, ev: 'exterior' },
      { cam: [225, 105, 2], sp: O, tx: 'Policía Nacional, buenas tardes. Manténgase a distancia, ya enviamos una unidad.' },
      { cam: [225, 105, 3], sp: S, tx: 'Gracias... por favor, vengan pronto.' }
    ] },
    { id: 'STORY_SIRENS', beats: [{ cam: [160, 90, 1], dur: 5200, ev: 'sirenas' }] },
    { id: 'STORY_SCENE_3', beats: [
      { cam: [160, 90, 1], dur: 4200, ev: 'llega' },
      { cam: [190, 100, 1], sp: N, tx: 'Los agentes llegaron al domicilio para atender la emergencia y evaluar la situación.', ev: 'bajan' },
      { cam: [220, 100, 2], sp: 'Policía', tx: 'Señora, aléjese, nosotros nos encargamos.' },
      { cam: [160, 90, 1], dur: 3000, ev: 'cierre' }
    ] }
  ];

  /* ---------- Dibujo por escena ---------- */
  function dibujar(si, bi, bt, T) {
    const id = ESC[si].id, b = ESC[si].beats[bi];
    if (id === 'STORY_SCENE_1') {
      interior();
      let sx = 160, o = { dir: -1, delantal: true, remover: bi === 0 || bi === 1, t: T };
      if (bi >= 1) una('s1n', () => SFX.papel());
      const notaX = bi === 0 ? null : bi === 1 ? lerp(46, 64, ease(bt / 800)) : 64;
      if (bi === 2) { const k = ease(bt / 2200); sx = lerp(160, 76, k); o.walk = k < 1 ? bt : 0; o.remover = false; if (bt > 2400) { o.nota = true; } }
      if (bi >= 3) { sx = 76; o.remover = false; o.nota = true; o.mood = 1; }
      if (notaX && !(bi === 2 && bt > 2400) && bi < 3) { R(notaX, 146, 9, 3, '#f4f0dc'); R(notaX + 1, 147, 5, 1, '#8a8470'); }
      senora(sx, 150, o);
      if (bi === 4) {   // primer plano de la nota
        g.setTransform(1, 0, 0, 1, 0, 0); R(0, 0, W, H, 'rgba(0,0,0,.6)');
        const sh = Math.round(Math.sin(bt * 0.03)); R(96 + sh, 24, 128, 132, '#f4f0dc'); R(96 + sh, 24, 128, 5, '#d9d2b8');
        for (let i = 0; i < 7; i++) R(110 + sh, 46 + i * 14, 70 + ((i * 37) % 36), 4, '#4a3a2a');
        R(196 + sh, 124, 14, 18, '#b01818'); R(200 + sh, 128, 6, 8, '#f4f0dc');
      }
    } else if (id === 'STORY_SCENE_2') {
      if (bi === 1) { calle(false); paquete(238, 146, T); }
      else {
        interior(); una('s2l', () => SFX.llamada());
        const k = ease(bt / 1800), caminando = bi === 0 && k < 1;
        const tel = bi === 0 ? bt > 2000 : true;
        senora(bi === 0 ? lerp(130, 232, k) : 232, 150, { dir: 1, walk: caminando ? bt : 0, telefono: tel, mood: 1, t: T });
        if (bi === 2) operador();
      }
    } else if (id === 'STORY_SIRENS') {
      calle(true, ((T / 160) | 0) % 2 ? 1 : -1);
      R(0, 0, W, H, 'rgba(0,0,0,' + Math.max(0, 0.7 - bt / 3000).toFixed(2) + ')');
      una('sir', () => rampa(A.siren, 0.28, 2.2));
    } else {
      calle(true, bi < 2 ? (((T / 180) | 0) % 2 ? 1 : -1) : (((T / 180) | 0) % 2 ? 1 : -1) * 0.6);
      const x0 = -70, x1 = 62;
      const carX = bi === 0 ? lerp(x0, x1, ease(bt / 3600)) : x1;
      if (bi === 0) una('lleg', () => rampa(A.siren, 0.34, 0.2));
      if (bi === 1) una('para', () => rampa(A.siren, 0.0, 1.4));
      paquete(238, 146, T);
      senora(292, 148, { dir: -1, mood: 1, t: T });
      R(280, 138, 40, 3, '#6a4a2a'); for (let x = 282; x < 320; x += 8) R(x, 138, 2, 12, '#6a4a2a');   // reja: zona segura
      patrulla(carX, 176, T, true);
      if (bi >= 1) {
        const k = ease(bt / (bi === 1 ? 4000 : 1200));
        const px = bi === 1 ? lerp(carX + 30, 176, k) : 176, w = bi === 1 && k < 1 ? bt : 0;
        policia(px, 146, { dir: 1, walk: w }); policia(px - 14, 148, { dir: 1, walk: w });
        una('pasos', () => { SFX.puerta(); setTimeout(() => SFX.paso(), 400); setTimeout(() => SFX.paso(), 700); });
      }
      if (bi === 3) R(0, 0, W, H, 'rgba(0,0,0,' + ease(bt / 2600).toFixed(2) + ')');
    }
    if (id === 'STORY_SCENE_1' || id === 'STORY_SCENE_2') {
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (id === 'STORY_SCENE_1' && bi === 4) R(0, 0, W, H, 'rgba(0,0,0,' + ease((bt - 1600) / 900).toFixed(2) + ')');
    }
    void b;
  }

  /* ---------- Motor: máquina de estados, cámara y diálogos ---------- */
  const raiz = $('div', 'pk');
  raiz.setAttribute('role', 'dialog'); raiz.setAttribute('aria-modal', 'true'); raiz.setAttribute('aria-label', 'PERUKISTAN: introducción');
  raiz.innerHTML = `
    <div class="pk-stage" id="pk-stage">
      <canvas id="pk-cv" width="${W}" height="${H}" aria-hidden="true"></canvas>
      <div class="pk-titulo" id="pk-titulo">
        <h1>PERUKISTAN</h1><p>“${SUBTITULO}”.</p>
        <button type="button" class="pk-btn" id="pk-jugar">JUGAR</button>
      </div>
      <div class="pk-texto" id="pk-texto" hidden><p>Minutos después...</p></div>
      <div class="pk-dialogo" id="pk-dialogo" hidden>
        <b id="pk-nombre"></b><p id="pk-linea"></p><i id="pk-sig">▼</i>
      </div>
      <div class="pk-barra">
        <button type="button" class="pk-mini" id="pk-mute" aria-label="Silenciar" aria-pressed="false">♪</button>
        <input type="range" id="pk-vol" min="0" max="100" value="60" aria-label="Volumen">
        <button type="button" class="pk-mini pk-omitir" id="pk-omitir">OMITIR ▶▶</button>
      </div>
    </div>`;

  const ref = {};
  let estado = 'INTRO_SCREEN', si = 0, bi = 0, bt0 = 0, T0 = 0, raf = 0, cam = { x: 160, y: 90, z: 1 }, ultimo = 0;
  let escr = { texto: '', n: 0, hecho: true, ult: 0 };

  function ponerEstado(e) { estado = e; raiz.dataset.estado = e; }

  function beatActual() { return ESC[si].beats[bi]; }
  function empezarBeat(ahora) {
    bt0 = ahora; const b = beatActual();
    if (b.ev === 'sirenas') { ref.texto.hidden = false; } else ref.texto.hidden = true;
    if (b.ev === 'camina') una('s1p', () => SFX.puerta());
    if (b.sp) {
      ref.dialogo.hidden = false; ref.nombre.textContent = b.sp; ref.nombre.dataset.quien = b.sp;
      escr = { texto: b.tx, n: 0, hecho: false, ult: ahora }; ref.linea.textContent = ''; ref.sig.style.visibility = 'hidden';
    } else { ref.dialogo.hidden = true; escr = { texto: '', n: 0, hecho: true, ult: ahora }; }
    hablando = !!b.sp;
  }
  function avanzarBeat(ahora) {
    const sc = ESC[si];
    if (bi + 1 < sc.beats.length) { bi++; return empezarBeat(ahora); }
    if (si + 1 < ESC.length) {
      si++; bi = 0; ponerEstado(ESC[si].id); empezarBeat(ahora); T0 = ahora;
      cam = { x: 160, y: 90, z: 1 }; return;
    }
    terminar();
  }
  function pulsar() {          // clic / Espacio / Enter
    if (estado === 'INTRO_SCREEN') return;
    audioInit();
    const b = beatActual(); if (!b || !b.sp) return;
    if (!escr.hecho) { escr.n = escr.texto.length; escr.hecho = true; ref.linea.textContent = escr.texto; ref.sig.style.visibility = 'visible'; hablando = false; return; }
    avanzarBeat(performance.now());
  }

  function bucle(ahora) {
    raf = requestAnimationFrame(bucle);
    if (estado === 'INTRO_SCREEN') {
      dibujarTitulo(ahora); return;
    }
    const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora;
    const b = beatActual(), bt = ahora - bt0, T = ahora - T0;
    if (b.sp && !escr.hecho) {
      const n = Math.min(escr.texto.length, Math.floor((ahora - escr.ult) / 28));
      if (n !== escr.n) { if (n % 2 === 0) voz(b.sp); escr.n = n; ref.linea.textContent = escr.texto.slice(0, n); }
      if (n >= escr.texto.length) { escr.hecho = true; hablando = false; ref.sig.style.visibility = 'visible'; }
    }
    if (!b.sp && bt >= b.dur) { avanzarBeat(ahora); return; }
    const k = 1 - Math.exp(-dt * 3.2);
    cam.x = lerp(cam.x, b.cam[0], k); cam.y = lerp(cam.y, b.cam[1], k); cam.z = lerp(cam.z, b.cam[2], k);
    g.setTransform(1, 0, 0, 1, 0, 0); R(0, 0, W, H, '#000');
    g.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z, H / 2 - cam.y * cam.z);
    dibujar(si, bi, bt, T);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function dibujarTitulo(t) {      // barrio residencial peruano de noche, con ventanas que parpadean
    g.setTransform(1, 0, 0, 1, 0, 0);
    calle(true, 0);
    R(0, 0, W, H, 'rgba(10,6,24,.35)');
    if (((t / 700) | 0) % 5 === 0) R(168, 52, 18, 18, '#ffe48a'); else R(168, 52, 18, 18, '#6a7a98');
    paquete(238, 146, t);
    senora(292, 148, { dir: -1, mood: 1, t });
    const f = ((t / 400) | 0) % 2 ? '#ff2a2a' : '#5a1010'; R(150, 24, 3, 3, f);
  }

  function terminar() {
    if (estado === 'LISTO') return;
    ponerEstado('LISTO');
    cancelAnimationFrame(raf); raf = 0;
    rampa(A.siren, 0, 0.2); rampa(A.drone, 0.0001, 0.8); rampa(A.calle, 0.0001, 0.8);
    raiz.classList.add('pk--sale');
    setTimeout(() => {
      raiz.hidden = true; document.body.classList.remove('intro-abierta');
      if (global.ManualUI && global.ManualUI.abrirManual) global.ManualUI.abrirManual();   // omitir o terminar lleva al manual, nunca directo al juego
    }, 450);
  }

  function iniciarHistoria() {
    audioInit(); rampa(A.drone, 0.05, 1.2); rampa(A.calle, 0.04, 1.5);
    si = 0; bi = 0; T0 = performance.now(); ultimo = T0; disparados.clear();
    ponerEstado(ESC[0].id); ref.titulo.hidden = true;
    cam = { x: 160, y: 90, z: 1 }; empezarBeat(T0);
  }

  function montar() {
    document.body.appendChild(raiz); document.body.classList.add('intro-abierta');
    ['stage', 'titulo', 'texto', 'dialogo', 'nombre', 'linea', 'sig'].forEach((k) => { ref[k] = raiz.querySelector(k === 'stage' ? '#pk-stage' : '#pk-' + (k === 'linea' ? 'linea' : k)); });
    cv = raiz.querySelector('#pk-cv'); g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    ponerEstado('INTRO_SCREEN');
    const ajustar = () => ref.stage.style.setProperty('--u', ref.stage.clientWidth / W + 'px');
    window.addEventListener('resize', ajustar); ajustar();
    raiz.querySelector('#pk-jugar').addEventListener('click', (e) => { e.stopPropagation(); iniciarHistoria(); });
    raiz.addEventListener('click', (e) => { if (!e.target.closest('button, input')) pulsar(); });
    raiz.querySelector('#pk-omitir').addEventListener('click', (e) => { e.stopPropagation(); terminar(); });
    const mute = raiz.querySelector('#pk-mute'), vol = raiz.querySelector('#pk-vol');
    mute.addEventListener('click', () => { audioInit(); A.mute = !A.mute; mute.setAttribute('aria-pressed', String(A.mute)); mute.textContent = A.mute ? '✕' : '♪'; aplicarVol(); });
    vol.addEventListener('input', () => { A.vol = vol.value / 100; aplicarVol(); });
    window.addEventListener('keydown', (e) => {
      if (raiz.hidden || estado === 'LISTO') return;
      if (e.key === ' ' || e.key === 'Enter') { if (e.target && e.target.tagName === 'BUTTON') return; e.preventDefault(); pulsar(); }
      else if (e.key === 'Escape' && estado !== 'INTRO_SCREEN') terminar();
    });
    raiz.addEventListener('pointerdown', () => { audioInit(); if (estado === 'INTRO_SCREEN') rampa(A.drone, 0.05, 1.2); }, { once: false });
    ultimo = performance.now(); raf = requestAnimationFrame(bucle);
  }
  global.PerukistanIntro = { get estado() { return estado; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})(window);
