/* =========================================================
   Interferencias de rata y mosca (capa ambiental, ficticia)
   - Rata: trepa por el maletín siguiendo una red de superficies, intenta
     alcanzar los botones laterales y persigue el cursor SOLO de forma visual.
   - Mosca: vuela por la escena, se posa sobre la operación y desaparece
     al pulsar el botón izquierdo (sin vidas ni tiempo perdidos).
   Reutiliza los modelos voxel de criaturas.js (crearRata / crearMosca) y el
   ciclo de render existente: no crea intervalos ni temporizadores propios.
   Ninguna criatura recibe ni genera clics: sus mallas ignoran el raycast.
   ========================================================= */
(function (global) {
  'use strict';

  const CFG = {
    rataEspera: [4, 7],          // s hasta que aparece la rata tras iniciar
    rataVida: [32, 50],          // s que permanece antes de bajar y descansar
    rataDescanso: [6, 10],       // s fuera de escena
    moscaEspera: [2.5, 5],       // s hasta la primera mosca
    moscaReaparece: [8, 15],     // s hasta la siguiente mosca tras eliminarla
    posadaS: [3.5, 6],           // s que se queda posada sobre la operación
    cdAterrizajeS: [6, 11],      // s mínimos de vuelo entre dos aterrizajes
    escalaRata: 0.3,
    escalaMosca: 0.33
  };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const PUNTO_OP = { px: 150, py: 29 };          // centro de la operación en el canvas del minijuego (300x80)

  function InterferenciasFactory(THREE, o) {
    const { scene, camera, juego, criaturas, maletin, pantallaJuego, renderer } = o;
    const U = o.U || 0.25;
    const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

    /* ---------- Temporales reutilizables (sin basura por fotograma) ---------- */
    const tA = V3(), tB = V3(), tC = V3(), tX = V3(), tZ = V3(), tN = V3(), tP = V3(), tL = V3();
    const m4 = new THREE.Matrix4(), qT = new THREE.Quaternion();
    const inv = new THREE.Matrix4(), ro = V3(), rd = V3();
    const rayo = new THREE.Raycaster(), ndc = new THREE.Vector2();

    let T = 0;                                   // reloj propio (suma de dt)
    let activo = false;
    const puntero = { x: 0, y: 0, t: -99, ok: false };
    let cursorF = null, tCursor = 0;

    const ignorarRayos = (g) => g.traverse((m) => { if (m.isMesh) m.raycast = () => {}; });

    /* =====================================================
       SUPERFICIES DEL MALETÍN (unidades U, espacio local del maletín)
       Cada parche es un rectángulo transitable con ejes (a, b) y normal n.
       Los portales unen parches por un borde con una curva de tres puntos
       (la rata "da la vuelta" a la esquina sin atravesar el modelo).
       ===================================================== */
    const parche = (id, O, a, b, n, a0, a1, b0, b1) =>
      ({ id, O: V3(...O), a: V3(...a), b: V3(...b), n: V3(...n), a0, a1, b0, b1 });
    const P = {
      F:   parche('F',   [0, 0, 2.42],   [1, 0, 0], [0, 1, 0], [0, 0, 1],  -5.4, 5.4, -3.7, 3.7),   // frente (paneles)
      Rt:  parche('Rt',  [6.05, 0, 0],   [0, 0, 1], [0, 1, 0], [1, 0, 0],  -1.7, 1.7, -0.3, 3.7),   // lateral derecho, sobre el botón
      Lf:  parche('Lf',  [-6.05, 0, 0],  [0, 0, 1], [0, 1, 0], [-1, 0, 0], -1.7, 1.7, -0.3, 3.7),   // lateral izquierdo
      T:   parche('T',   [0, 4.05, 0],   [1, 0, 0], [0, 0, 1], [0, 1, 0],  -5.4, 5.4, 0.95, 1.8),   // tapa, franja delantera (esquiva el asa)
      PTR: parche('PTR', [0, -0.7, 0],   [1, 0, 0], [0, 0, 1], [0, 1, 0],   6.4, 6.8, -1, 1),       // parte superior del botón derecho
      PTL: parche('PTL', [0, -0.7, 0],   [1, 0, 0], [0, 0, 1], [0, 1, 0],  -6.8, -6.4, -1, 1),
      PFR: parche('PFR', [7, 0, 0],      [0, 0, 1], [0, 1, 0], [1, 0, 0],  -1, 1, -3.2, -1.5),      // cara exterior del botón derecho
      PFL: parche('PFL', [-7, 0, 0],     [0, 0, 1], [0, 1, 0], [-1, 0, 0], -1, 1, -3.2, -1.5)
    };
    // eje: componente (0=x,1=y,2=z) que identifica el punto del borde; f(e) -> [inicio, esquina, fin]
    const PORTALES = [
      { a: 'F',   b: 'Rt',  eje: 1, lo: -0.3, hi: 3.7,  f: (e) => [[5.4, e, 2.42], [6.05, e, 2.42], [6.05, e, 1.7]] },
      { a: 'F',   b: 'Lf',  eje: 1, lo: -0.3, hi: 3.7,  f: (e) => [[-5.4, e, 2.42], [-6.05, e, 2.42], [-6.05, e, 1.7]] },
      { a: 'F',   b: 'T',   eje: 0, lo: -5.4, hi: 5.4,  f: (e) => [[e, 3.7, 2.42], [e, 4.05, 2.42], [e, 4.05, 1.8]] },
      { a: 'Rt',  b: 'T',   eje: 2, lo: 0.95, hi: 1.7,  f: (e) => [[6.05, 3.7, e], [6.05, 4.05, e], [5.4, 4.05, e]] },
      { a: 'Lf',  b: 'T',   eje: 2, lo: 0.95, hi: 1.7,  f: (e) => [[-6.05, 3.7, e], [-6.05, 4.05, e], [-5.4, 4.05, e]] },
      { a: 'Rt',  b: 'PTR', eje: 2, lo: -1,   hi: 1,    f: (e) => [[6.05, -0.1, e], [6.1, -0.5, e], [6.4, -0.7, e]] },
      { a: 'Lf',  b: 'PTL', eje: 2, lo: -1,   hi: 1,    f: (e) => [[-6.05, -0.1, e], [-6.1, -0.5, e], [-6.4, -0.7, e]] },
      { a: 'PTR', b: 'PFR', eje: 2, lo: -1,   hi: 1,    f: (e) => [[6.8, -0.7, e], [7.0, -0.7, e], [7.0, -1.5, e]] },
      { a: 'PTL', b: 'PFL', eje: 2, lo: -1,   hi: 1,    f: (e) => [[-6.8, -0.7, e], [-7.0, -0.7, e], [-7.0, -1.5, e]] }
    ];
    const ADY = {};
    PORTALES.forEach((pr) => {
      (ADY[pr.a] = ADY[pr.a] || []).push({ a: pr.a, b: pr.b, pr, inv: false });
      (ADY[pr.b] = ADY[pr.b] || []).push({ a: pr.b, b: pr.a, pr, inv: true });
    });
    function proximoSalto(desde, hasta) {          // búsqueda en anchura: primer salto del camino más corto
      if (desde === hasta) return null;
      const visto = { [desde]: true };
      let frente = (ADY[desde] || []).map((h) => ({ h, primero: h }));
      while (frente.length) {
        const sig = [];
        for (const { h, primero } of frente) {
          if (h.b === hasta) return primero;
          if (visto[h.b]) continue;
          visto[h.b] = true;
          (ADY[h.b] || []).forEach((x) => sig.push({ h: x, primero }));
        }
        frente = sig;
      }
      return null;
    }
    const coords = (p, v) => [tA.copy(v).sub(p.O).dot(p.a), tA.dot(p.b)];

    /* =====================================================
       RATA
       ===================================================== */
    const ALT = 0.05;                                // separación mínima de la superficie (U)
    const rata = {
      g: null, u: null, modo: 'oculta', timer: 0, vida: 40, vidaT: 0,
      parche: 'F', pa: 0, pb: -3.7, posU: V3(), n: V3(0, 0, 1), dir: V3(0, 1, 0),
      portal: null, mov: 0, fase: 0, esc: 0, climbing: false,
      cola: [], paso: null, ultima: '', anim: '',
      pitch: 0, yaw: 0, crouch: 1, avance: 0, toque: 0, lado: 1, evitarHasta: 0
    };

    function crearRata() {
      rata.g = criaturas.crearRata();
      rata.u = rata.g.userData;
      ignorarRayos(rata.g);                          // jamás intercepta clics del jugador
      rata.g.visible = false;
      maletin.add(rata.g);
    }

    const puntoEn = (p, m) => [rnd(p.a0 + Math.min(m, (p.a1 - p.a0) / 2), p.a1 - Math.min(m, (p.a1 - p.a0) / 2)),
                               rnd(p.b0 + Math.min(m, (p.b1 - p.b0) / 2), p.b1 - Math.min(m, (p.b1 - p.b0) / 2))];

    function entrarRata() {
      const r = rata;
      r.modo = 'entrar'; r.parche = 'F';
      r.pa = rnd(-4, 4); r.pb = -3.7;                // aparece por el borde inferior y sube
      r.n.copy(P.F.n); r.dir.set(0, 1, 0);
      r.portal = null; r.cola = []; r.paso = null; r.esc = 0; r.vidaT = 0; r.vida = rnd(...CFG.rataVida);
      r.ultima = ''; r.anim = ''; r.toque = 0;
      r.g.visible = true;
      posarRata(0, true);
    }
    function ocultarRata() {
      const r = rata;
      r.modo = 'oculta'; r.g.visible = false; r.portal = null; r.cola = []; r.paso = null; r.toque = 0;
      r.timer = rnd(...CFG.rataDescanso);
    }

    /* ----- Movimiento sobre un parche ----- */
    function caminarHacia(r, ta, tb, v, dt) {
      const p = P[r.parche];
      ta = clamp(ta, p.a0, p.a1); tb = clamp(tb, p.b0, p.b1);
      const da = ta - r.pa, db = tb - r.pb, d = Math.hypot(da, db);
      if (d < 0.02) return true;
      const paso = Math.min(d, v * dt);
      r.pa += da / d * paso; r.pb += db / d * paso;
      r.dir.copy(p.a).multiplyScalar(da / d).addScaledVector(p.b, db / d);
      r.mov = v;
      return paso >= d - 1e-6;
    }

    function puntosPortal(hop, e) {
      const pts = hop.pr.f(e).map((q) => V3(q[0], q[1], q[2]));
      return hop.inv ? pts.reverse() : pts;
    }
    function iniciarPortal(r, hop, pts, v) {
      r.portal = { pts, s: 0, len: pts[0].distanceTo(pts[1]) + pts[1].distanceTo(pts[2]),
                   nA: P[hop.a].n, nB: P[hop.b].n, to: hop.b, v: v * 0.85 };
    }
    function avanzarPortal(r, dt) {
      const q = r.portal;
      q.s += q.v * dt / q.len;
      const s = Math.min(q.s, 1), k = 1 - s;
      const [p0, p1, p2] = q.pts;
      r.posU.set(0, 0, 0).addScaledVector(p0, k * k).addScaledVector(p1, 2 * k * s).addScaledVector(p2, s * s);
      r.n.copy(q.nA).lerp(q.nB, s).normalize();
      tA.copy(p1).sub(p0).multiplyScalar(2 * k);
      tB.copy(p2).sub(p1).multiplyScalar(2 * s);
      tA.add(tB);
      tA.addScaledVector(r.n, -tA.dot(r.n));
      if (tA.lengthSq() > 1e-6) r.dir.copy(tA.normalize());
      r.mov = q.v;
      if (q.s >= 1) {
        const pp = P[q.to];
        const [pa, pb] = coords(pp, p2);
        r.parche = q.to; r.pa = clamp(pa, pp.a0, pp.a1); r.pb = clamp(pb, pp.b0, pp.b1);
        r.n.copy(pp.n); r.portal = null;
      }
    }

    /* ----- Pasos: mover / esperar / perseguir / salir ----- */
    function pasoMover(r, s, dt) {
      const v = s.v || 3.5;
      if (r.parche !== s.p) {                        // hay que cambiar de superficie: trepar por el portal
        const hop = proximoSalto(r.parche, s.p);
        if (!hop) return true;                       // inalcanzable: se descarta el paso
        const e = clamp(r.posU.getComponent(hop.pr.eje), hop.pr.lo, hop.pr.hi);
        const pts = puntosPortal(hop, e);
        const [pa, pb] = coords(P[r.parche], pts[0]);
        if (caminarHacia(r, pa, pb, v, dt)) iniciarPortal(r, hop, pts, v);
        return false;
      }
      return caminarHacia(r, s.a, s.b, v, dt);
    }

    function mirarA(r, m) {
      if (m === 'camara') {
        tL.copy(camera.position); maletin.worldToLocal(tL);
        tA.copy(tL).sub(tB.copy(r.posU).multiplyScalar(U));
      } else tA.copy(m);
      tA.addScaledVector(r.n, -tA.dot(r.n));
      if (tA.lengthSq() > 1e-6) r.dir.copy(tA.normalize());
    }
    function pasoEsperar(r, s) {
      r.anim = s.anim || 'olfatear';
      if (s.lado) r.lado = s.lado;
      if (s.mirar) mirarA(r, s.mirar);
      return s.t >= s.d;
    }

    function pasoPerseguir(r, s, dt) {
      if (r.parche !== 'F') {                        // primero baja al frente (el reloj del paso se congela)
        pasoMover(r, { p: 'F', a: cursorF ? cursorF.a : 0, b: cursorF ? cursorF.b : 0, v: 6 }, dt);
        s.t -= dt;
        if (!cursorF && s.t < -6) return true;
        return false;
      }
      const c = cursorF;
      if (!c) return true;                           // el cursor salió del maletín
      const dx = c.a - r.pa, dy = c.b - r.pb, d = Math.hypot(dx, dy);
      if (d > 1.9) caminarHacia(r, c.a - dx / d * 1.3, c.b - dy / d * 1.3, 7.5, dt);
      else {                                         // se queda delante, mirando el cursor (no lo toca)
        r.anim = 'observar';
        r.dir.copy(P.F.a).multiplyScalar(dx / (d || 1)).addScaledVector(P.F.b, dy / (d || 1));
      }
      return s.t >= s.d;
    }

    /* ----- Planificación del comportamiento ----- */
    const jugando = () => juego.estado === 'PLAYING' || juego.estado === 'TRANSITION';
    function planificarRata() {
      const r = rata, q = r.cola;
      if (!['F', 'Rt', 'Lf', 'T'].includes(r.parche)) {
        q.push({ k: 'mover', p: 'F', a: rnd(-3, 3), b: rnd(-2, 2), v: 4 });
        r.ultima = 'volver'; return;
      }
      const op = [];
      const add = (n, w) => { if (n !== r.ultima) op.push([n, w]); };
      add('pasear', 3); add('correr', 1.6); add('trepar', 2.4); add('asomar', 1.4); add('observar', 1.2);
      if (jugando()) { add('boton', 2.8); add('cubrir', 2); }
      if (cursorF) add('perseguir', 3.2);
      let x = rnd(0, op.reduce((s, e) => s + e[1], 0)), eleg = op[0][0];
      for (const e of op) { if ((x -= e[1]) <= 0) { eleg = e[0]; break; } }
      r.ultima = eleg;
      const p = P[r.parche];
      switch (eleg) {
        case 'pasear': {
          const [a, b] = puntoEn(p, 0.6);
          q.push({ k: 'mover', p: p.id, a, b, v: rnd(2.5, 4.5) }, { k: 'esperar', d: rnd(0.4, 1.2), anim: 'olfatear' });
          break;
        }
        case 'correr': {                             // se agacha y sale disparada
          const [a, b] = puntoEn(p, 0.6);
          q.push({ k: 'esperar', d: 0.35, anim: 'agachar' }, { k: 'mover', p: p.id, a, b, v: 9 },
                 { k: 'esperar', d: 0.4, anim: 'olfatear' });
          break;
        }
        case 'trepar': {
          const dest = pick(['T', 'Rt', 'Lf', 'F'].filter((id) => id !== r.parche));
          const [a, b] = puntoEn(P[dest], 0.5);
          q.push({ k: 'mover', p: dest, a, b, v: 3 }, { k: 'esperar', d: rnd(1.2, 2.2), anim: 'observar', mirar: 'camara' });
          break;
        }
        case 'asomar': {
          if (Math.random() < 0.6) {
            q.push({ k: 'mover', p: 'T', a: rnd(-4, 4), b: 1.78, v: 3.5 },
                   { k: 'esperar', d: rnd(2, 3), anim: 'asomar', mirar: V3(0, 0, 1) });
          } else {
            const sg = Math.random() < 0.6 ? 1 : -1;
            q.push({ k: 'mover', p: 'T', a: sg * 5.3, b: rnd(1.1, 1.6), v: 3.5 },
                   { k: 'esperar', d: rnd(2, 3), anim: 'asomar', mirar: V3(sg, 0, 0) });
          }
          q.push({ k: 'esperar', d: 0.4, anim: 'olfatear' });
          break;
        }
        case 'observar':
          q.push({ k: 'esperar', d: rnd(1, 2.2), anim: 'observar', mirar: 'camara' });
          break;
        case 'boton': {                              // intenta alcanzar y pulsar un botón lateral (solo visual)
          const lado = Math.random() < 0.65 ? 1 : -1;
          const lat = lado > 0 ? 'Rt' : 'Lf', pad = lado > 0 ? 'PFR' : 'PFL';
          q.push({ k: 'mover', p: lat, a: rnd(-0.6, 0.6), b: 0.8, v: 4 },
                 { k: 'esperar', d: 0.8, anim: 'observar', mirar: V3(0, -1, 0) },      // mira el botón antes de bajar
                 { k: 'mover', p: pad, a: 0, b: -2.2, v: 2.3 },
                 { k: 'esperar', d: rnd(1.6, 2.4), anim: 'presionar', lado },
                 { k: 'esperar', d: 0.9, anim: 'fallo', lado },                       // intento fallido
                 { k: 'mover', p: lat, a: 0, b: 0.8, v: 5.5 });                        // retirada
          break;
        }
        case 'cubrir': {                             // se coloca delante de una viñeta de respuesta (clics la atraviesan)
          const i = Math.floor(rnd(0, 4)), px = 6 + i * 73 + 33.5, py = 63;
          q.push({ k: 'mover', p: 'F', a: (px / 300 - 0.5) * 9, b: -2.2 + (0.5 - py / 80) * 2.4, v: 5 },
                 { k: 'esperar', d: rnd(1.6, 3), anim: 'olfatear', mirar: 'camara' });
          break;
        }
        case 'perseguir':
          q.push({ k: 'perseguir', d: rnd(2.5, 4) }, { k: 'esperar', d: 0.3, anim: 'olfatear' });
          break;
        default: break;
      }
    }

    function updateRatBehavior(dt) {
      const r = rata;
      if (!r.g) return;
      r.mov = 0; r.climbing = false;
      if (r.modo === 'oculta') {
        if (activo) { r.timer -= dt; if (r.timer <= 0) entrarRata(); }
        return;
      }
      if (r.modo === 'entrar') {
        r.esc = Math.min(1, r.esc + dt / 0.45);
        if (r.esc >= 1) r.modo = 'activa';
        r.anim = 'olfatear';
      } else if (r.modo === 'salir') {
        r.esc -= dt / 0.4; r.anim = '';
        if (r.esc <= 0) { ocultarRata(); return; }
      } else {
        r.vidaT += dt;
        if (r.portal) avanzarPortal(r, dt);
        else {
          if (!r.paso && r.vidaT > r.vida && !r.saliendoPlan) {   // fin de su turno: baja y se marcha
            r.cola = [{ k: 'mover', p: 'F', a: rnd(-4, 4), b: -3.7, v: 6 }, { k: 'salir' }];
            r.saliendoPlan = true;
          }
          if (!r.paso) {
            if (!r.cola.length) planificarRata();
            r.paso = r.cola.shift() || null;
            if (r.paso) r.paso.t = 0;
          }
          const s = r.paso;
          if (s) {
            s.t += dt;
            let fin = false;
            r.anim = '';
            if (s.k === 'mover') fin = pasoMover(r, s, dt);
            else if (s.k === 'esperar') fin = pasoEsperar(r, s);
            else if (s.k === 'perseguir') fin = pasoPerseguir(r, s, dt);
            else if (s.k === 'salir') { r.modo = 'salir'; r.saliendoPlan = false; fin = true; }
            if (fin) r.paso = null;
          }
        }
        r.climbing = r.n.y < 0.5;
      }
    }

    /* ----- Pose y animación de la rata ----- */
    function posarRata(dt, inmediato) {
      const r = rata;
      if (!r.portal) {
        const p = P[r.parche];
        r.posU.copy(p.O).addScaledVector(p.a, r.pa).addScaledVector(p.b, r.pb);
        r.n.copy(p.n);
      }
      const bob = r.mov > 0 && !r.climbing ? Math.abs(Math.sin(r.fase)) * 0.012 : 0;
      r.avance += ((r.avanceObj || 0) - r.avance) * (inmediato ? 1 : 1 - Math.exp(-10 * dt));
      r.g.position.copy(r.posU).multiplyScalar(U).addScaledVector(r.n, ALT * U + bob).addScaledVector(r.dir, r.avance * U);
      const easeBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
      r.g.scale.setScalar(CFG.escalaRata * Math.max(0.0001, r.modo === 'entrar' ? easeBack(r.esc) : r.esc));

      tX.copy(r.dir); tX.addScaledVector(r.n, -tX.dot(r.n));
      if (tX.lengthSq() < 1e-6) tX.copy(P[r.parche].a);
      tX.normalize();
      tZ.crossVectors(tX, r.n);
      m4.makeBasis(tX, r.n, tZ); qT.setFromRotationMatrix(m4);
      if (inmediato) r.g.quaternion.copy(qT); else r.g.quaternion.slerp(qT, 1 - Math.exp(-10 * dt));
    }

    function animarRata(dt) {
      const r = rata, u = r.u, k = 1 - Math.exp(-12 * dt), a = r.anim;
      let pitch = 0, yaw = 0, crouch = 1, avance = 0, toque = 0;
      if (a === 'olfatear') pitch = Math.sin(T * 7) * 0.08;
      else if (a === 'observar') { yaw = Math.sin(T * 1.8) * 0.3; pitch = 0.08; }
      else if (a === 'asomar') { pitch = -0.7 + Math.sin(T * 3) * 0.12; avance = 0.35; yaw = Math.sin(T * 1.3) * 0.25; }
      else if (a === 'agachar') { crouch = 0.7; pitch = 0.12; }
      else if (a === 'presionar') { pitch = -0.2; toque = 0.5 + 0.5 * Math.sin(T * 16); }
      else if (a === 'fallo') { yaw = Math.sin(T * 26) * 0.45; pitch = 0.2; avance = -0.3; }
      r.pitch += (pitch - r.pitch) * k; r.yaw += (yaw - r.yaw) * k; r.crouch += (crouch - r.crouch) * k;
      r.avanceObj = avance; r.toque += (toque - r.toque) * Math.min(1, dt * 30);
      u.cuerpo.rotation.z = r.pitch; u.cuerpo.rotation.y = r.yaw; u.cuerpo.scale.y = r.crouch;

      if (r.mov > 0) {                               // patas alternas; más amplias al trepar
        r.fase += dt * (5 + r.mov * 1.5);
        const ang = Math.sin(r.fase) * (r.climbing ? 0.9 : 0.7);
        u.patas.forEach((p, i) => { p.rotation.z = (i === 0 || i === 3 ? 1 : -1) * ang; });
      } else if (a === 'presionar') {                // patas delanteras empujan la superficie del botón
        u.patas[2].rotation.z = Math.sin(T * 16) * 0.9 - 0.3;
        u.patas[3].rotation.z = Math.sin(T * 16 + Math.PI) * 0.9 - 0.3;
        u.patas[0].rotation.z *= 0.8; u.patas[1].rotation.z *= 0.8;
      } else u.patas.forEach((p) => { p.rotation.z *= 0.8; });

      u.cola.forEach((s, i) => {
        s.position.y = 3.2 * 0.1 + Math.sin(T * 7 + i * 0.7) * 0.35 * 0.1 * (i + 1) / 3;
        s.position.z = Math.sin(T * 5 + i * 0.8) * 0.25 * 0.1 * i;
      });
    }

    /* =====================================================
       MOSCA
       ===================================================== */
    const FOOT = 0.27 * CFG.escalaMosca + 0.004;     // distancia del centro del cuerpo a las patas
    const VOLANDO = ['volar', 'detener', 'orbitar', 'preAterrizar', 'circular'];
    const ACTIVAS = VOLANDO.concat(['descender', 'posada', 'despegar']);
    const mosca = {
      g: null, u: null, estado: 'oculta', timer: 0, t: 0, dur: 1, esc: 0,
      pos: V3(), vel: V3(), wp: V3(), fwd: V3(1, 0, 0), cd: 0,
      oc: V3(), ang: 0, rad: 0.22,
      lx: 0, ly: 0, tlx: 0, tly: 0, pausa: 0
    };

    function crearMosca() {
      mosca.g = criaturas.crearMosca();
      mosca.u = mosca.g.userData;
      ignorarRayos(mosca.g);
      mosca.g.visible = false;
      scene.add(mosca.g);
    }

    const camDist = () => camera.position.length();
    function dirNDC(nx, ny, out) { return out.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize(); }
    function puntoVista(nx, ny, t, out) { return out.copy(camera.position).addScaledVector(dirNDC(nx, ny, tC), camDist() * t); }

    // Caja que envuelve el maletín (con asa y botones) para que nada vuele a través de él
    function empujarFuera(pos) {
      tL.copy(pos); maletin.worldToLocal(tL);
      const hx = 7.5 * U, ymin = -4.7 * U, ymax = 6.9 * U, hz = 2.8 * U;
      if (Math.abs(tL.x) >= hx || tL.y <= ymin || tL.y >= ymax || Math.abs(tL.z) >= hz) return false;
      const d = [hx - Math.abs(tL.x), tL.y - ymin, ymax - tL.y, hz - Math.abs(tL.z)];
      const i = d.indexOf(Math.min(...d));
      if (i === 0) tL.x = Math.sign(tL.x || 1) * hx;
      else if (i === 1) tL.y = ymin; else if (i === 2) tL.y = ymax; else tL.z = Math.sign(tL.z || 1) * hz;
      maletin.localToWorld(tL);
      pos.copy(tL);
      return true;
    }
    function elegirWaypoint(cerca, out) {
      for (let i = 0; i < 8; i++) {
        puntoVista(rnd(-0.8, 0.8), rnd(-0.7, 0.75), cerca ? rnd(0.3, 0.5) : rnd(0.55, 1.15), out);
        tL.copy(out); maletin.worldToLocal(tL);
        if (!(Math.abs(tL.x) < 7.7 * U && tL.y > -4.9 * U && tL.y < 7.1 * U && Math.abs(tL.z) < 3 * U)) return out;
      }
      return out;
    }

    // Coordenadas del panel del minijuego -> espacio del mundo
    const lxDe = (px) => (px / 300 - 0.5) * 9 * U;
    const lyDe = (py) => (0.5 - py / 80) * 2.4 * U;
    const panelMundo = (lx, ly, lz, out) => pantallaJuego.localToWorld(out.set(lx, ly, lz));
    const normalPanel = (out) => out.set(0, 0, 1).transformDirection(pantallaJuego.matrixWorld);
    function puedeAterrizar() {
      if (!jugando()) return false;
      panelMundo(0, 0, 0, tP); normalPanel(tN);
      tA.copy(camera.position).sub(tP).normalize();
      return tN.dot(tA) > 0.5;                       // el panel debe verse de frente
    }

    function aparecerMosca() {
      const ev = criaturas.ctrl && criaturas.ctrl.evento;
      if (criaturas.ctrl && criaturas.ctrl.estado === 'ACTIVA' && ev && ev.tipo === 'mosca') { mosca.timer = 1; return; }  // evita dos moscas a la vez
      const m = mosca;
      puntoVista(pick([-1.1, 1.1]), rnd(-0.4, 0.7), rnd(0.7, 1.0), m.pos);
      m.vel.set(0, 0, 0); m.esc = 0; m.g.visible = true;
      m.cd = rnd(2, 5);
      elegirWaypoint(false, m.wp);
      volar(rnd(0.8, 2));
    }
    function volar(dur) { mosca.estado = 'volar'; mosca.t = 0; mosca.dur = dur; }

    function decidirVuelo() {
      const m = mosca, r = Math.random();
      if (m.cd <= 0 && puedeAterrizar() && r < 0.45) {   // cambia de patrón de vuelo y se prepara a posarse
        m.tlx = rnd(-0.5, 0.5); m.tly = rnd(lyDe(38), lyDe(22));
        m.estado = 'preAterrizar'; m.t = 0; m.dur = 5; return;
      }
      if (r < 0.2) { m.estado = 'detener'; m.t = 0; m.dur = rnd(0.4, 1); }
      else if (r < 0.4) { m.estado = 'orbitar'; m.t = 0; m.dur = rnd(1, 2); m.oc.copy(m.pos); m.ang = rnd(0, 6.28); }
      else if (r < 0.52) { elegirWaypoint(true, m.wp); volar(3); }        // se acerca a la cámara
      else { elegirWaypoint(false, m.wp); volar(rnd(0.8, 2)); }
    }

    function volarHacia(obj, vmax, resp, dt) {
      const m = mosca;
      tA.copy(obj).sub(m.pos);
      const d = tA.length();
      if (d > 1e-5) tA.multiplyScalar(Math.min(vmax, d * 2.2) / d);
      m.vel.lerp(tA, 1 - Math.exp(-resp * dt));
      m.pos.addScaledVector(m.vel, dt);
    }
    function orbitar(centro, ex, ey, rad, vel, dt) {
      const m = mosca;
      m.ang += vel * dt;
      tB.copy(centro).addScaledVector(ex, Math.cos(m.ang) * rad).addScaledVector(ey, Math.sin(m.ang) * rad * 0.7);
      volarHacia(tB, 2.5, 8, dt);
    }

    function updateFlyFlight(dt) {
      const m = mosca;
      if (!m.g) return;
      if (m.estado === 'oculta') {
        if (activo) { m.timer -= dt; if (m.timer <= 0) aparecerMosca(); }
        return;
      }
      m.t += dt;
      if (m.cd > 0 && m.estado !== 'posada') m.cd -= dt;
      const flotando = m.estado !== 'eliminada' && m.estado !== 'saliendo';
      if (flotando) m.esc = Math.min(1, m.esc + dt / 0.5);

      switch (m.estado) {
        case 'volar':
          volarHacia(m.wp, 1.5, 2.2, dt);
          if (m.t >= m.dur || m.pos.distanceTo(m.wp) < 0.22) decidirVuelo();
          break;
        case 'detener':
          m.vel.multiplyScalar(Math.exp(-4 * dt)); m.pos.addScaledVector(m.vel, dt);
          if (m.t >= m.dur) { elegirWaypoint(false, m.wp); volar(rnd(0.8, 2)); }
          break;
        case 'orbitar':
          tX.setFromMatrixColumn(camera.matrixWorld, 0); tZ.setFromMatrixColumn(camera.matrixWorld, 1);
          orbitar(m.oc, tX, tZ, 0.25, 5, dt);
          if (m.t >= m.dur) { elegirWaypoint(false, m.wp); volar(rnd(0.8, 2)); }
          break;
        case 'preAterrizar':
          if (!puedeAterrizar()) { elegirWaypoint(false, m.wp); volar(1.5); break; }
          panelMundo(m.tlx, m.tly, 0, tP); normalPanel(tN);
          tC.copy(tP).addScaledVector(tN, 0.5);
          volarHacia(tC, 2, 4, dt);
          if (m.pos.distanceTo(tC) < 0.12) { m.estado = 'circular'; m.t = 0; m.dur = rnd(1, 1.6); m.ang = 0; }
          else if (m.t > m.dur) { elegirWaypoint(false, m.wp); volar(1.5); }
          break;
        case 'circular': {
          if (!puedeAterrizar()) { elegirWaypoint(false, m.wp); volar(1.5); break; }
          panelMundo(m.tlx, m.tly, 0, tP); normalPanel(tN);
          tC.copy(tP).addScaledVector(tN, 0.45);
          tX.set(1, 0, 0).transformDirection(pantallaJuego.matrixWorld);
          tZ.set(0, 1, 0).transformDirection(pantallaJuego.matrixWorld);
          orbitar(tC, tX, tZ, 0.16, 7, dt);
          if (m.t >= m.dur) { m.estado = 'descender'; m.t = 0; }
          break;
        }
        case 'descender':
          if (!puedeAterrizar()) { elegirWaypoint(false, m.wp); volar(1.5); break; }
          panelMundo(m.tlx, m.tly, FOOT, tC);
          volarHacia(tC, 0.9, 6, dt);
          if (m.pos.distanceTo(tC) < 0.03) {
            m.estado = 'posada'; m.t = 0; m.dur = rnd(...CFG.posadaS);
            m.lx = m.tlx; m.ly = m.tly; m.pausa = rnd(0.2, 0.6); m.vel.set(0, 0, 0);
          }
          break;
        case 'posada': {
          if (!jugando()) { m.estado = 'despegar'; m.t = 0; break; }
          if (m.pausa > 0) m.pausa -= dt;
          else {
            const dx = m.tlx - m.lx, dy = m.tly - m.ly, d = Math.hypot(dx, dy);
            if (d < 0.01) {
              m.tlx = clamp(m.lx + rnd(-0.3, 0.3), lxDe(75), lxDe(225));
              m.tly = rnd(lyDe(38), lyDe(22)); m.pausa = rnd(0.3, 1.1);
            } else {
              const paso = Math.min(d, 0.14 * dt);
              m.lx += dx / d * paso; m.ly += dy / d * paso;
            }
          }
          panelMundo(m.lx, m.ly, FOOT, m.pos);
          if (m.t >= m.dur) { m.estado = 'despegar'; m.t = 0; }
          break;
        }
        case 'despegar':
          if (m.t < 0.02) { normalPanel(tN); m.vel.copy(tN).multiplyScalar(1.1).add(tA.set(rnd(-0.3, 0.3), rnd(0.2, 0.6), 0)); }
          m.pos.addScaledVector(m.vel, dt);
          if (m.t >= 0.7) { m.cd = rnd(...CFG.cdAterrizajeS); elegirWaypoint(false, m.wp); volar(rnd(1, 2)); }
          break;
        case 'eliminada':
          m.vel.y += 0.6 * dt; m.pos.addScaledVector(m.vel, dt);
          m.esc -= dt / 0.45;
          if (m.esc <= 0) { m.estado = 'oculta'; m.g.visible = false; m.timer = rnd(...CFG.moscaReaparece); }
          break;
        case 'saliendo':
          m.pos.addScaledVector(m.vel, dt);
          m.esc -= dt / 0.4;
          if (m.esc <= 0) { m.estado = 'oculta'; m.g.visible = false; m.timer = rnd(...CFG.moscaEspera); }
          break;
        default: break;
      }
      if (VOLANDO.includes(m.estado)) empujarFuera(m.pos);
      if (m.estado !== 'oculta') posarMosca(dt);
    }

    function posarMosca(dt) {
      const m = mosca, u = m.u, g = m.g;
      const aterrizada = m.estado === 'posada';
      tB.set(0, 0, 0);
      if (!aterrizada) tB.set(Math.sin(T * 9) * 0.008, Math.sin(T * 7) * 0.012, Math.cos(T * 8) * 0.008);
      g.position.copy(m.pos).add(tB);
      g.scale.setScalar(CFG.escalaMosca * Math.max(0.0001, m.esc));
      const k = 1 - Math.exp(-10 * dt);

      if (m.estado === 'eliminada') {
        g.rotateY(22 * dt);                          // retirada: gira y se encoge
      } else {
        if (aterrizada) {                            // sobre la pantalla: cuerpo paralelo al panel
          normalPanel(tN);
          tC.set(m.tlx - m.lx, m.tly - m.ly, 0);
          if (tC.lengthSq() > 1e-8) { tC.transformDirection(pantallaJuego.matrixWorld); m.fwd.copy(tC); }
        } else {
          if (m.estado === 'descender') normalPanel(tN); else tN.set(0, 1, 0);   // al aterrizar se alinea con el panel
          if (m.vel.lengthSq() > 0.0064) m.fwd.copy(m.vel).normalize();
        }
        tX.copy(m.fwd); tX.addScaledVector(tN, -tX.dot(tN));
        if (tX.lengthSq() > 1e-6) {
          tX.normalize(); tZ.crossVectors(tX, tN);
          m4.makeBasis(tX, tN, tZ); qT.setFromRotationMatrix(m4);
          g.quaternion.slerp(qT, k);
        }
      }
      // Alas y patas
      const flota = m.estado !== 'posada';
      const flap = flota ? 0.3 + 0.6 * Math.sin(T * 70)
                         : 0.08 + (Math.sin(T * 0.9) > 0.85 ? 0.35 * Math.sin(T * 60) : 0);
      u.alas.forEach((w) => { w.rotation.x = -w.userData.lado * flap; });
      const camina = aterrizada && m.pausa <= 0;
      u.patas.forEach((p, i) => { p.rotation.z = Math.sin(T * (camina ? 22 : 12) + i) * (camina ? 0.35 : 0.2); });
    }

    function puff(pos) {
      let n = 0;
      for (const c of chispas) {
        if (c.vivo) continue;
        c.vivo = true; c.t0 = T;
        c.m.position.copy(pos); c.m.visible = true;
        c.v.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.4, 0.9));
        if (++n >= 8) break;
      }
    }
    const geoPuff = new THREE.BoxGeometry(1, 1, 1);
    const matPuff = new THREE.MeshBasicMaterial({ color: 0xcfe8ff, toneMapped: false });
    const chispas = [];
    for (let i = 0; i < 10; i++) {
      const c = new THREE.Mesh(geoPuff, matPuff);
      c.visible = false; c.raycast = () => {};
      scene.add(c);
      chispas.push({ m: c, v: V3(), t0: 0, vivo: false });
    }
    function animarPuff(dt) {
      chispas.forEach((c) => {
        if (!c.vivo) return;
        const q = (T - c.t0) / 0.5;
        if (q >= 1) { c.vivo = false; c.m.visible = false; return; }
        c.m.position.addScaledVector(c.v, dt);
        c.m.scale.setScalar(0.04 * (1 - q));
      });
    }

    /* ---------- Eliminar mosca (botón lateral izquierdo) ---------- */
    function eliminarMosca() {
      const m = mosca;
      if (!ACTIVAS.includes(m.estado) || m.esc <= 0) return false;      // no hay mosca activa
      if (m.estado === 'posada') {
        normalPanel(tN); m.vel.copy(tN).multiplyScalar(1.4).add(tA.set(rnd(-0.4, 0.4), rnd(0.3, 0.8), 0));
      } else m.vel.multiplyScalar(1.2).add(tA.set(rnd(-0.3, 0.3), 0.8, 0));
      puff(m.pos);
      m.estado = 'eliminada'; m.t = 0;
      return true;
    }

    /* =====================================================
       INTERACCIONES ENTRE CRIATURAS, CURSOR Y BOTONES
       ===================================================== */
    function setPuntero(ev) {
      if (ev.pointerType && ev.pointerType === 'touch') return;
      const r = renderer.domElement.getBoundingClientRect();
      puntero.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      puntero.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      puntero.t = T; puntero.ok = true;
    }
    function limpiarPuntero() { puntero.ok = false; cursorF = null; }

    // Proyecta el cursor sobre el frente del maletín (solo lectura: jamás se altera el cursor real)
    function updateRatCursorInteraction(dt) {
      tCursor -= dt;
      if (tCursor > 0) return;
      tCursor = 0.08;
      if (!puntero.ok || T - puntero.t > 4 || !jugando()) { cursorF = null; return; }
      rayo.setFromCamera(ndc.set(puntero.x, puntero.y), camera);
      inv.copy(maletin.matrixWorld).invert();
      ro.copy(rayo.ray.origin).applyMatrix4(inv);
      rd.copy(rayo.ray.direction).transformDirection(inv);
      if (rd.z > -1e-4) { cursorF = null; return; }
      const t = (P.F.O.z * U - ro.z) / rd.z;
      if (t <= 0) { cursorF = null; return; }
      const a = (ro.x + rd.x * t) / U, b = (ro.y + rd.y * t) / U;
      cursorF = Math.abs(a) > 7 || Math.abs(b) > 5.5 ? null : { a: clamp(a, P.F.a0, P.F.a1), b: clamp(b, P.F.b0, P.F.b1) };
    }

    // Evita solapes y eventos duplicados entre ambas criaturas
    function updateCreatureInteractions() {
      const r = rata, m = mosca;
      if (!r.g || !r.g.visible || !m.g || !m.g.visible || r.modo === 'oculta' || m.estado === 'oculta') return;
      tP.copy(r.posU).multiplyScalar(U); maletin.localToWorld(tP);
      const d = tP.distanceTo(m.pos);
      if (d > 0.42) return;
      if (VOLANDO.includes(m.estado)) {              // la mosca se aparta
        tA.copy(m.pos).sub(tP).normalize();
        m.vel.addScaledVector(tA, 0.6);
        m.wp.copy(m.pos).addScaledVector(tA, 0.6);
      } else if ((m.estado === 'posada' || m.estado === 'descender') && T > r.evitarHasta &&
                 r.modo === 'activa' && !r.portal && ['F', 'Rt', 'Lf', 'T'].includes(r.parche)) {
        r.evitarHasta = T + 2.5;                     // la rata cambia de plan y se aleja
        tL.copy(m.pos); maletin.worldToLocal(tL);
        const p = P[r.parche], lx = tL.x / U;
        const [a, b] = puntoEn(p, 0.6);
        r.cola = [{ k: 'mover', p: p.id, a: r.parche === 'F' ? (lx > 0 ? rnd(-5, -2.5) : rnd(2.5, 5)) : a, b, v: 8 }];
        r.paso = null; r.ultima = 'huir';
      }
    }

    // Deformación visual mínima del botón cuando la rata lo "intenta" (no genera pulsación real)
    function aplicarToques() {
      const bs = criaturas.botones;
      if (!bs || !rata.g) return;
      const b = bs[rata.lado > 0 ? 'derecho' : 'izquierdo'];
      if (!b || rata.toque < 0.01) return;
      b.pad.position.x -= b.lado * rata.toque * 0.2 * U;
      b.ico.position.x -= b.lado * rata.toque * 0.2 * U;
    }

    /* =====================================================
       API
       ===================================================== */
    function iniciar() {                             // nueva partida: ambas criaturas empiezan de cero
      activo = true;
      if (rata.g) ocultarRata();
      rata.timer = rnd(...CFG.rataEspera);
      if (mosca.g) { mosca.estado = 'oculta'; mosca.g.visible = false; mosca.timer = rnd(...CFG.moscaEspera); }
      chispas.forEach((c) => { c.vivo = false; c.m.visible = false; });
    }
    function detener() {                             // fin de partida: se retiran suavemente
      activo = false;
      if (rata.g && rata.modo !== 'oculta') { rata.modo = 'salir'; rata.portal = null; rata.cola = []; rata.paso = null; rata.saliendoPlan = false; }
      if (mosca.g && mosca.estado !== 'oculta' && mosca.estado !== 'eliminada') {
        mosca.vel.set(0, 0.5, 0); mosca.estado = 'saliendo';
      }
    }
    function alPulsarBoton(id) { return id === 'izquierdo' ? eliminarMosca() : false; }

    function actualizar(dt) {
      T += dt;
      if (activo && !juego.enCurso) detener();
      if (!rata.g) return;
      camera.updateMatrixWorld();
      maletin.updateWorldMatrix(true, false);
      pantallaJuego.updateWorldMatrix(true, false);
      updateRatCursorInteraction(dt);
      updateRatBehavior(dt);
      if (rata.modo !== 'oculta') { animarRata(dt); posarRata(dt, false); }
      updateFlyFlight(dt);
      updateCreatureInteractions();
      animarPuff(dt);
      aplicarToques();
    }

    function dispose() {
      activo = false;
      if (rata.g) maletin.remove(rata.g);
      if (mosca.g) scene.remove(mosca.g);
      chispas.forEach((c) => scene.remove(c.m));
      geoPuff.dispose(); matPuff.dispose();          // los materiales de rata y mosca son de criaturas.js
      criaturas.setAlPulsarBoton(null);
    }

    crearRata();
    crearMosca();
    criaturas.setAlPulsarBoton(alPulsarBoton);

    return {
      actualizar, iniciar, detener, dispose, setPuntero, limpiarPuntero, eliminarMosca,
      estado() { return { rata: rata.modo, parche: rata.parche, mosca: mosca.estado }; }
    };
  }

  global.InterferenciasFactory = InterferenciasFactory;
  if (typeof module !== 'undefined' && module.exports) module.exports = { InterferenciasFactory, CFG };
})(typeof window !== 'undefined' ? window : globalThis);
