/* =========================================================
   Minijuego de reconocimiento de criaturas (ficticio)
   - ControladorCriaturas: lógica pura (eventos, reacción, penalización)
   - CriaturasFactory(THREE, ...): modelos voxel, botones físicos y jumpscare
   Comparte vidas y tiempo con MiniJuego (puzzle.js) mediante juego.penalizar()
   ========================================================= */
(function (global) {
  'use strict';

  const CONFIG = {
    reaccionMs: 10000,             // tiempo para reaccionar a cada criatura
    primeraEsperaMs: [3000, 6000], // espera antes del primer evento
    esperaMs: [5000, 12000],       // espera aleatoria entre eventos
    jumpscareMs: 1100,             // duración configurable del jumpscare
    positivoMs: 700,               // pausa tras un acierto
    sonido: true
  };
  const BOTON_CORRECTO = { rata: 'derecho', mosca: 'izquierdo' };
  const E = { INACTIVO: 'INACTIVO', ESPERANDO: 'ESPERANDO', ACTIVA: 'ACTIVA', POSITIVO: 'POSITIVO', JUMPSCARE: 'JUMPSCARE' };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- Lógica pura (sin Three.js) ---------- */
  class ControladorCriaturas {
    constructor(juego, cb = {}, config = {}) {
      this.juego = juego;
      this.cb = cb;
      this.cfg = Object.assign({}, CONFIG, config);
      this.estado = E.INACTIVO;
      this.idEvento = 0;
      this.evento = null;
      this.proximoMs = 0;
      this.limiteMs = 0;
      this.finMs = 0;
    }
    get botonesActivos() { return this.estado === E.ACTIVA; }
    get reaccion() {                      // tiempo de reacción: independiente del contador global
      if (this.estado !== E.ACTIVA) return null;
      const restante = Math.max(0, (this.limiteMs - this.juego.ahora()) / 1000);
      return { restante, fraccion: restante * 1000 / this.cfg.reaccionMs, tipo: this.evento.tipo };
    }

    iniciar() { this.detener(); this.programar(true); }
    programar(primera) {
      const [a, b] = primera ? this.cfg.primeraEsperaMs : this.cfg.esperaMs;
      this.proximoMs = this.juego.ahora() + rnd(a, b);
      this.estado = E.ESPERANDO;
    }
    detener() {                           // stopCreatureSystem
      const estaba = this.estado !== E.INACTIVO;
      this.estado = E.INACTIVO;
      this.evento = null;
      if (estaba && this.cb.alDetener) this.cb.alDetener();
    }

    actualizar() {
      if (this.estado === E.INACTIVO) return;
      if (!this.juego.enCurso) { this.detener(); return; }   // partida terminada: no hay más eventos
      const ahora = this.juego.ahora();
      if (this.estado === E.ESPERANDO && ahora >= this.proximoMs) this.aparecer();
      else if (this.estado === E.ACTIVA && ahora >= this.limiteMs) this.fallar('tiempo');
      else if ((this.estado === E.POSITIVO || this.estado === E.JUMPSCARE) && ahora >= this.finMs) {
        this.evento = null;
        this.programar(false);
      }
    }

    aparecer() {                          // spawnRandomCreature (solo una criatura a la vez)
      if (this.estado !== E.ESPERANDO) return null;
      this.evento = { id: ++this.idEvento, tipo: Math.random() < 0.5 ? 'rata' : 'mosca' };
      this.limiteMs = this.juego.ahora() + this.cfg.reaccionMs;
      this.estado = E.ACTIVA;
      if (this.cb.alAparecer) this.cb.alAparecer(this.evento);
      return this.evento;
    }

    presionar(boton) {                    // handleCreatureButton
      if (this.estado !== E.ACTIVA) return null;              // botones desactivados
      const ev = this.evento;
      if (boton === BOTON_CORRECTO[ev.tipo]) {
        this.estado = E.POSITIVO;                             // sin vidas ni tiempo perdidos
        this.finMs = this.juego.ahora() + this.cfg.positivoMs;
        if (this.cb.alAcertar) this.cb.alAcertar(ev, boton);
        return 'acierto';
      }
      return this.fallar('error');
    }

    fallar(motivo) {
      if (this.estado !== E.ACTIVA) return null;
      const ev = this.evento;
      this.estado = E.JUMPSCARE;                              // cierra el evento: no se puede penalizar dos veces
      this.finMs = this.juego.ahora() + this.cfg.jumpscareMs;
      const r = this.juego.penalizar();                       // una vida y 10 s, igual que el minijuego matemático
      if (this.cb.alJumpscare) this.cb.alJumpscare(ev, motivo);
      if (r !== 'fallo') this.detener();                      // derrota: se detienen los eventos
      return r === 'fallo' ? 'fallo' : 'derrota';
    }
  }

  /* ---------- Iconos pixelados 12x12 de los botones ---------- */
  const ICONOS = {
    rata: {
      filas: ['............', '........gp..', '..ggggggggg.', '.ggggggggegp', 'tggggggggggp', '.tgggggggg..',
              '..tgggggg...', '..g.g..g.g..', '..g.g..g.g..', '............', '............', '............'],
      paleta: { g: '#9a9088', p: '#f0909f', e: '#111111', t: '#f0909f' }
    },
    mosca: {
      filas: ['............', '..ww....ww..', '.wwww..wwww.', '.wwww..wwww.', '..ww.bb.ww..', '...rrbbrr...',
              '....bbbb....', '....bbbb....', '....bbbb....', '...l.bb.l...', '..l..bb..l..', '............'],
      paleta: { b: '#3a3a46', w: '#bfe3ff', r: '#e03030', l: '#8a8a96' }
    }
  };

  /* ---------- Vista 3D ---------- */
  function CriaturasFactory(THREE, o) {
    const { scene, camera, juego } = o;
    const V = 0.1;                                            // tamaño de voxel de las criaturas
    const cfg = Object.assign({}, CONFIG, o.config);
    if (!camera.parent) scene.add(camera);

    const raiz = new THREE.Group();                           // vive en espacio de cámara: siempre al fondo
    camera.add(raiz);
    const unidad = new THREE.BoxGeometry(1, 1, 1);
    const M = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.05 }, extra));
    const mat = {
      rata: M(0x8a8078), rataOsc: M(0x5e5750), rosa: M(0xe58a9a), negro: M(0x0e0e12),
      mosca: M(0x1b1b22), moscaClara: M(0x3a3a46), pata: M(0x2a2a31),
      ojoMosca: M(0xd62828, { emissive: 0xd62828, emissiveIntensity: 0.7 }),
      ala: M(0xcfe8ff, { transparent: true, opacity: 0.55, roughness: 0.3, side: THREE.DoubleSide }),
      chispa: M(0x3ddc84, { emissive: 0x3ddc84, emissiveIntensity: 1 })
    };
    const vox = (p, m, w, h, d, x, y, z) => {
      const k = new THREE.Mesh(unidad, m);
      k.scale.set(w * V, h * V, d * V);
      k.position.set(x * V, y * V, z * V);
      p.add(k);
      return k;
    };

    function crearRata() {
      const g = new THREE.Group(), cuerpo = new THREE.Group();
      g.add(cuerpo);
      vox(cuerpo, mat.rata, 8, 3.5, 4.2, 0, 3.5, 0);
      vox(cuerpo, mat.rata, 3.2, 3.2, 3.4, 5.2, 3.7, 0);       // cabeza
      vox(cuerpo, mat.rosa, 1.6, 1.6, 1.8, 7.4, 3.2, 0);       // hocico
      vox(cuerpo, mat.negro, 0.8, 0.8, 0.8, 8.4, 3.2, 0);      // nariz
      for (const s of [-1, 1]) {
        vox(cuerpo, mat.rosa, 1, 1.8, 1.2, 4.6, 5.7, s * 1.5);   // orejas
        vox(cuerpo, mat.negro, 0.7, 0.7, 0.5, 6.4, 4.4, s * 1.75); // ojos
      }
      const patas = [];
      for (const sx of [-2.6, 2.6]) for (const sz of [-1.7, 1.7]) {
        const p = new THREE.Group();
        p.position.set(sx * V, 1.8 * V, sz * V);
        cuerpo.add(p);
        vox(p, mat.rataOsc, 1.1, 2, 1.1, 0, -1, 0);
        patas.push(p);
      }
      const cola = [];
      for (let i = 0; i < 6; i++) cola.push(vox(cuerpo, mat.rosa, 1.4, 0.7, 0.7, -5.2 - i * 1.3, 3.2, 0));
      g.userData = { tipo: 'rata', cuerpo, patas, cola, escala: 0.8 };
      return g;
    }

    function crearMosca() {
      const g = new THREE.Group(), cuerpo = new THREE.Group();
      g.add(cuerpo);
      vox(cuerpo, mat.mosca, 3.2, 2.4, 2.6, 0, 0, 0);           // tórax
      vox(cuerpo, mat.mosca, 3.4, 2.8, 2.8, -3, -0.3, 0);       // abdomen
      vox(cuerpo, mat.moscaClara, 0.8, 2.9, 2.9, -2.8, -0.3, 0);
      vox(cuerpo, mat.mosca, 2.2, 2.2, 2.4, 2.6, 0.2, 0);       // cabeza
      for (const s of [-1, 1]) vox(cuerpo, mat.ojoMosca, 1.5, 1.7, 1.2, 3.1, 0.6, s * 1.3);
      const alas = [], patas = [];
      for (const s of [-1, 1]) {
        const p = new THREE.Group();
        p.position.set(0, 1.3 * V, s * V);
        p.userData.lado = s;
        cuerpo.add(p);
        vox(p, mat.ala, 4, 0.25, 3, -0.5, 0, s * 1.6);
        alas.push(p);
      }
      for (const x of [-1.2, 0.2, 1.6]) for (const s of [-1, 1]) {
        const p = new THREE.Group();
        p.position.set(x * V, -1.1 * V, s * 0.8 * V);
        cuerpo.add(p);
        vox(p, mat.pata, 0.4, 1.6, 0.4, 0, -0.8, s * 0.4);
        patas.push(p);
      }
      g.userData = { tipo: 'mosca', cuerpo, alas, patas, escala: 1.5 };
      return g;
    }

    /* ----- Estado de la vista ----- */
    let tv = 0;                                               // reloj de la vista
    let cr = null;                                            // criatura visible
    let susto = null;                                         // jumpscare en curso
    const botones = {};
    let uBoton = 0.25;
    const easeBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);

    const overlay = document.createElement('div');
    overlay.id = 'susto';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    const chispas = [];
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Mesh(unidad, mat.chispa);
      c.visible = false;
      raiz.add(c);
      chispas.push({ m: c, v: new THREE.Vector3(), t0: 0 });
    }
    function lanzarRafaga(pos) {
      chispas.forEach((c) => {
        c.m.position.copy(pos);
        c.v.set(rnd(-1, 1), rnd(-0.4, 1.2), rnd(-0.5, 0.5)).multiplyScalar(1.6);
        c.t0 = tv;
        c.m.visible = true;
      });
    }

    /* ----- Eventos del controlador ----- */
    const limites = (tipo) => tipo === 'rata' ? { x0: -0.85, x1: 0.85, y0: -0.8, y1: -0.58 } : { x0: -0.85, x1: 0.85, y0: 0.1, y1: 0.85 };

    function aparecerCriatura(ev) {
      quitarCriatura();
      const g = ev.tipo === 'rata' ? crearRata() : crearMosca();
      raiz.add(g);
      const L = limites(ev.tipo);
      const nx = rnd(L.x0, L.x1), ny = rnd(L.y0, L.y1);
      cr = { g, tipo: ev.tipo, nx, ny, tx: nx, ty: ny, dir: Math.random() < 0.5 ? 1 : -1, vel: 0,
             modo: 'pausa', tModo: 0, finModo: rnd(0.3, 0.8), nacio: tv, saliendo: null };
      g.rotation.y = cr.dir > 0 ? 0 : Math.PI;
    }
    function quitarCriatura() { if (cr) { raiz.remove(cr.g); cr = null; } }
    function acertar() { if (cr && cr.saliendo === null) { cr.saliendo = tv; lanzarRafaga(cr.g.position); } }

    function audio() {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      sonido.ac = sonido.ac || new AC();
      if (sonido.ac.state === 'suspended') sonido.ac.resume();
      return sonido.ac;
    }
    // Los navegadores solo permiten audio tras un gesto: se prepara en el primer toque o tecla
    const desbloquear = () => { try { audio(); } catch (e) { /* opcional */ } };
    window.addEventListener('pointerdown', desbloquear, { once: true, capture: true });
    window.addEventListener('keydown', desbloquear, { once: true });

    function sonido() {                                       // mini chillido de 0,55 s
      if (!cfg.sonido) return;
      try {
        const a = audio();
        if (!a) return;
        const t0 = a.currentTime, dur = 0.55;
        const master = a.createGain();
        master.gain.setValueAtTime(0.0001, t0);
        master.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        master.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        master.connect(a.destination);
        [1, 1.5].forEach((m) => {                             // dos ondas desafinadas: suben y caen
          const o = a.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(300 * m, t0);
          o.frequency.exponentialRampToValueAtTime(1400 * m, t0 + 0.12);
          o.frequency.exponentialRampToValueAtTime(120 * m, t0 + dur);
          o.connect(master);
          o.start(t0);
          o.stop(t0 + dur);
        });
        const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
        const datos = buf.getChannelData(0);
        for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1;
        const ruido = a.createBufferSource(), gr = a.createGain();
        gr.gain.value = 0.4;
        ruido.buffer = buf;
        ruido.connect(gr).connect(master);
        ruido.start(t0);
      } catch (e) { /* el sonido es opcional */ }
    }

    function activarJumpscare(ev) {                           // triggerJumpscare
      quitarCriatura();
      if (susto) terminarSusto();
      const g = ev.tipo === 'rata' ? crearRata() : crearMosca();
      g.rotation.y = -Math.PI / 2;                            // la cabeza mira a la cámara
      raiz.add(g);
      susto = { g, t0: tv };
      overlay.style.setProperty('--susto-dur', cfg.jumpscareMs + 'ms');
      overlay.classList.remove('activo');
      void overlay.offsetWidth;                               // reinicia la animación CSS
      overlay.classList.add('activo');
      document.body.classList.add('sacudida');
      brillo('derecho', 0xff3b30, 600); brillo('izquierdo', 0xff3b30, 600);
      sonido();
    }
    function terminarSusto() {
      if (!susto) return;
      raiz.remove(susto.g);
      susto = null;
      overlay.classList.remove('activo');
      document.body.classList.remove('sacudida');
    }

    const ctrl = new ControladorCriaturas(juego, {
      alAparecer: aparecerCriatura, alAcertar: acertar, alJumpscare: activarJumpscare, alDetener: quitarCriatura
    }, cfg);

    /* ----- Botones físicos en los laterales del maletín ----- */
    function textura(def) {
      const c = document.createElement('canvas');
      c.width = c.height = 12;
      const x = c.getContext('2d');
      x.fillStyle = '#20242e'; x.fillRect(0, 0, 12, 12);
      def.filas.forEach((f, r) => [...f].forEach((ch, k) => { if (def.paleta[ch]) { x.fillStyle = def.paleta[ch]; x.fillRect(k, r, 1, 1); } }));
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function crearBotones(padre, U, matMetal) {
      uBoton = U;
      [{ id: 'derecho', lado: 1, icono: 'rata' }, { id: 'izquierdo', lado: -1, icono: 'mosca' }].forEach((d) => {
        const gb = new THREE.Group();
        gb.position.set(d.lado * 6.15 * U, -2.2 * U, 0);
        gb.userData.boton = d.id;
        padre.add(gb);
        const marco = new THREE.Mesh(unidad, matMetal);
        marco.scale.set(0.3 * U, 3.5 * U, 3.7 * U);
        marco.castShadow = marco.receiveShadow = true;
        gb.add(marco);
        const mp = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6, emissive: 0x000000 });
        const pad = new THREE.Mesh(unidad, mp);
        pad.scale.set(0.7 * U, 3 * U, 3 * U);
        pad.castShadow = pad.receiveShadow = true;
        gb.add(pad);
        const tex = textura(ICONOS[d.icono]);
        const mi = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
        const gi = new THREE.PlaneGeometry(2.6 * U, 2.6 * U);
        const ico = new THREE.Mesh(gi, mi);
        ico.rotation.y = d.lado * Math.PI / 2;
        gb.add(ico);
        botones[d.id] = { lado: d.lado, pad, ico, mp, mi, tex, gi, k: 0, empuje: -1, brillo: null };
      });
    }
    function botonEn(rayo, raizModelo) {                      // el primer objeto golpeado decide (respeta la oclusión)
      const h = rayo.intersectObject(raizModelo, true)[0];
      for (let ob = h && h.object; ob; ob = ob.parent) if (ob.userData && ob.userData.boton) return ob.userData.boton;
      return null;
    }
    function brillo(id, color, ms) { const b = botones[id]; if (b) b.brillo = { color, hasta: tv + ms / 1000, dur: ms / 1000 }; }

    // Gancho opcional (interferencias.js): el botón izquierdo tiene prioridad para eliminar la mosca ambiental.
    let alPulsarBoton = null;
    function manejarBoton(id) {
      if (juego.pausado) return null;                         // en pausa no hay reacciones ni penalizaciones
      if (botones[id]) botones[id].empuje = tv + 0.18;
      const aplastada = alPulsarBoton ? alPulsarBoton(id) : false;   // true si había mosca interfiriendo
      let r;
      if (aplastada) {
        // Sin penalización. Si además hay un evento de reconocimiento de mosca, se resuelve con sus reglas normales.
        const evMosca = ctrl.estado === E.ACTIVA && ctrl.evento && ctrl.evento.tipo === 'mosca';
        r = evMosca ? ctrl.presionar(id) : 'mosca';
      } else r = ctrl.presionar(id);
      brillo(id, r === 'acierto' || r === 'mosca' ? 0x3ddc84 : r === null ? 0xffffff : 0xff3b30, r === null ? 250 : 600);
      return r;
    }
    const alTeclado = (e) => {
      if (e.repeat) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') manejarBoton('izquierdo');
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') manejarBoton('derecho');
    };
    window.addEventListener('keydown', alTeclado);

    /* ----- Animación ----- */
    function animarCriaturas(dt) {
      if (!cr) return;
      const D = camera.position.length() + 3.5;               // siempre detrás del maletín
      const hH = D * Math.tan(camera.fov * Math.PI / 360), hW = hH * camera.aspect;
      const u = cr.g.userData, L = limites(cr.tipo);
      let jx = 0, jy = 0, hop = 0;
      cr.tModo += dt;

      if (cr.tipo === 'rata') {
        if (cr.modo === 'pausa') {
          jy = Math.sin(tv * 10) * 0.004;                     // olfatea
          u.patas.forEach((p) => { p.rotation.z *= 0.8; });
          if (cr.tModo >= cr.finModo) {
            cr.modo = 'correr'; cr.tModo = 0;
            cr.tx = rnd(L.x0, L.x1); cr.ty = rnd(L.y0, L.y1); cr.vel = rnd(0.5, 1.1);
            if (Math.abs(cr.tx - cr.nx) < 0.25) cr.tx = clamp(cr.nx + (cr.tx >= cr.nx ? 0.3 : -0.3), L.x0, L.x1);
            cr.dir = Math.sign(cr.tx - cr.nx) || 1;
          }
        } else {
          const dx = cr.tx - cr.nx, paso = cr.vel * dt;
          if (Math.abs(dx) <= paso) { cr.nx = cr.tx; cr.modo = 'pausa'; cr.tModo = 0; cr.finModo = rnd(0.3, 1.2); }
          else cr.nx += Math.sign(dx) * paso;
          cr.ny += (cr.ty - cr.ny) * Math.min(1, dt * 2);
          if (Math.random() < dt * 0.4) { cr.tx = rnd(L.x0, L.x1); cr.dir = Math.sign(cr.tx - cr.nx) || cr.dir; }  // cambio de dirección
          const ang = Math.sin(tv * 18) * 0.7;
          u.patas.forEach((p, i) => { p.rotation.z = (i === 0 || i === 3 ? 1 : -1) * ang; });
          hop = Math.abs(Math.sin(tv * 18)) * 0.02;
        }
        u.cola.forEach((s, i) => {
          s.position.y = 3.2 * V + Math.sin(tv * 7 + i * 0.7) * 0.35 * V * (i + 1) / 3;
          s.position.z = Math.sin(tv * 5 + i * 0.8) * 0.25 * V * i;
        });
      } else {
        if (cr.tModo >= cr.finModo) {
          cr.tModo = 0;
          if (Math.random() < 0.2) { cr.modo = 'suspendida'; cr.finModo = rnd(0.5, 1.3); }
          else {
            cr.modo = 'volar'; cr.finModo = rnd(0.25, 0.9);
            let x = cr.nx, y = cr.ny;
            for (let i = 0; i < 6; i++) {                     // evita quedarse detrás del maletín
              x = clamp(cr.nx + rnd(-0.45, 0.45), L.x0, L.x1);
              y = clamp(cr.ny + rnd(-0.35, 0.35), L.y0, L.y1);
              if (Math.abs(y) > 0.6 || Math.abs(x) > 0.45) break;
            }
            if (Math.abs(y) <= 0.6 && Math.abs(x) <= 0.45) { x = cr.nx < 0 ? -0.7 : 0.7; y = rnd(0.3, 0.8); }
            cr.tx = x; cr.ty = y;
            if (Math.abs(x - cr.nx) > 0.05) cr.dir = Math.sign(x - cr.nx);
          }
        }
        if (cr.modo === 'volar') {
          const k = 1 - Math.exp(-dt * 5);
          cr.nx += (cr.tx - cr.nx) * k;
          cr.ny += (cr.ty - cr.ny) * k;
        }
        jx = Math.sin(tv * 9) * 0.004;
        jy = Math.sin(tv * 7) * 0.012 + (cr.modo === 'suspendida' ? Math.sin(tv * 20) * 0.004 : 0);
        u.alas.forEach((w) => { w.rotation.x = -w.userData.lado * (0.3 + 0.6 * Math.sin(tv * 70)); });
        u.patas.forEach((p, i) => { p.rotation.z = Math.sin(tv * 12 + i) * 0.2; });
      }

      let s = easeBack(clamp((tv - cr.nacio) / 0.3, 0, 1));
      if (cr.saliendo !== null) {                             // acierto: salto y desaparición
        const q = clamp((tv - cr.saliendo) / 0.35, 0, 1);
        s *= 1 - q;
        hop += Math.sin(q * Math.PI) * 0.5;
        if (q >= 1) { quitarCriatura(); return; }
      }
      const g = cr.g;
      g.position.set((cr.nx + jx) * hW, (cr.ny + jy) * hH + hop, -D);
      g.scale.setScalar(u.escala * (D / 11) * Math.max(s, 0.0001));
      g.rotation.y += ((cr.dir > 0 ? 0 : Math.PI) - g.rotation.y) * Math.min(1, dt * 10);
      g.rotation.z = cr.tipo === 'mosca' && cr.modo === 'volar' ? clamp((cr.ty - cr.ny) * 1.2, -0.4, 0.4) : 0;
    }

    function animarSusto() {
      if (!susto) return;
      const p = ((tv - susto.t0) * 1000) / cfg.jumpscareMs;
      if (p >= 1) { terminarSusto(); return; }
      const u = susto.g.userData, rata = u.tipo === 'rata';
      const fin = rata ? { z: -4.2, y: -1.0, s: 3.2 } : { z: -3.4, y: 0, s: 4.2 };
      const a = 1 - Math.pow(1 - clamp(p / 0.2, 0, 1), 3);    // acercamiento rápido
      const j = p > 0.2 ? 0.06 : 0;
      susto.g.position.set((Math.random() - 0.5) * j * 2, fin.y + (Math.random() - 0.5) * j * 2, -10 + (fin.z + 10) * a);
      susto.g.scale.setScalar(1.5 + (fin.s - 1.5) * a);
      if (u.alas) u.alas.forEach((w) => { w.rotation.x = -w.userData.lado * (0.3 + 0.6 * Math.sin(tv * 70)); });
    }

    function animarBotones(dt) {
      Object.values(botones).forEach((b) => {
        b.k += ((tv < b.empuje ? 1 : 0) - b.k) * Math.min(1, dt * 30);
        b.pad.position.x = b.lado * (0.5 - 0.35 * b.k) * uBoton;
        b.ico.position.x = b.lado * (0.86 - 0.35 * b.k) * uBoton;
        let color = 0xffb000, inten = 0;
        if (b.brillo && tv < b.brillo.hasta) { color = b.brillo.color; inten = 1.4 * (b.brillo.hasta - tv) / b.brillo.dur; }
        b.mp.emissive.setHex(color);
        b.mp.emissiveIntensity = inten;
      });
      chispas.forEach((c) => {
        if (!c.m.visible) return;
        const q = (tv - c.t0) / 0.6;
        if (q >= 1) { c.m.visible = false; return; }
        c.m.position.addScaledVector(c.v, dt);
        c.m.scale.setScalar(0.12 * (1 - q));
      });
    }

    function actualizar(dt) {
      tv += dt;
      ctrl.actualizar();
      animarCriaturas(dt);
      animarSusto();
      animarBotones(dt);
    }

    function dispose() {
      ctrl.detener();
      terminarSusto();
      window.removeEventListener('keydown', alTeclado);
      window.removeEventListener('pointerdown', desbloquear, true);
      window.removeEventListener('keydown', desbloquear);
      overlay.remove();
      camera.remove(raiz);
      unidad.dispose();
      Object.values(mat).forEach((m) => m.dispose());
      Object.values(botones).forEach((b) => { b.mp.dispose(); b.mi.dispose(); b.tex.dispose(); b.gi.dispose(); });
    }

    return {
      ctrl, actualizar, crearBotones, botonEn, manejarBoton, dispose, crearRata, crearMosca,
      setAlPulsarBoton(fn) { alPulsarBoton = fn; },
      get botones() { return botones; },
      iniciar() { quitarCriatura(); ctrl.iniciar(); },
      detener() { ctrl.detener(); },
      get reaccion() { return ctrl.reaccion; }
    };
  }

  const API = { ControladorCriaturas, CONFIG, BOTON_CORRECTO, ICONOS, Estado: E };
  global.CriaturasFactory = CriaturasFactory;
  global.CriaturasAPI = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
