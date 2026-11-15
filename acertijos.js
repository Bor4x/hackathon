/* =========================================================
   Minijuego de 3 acertijos matemáticos (ficticio y decorativo)
   - Lógica pura: generación, validación, vidas, tiempo, estados
   - Presentación: dibuja en un canvas 2D que Three.js usa como textura
   ========================================================= */
(function (global) {
  'use strict';

  const W = 300, H = 80;
  const TIEMPO_INICIAL = 150;       // 02:30 (reloj único de todos los puzzles)
  const PENALIZACION = 10;          // segundos por error
  const VIDAS = 3;
  const INDEF = 'INDEF';
  const Estado = { READY: 'READY', PLAYING: 'PLAYING', TRANSITION: 'TRANSITION', WON: 'WON', LOST: 'LOST' };

  /* ---------- Generación y validación (sin nada visual) ---------- */
  const aleatorio = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  function mezclar(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const etiqueta = (v) => (v === INDEF ? 'Indefinido' : miles(v));

  // La respuesta correcta SIEMPRE se calcula aquí, nunca se lee de la interfaz.
  function resolver(p) {
    switch (p.tipo) {
      case 'potencia-cero': return p.a + p.b === 0 ? INDEF : Math.pow(p.a + p.b, 0);
      case 'aritmetica': return p.op === '×' ? p.a * p.b : p.a + p.b;
      case 'division': return p.b === 0 ? INDEF : p.a / p.b;
      default: throw new Error('Tipo de acertijo desconocido');
    }
  }
  const esCorrecta = (p, valor) => valor === resolver(p);
  const conOpciones = (p, valores) => { p.opciones = mezclar(valores.map((valor) => ({ valor }))); return p; };

  function acertijo1() {
    const a = aleatorio(2, 12), b = aleatorio(2, 12);
    return conOpciones({ tipo: 'potencia-cero', a, b }, [0, 1, a + b, a]);
  }

  const OPERACIONES = [[245, 36, '×'], [1250, 3875, '+'], [325, 48, '×'], [187, 54, '×'], [4260, 7385, '+'], [418, 27, '×']];
  function acertijo2() {
    const [a, b, op] = OPERACIONES[aleatorio(0, OPERACIONES.length - 1)];
    const p = { tipo: 'aritmetica', a, b, op };
    const c = resolver(p);
    const s = String(c);
    const cambiado = Number(s.slice(0, -2) + s[s.length - 1] + s[s.length - 2]);
    const set = new Set();
    mezclar([c + 10, c - 10, c + 100, c - 100, c + a, c - b, cambiado]).forEach((v) => { if (v > 0 && v !== c) set.add(v); });
    for (let k = 2; set.size < 3; k++) set.add(c + k * 20);
    return conOpciones(p, [c, ...[...set].slice(0, 3)]);
  }

  function acertijo3() {
    const a = [12, 18, 24, 36, 48][aleatorio(0, 4)];
    return conOpciones({ tipo: 'division', a, b: 0 }, [0, a, 1, INDEF]);
  }

  /* ---------- Paleta y utilidades visuales ---------- */
  const C = {
    fondo: '#0b0d12', borde: '#2e3442', texto: '#e9e6dc', tenue: '#7c8396',
    boton: '#1a2030', rojo: '#ff3b30', verde: '#3ddc84', ambar: '#ffb000'
  };
  const FUENTE = '"Silkscreen", "Courier New", monospace';
  const CORAZON = ['.#.#.', '#####', '#####', '.###.', '..#..'];

  class MiniJuego {
    constructor(opciones = {}) {
      this.reloj = opciones.ahora || (() => Date.now());
      this.pausado = false; this.pausaIni = 0; this.pausaAcum = 0;
      // Reloj virtual: se congela en pausa, así tiempo, transiciones y criaturas se detienen a la vez
      this.ahora = () => (this.pausado ? this.pausaIni : this.reloj()) - this.pausaAcum;
      this.alIniciar = null;
      this.canvas = null;
      this.ctx = null;
      if (!opciones.sinCanvas && typeof document !== 'undefined') {
        this.canvas = document.createElement('canvas');
        this.canvas.width = W;
        this.canvas.height = H;
        this.ctx = this.canvas.getContext('2d');
        if (document.fonts && document.fonts.load) {
          document.fonts.load('12px Silkscreen').then(() => { this.sucio = true; }).catch(() => {});
        }
      }
      this.resetear();
    }

    resetear() {
      this.estado = Estado.READY;
      this.vidas = VIDAS;
      this.indice = 0;
      this.acertijos = [acertijo1(), acertijo2(), acertijo3()];
      this.finMs = 0;
      this.tiempoFinal = TIEMPO_INICIAL;
      this.transHasta = 0;
      this.tras = null;
      this.flash = null;
      this.sacudidaHasta = 0;
      this.marca = null;
      this.arrastre = null;
      this.down = null;
      this.zonas = [];
      this.slot = null;
      this.sucio = true;
      this.mateListo = false;
      this.modulos = { mate: false, palabra: false, colores: false };
    }

    /* ----- Estado y tiempo (un único reloj, sin intervalos) ----- */
    get tiempo() {
      if (this.estado === Estado.READY) return TIEMPO_INICIAL;
      if (this.estado === Estado.WON || this.estado === Estado.LOST) return this.tiempoFinal;
      return Math.max(0, (this.finMs - this.ahora()) / 1000);
    }
    get enCurso() { return this.estado === Estado.PLAYING || this.estado === Estado.TRANSITION; }
    cambiar(e) { this.estado = e; this.sucio = true; }

    pausar(valor) {                      // ÚNICO sistema de pausa de toda la partida
      if (valor === this.pausado) return;
      const r = this.reloj();
      if (valor) { this.pausaIni = r; this.pausado = true; }
      else { this.pausaAcum += r - this.pausaIni; this.pausado = false; }
      this.sucio = true;
    }

    // Cada puzzle avisa aquí al resolverse; la partida se gana solo cuando están los TRES.
    completar(nombre) {
      if (!this.enCurso || this.pausado || this.modulos[nombre]) return false;
      this.modulos[nombre] = true;
      this.sucio = true;
      if (Object.values(this.modulos).every(Boolean)) {
        this.tiempoFinal = this.tiempo;
        this.cambiar(Estado.WON);
        return true;
      }
      return false;
    }
    get faltan() {
      return [['mate', 'ACERTIJOS'], ['palabra', 'PALABRA'], ['colores', 'COLORES']].filter(([k]) => !this.modulos[k]).map(([, n]) => n);
    }

    iniciar() {
      if (this.estado !== Estado.READY) return false;
      this.finMs = this.ahora() + TIEMPO_INICIAL * 1000;
      this.cambiar(Estado.PLAYING);
      if (this.alIniciar) this.alIniciar();
      return true;
    }
    reiniciar() { this.resetear(); return this.iniciar(); }

    actualizar() {                       // se llama una vez por fotograma
      if (!this.enCurso || this.pausado) return;
      if (this.tiempo <= 0) { this.perder(); return; }
      if (this.estado === Estado.TRANSITION && this.ahora() >= this.transHasta) {
        if (this.tras === 'avanzar') this.indice++;
        this.cambiar(Estado.PLAYING);
      }
    }

    /* ----- Reglas ----- */
    responder(valor) {
      if (this.estado !== Estado.PLAYING || this.pausado) return null;   // bloquea transición, pausa, victoria y derrota
      const p = this.acertijos[this.indice];
      const ok = esCorrecta(p, valor);
      const ahora = this.ahora();
      this.marca = { valor, ok, hasta: ahora + 600 };
      this.flash = { color: ok ? C.verde : C.rojo, ini: ahora, hasta: ahora + 500 };
      if (ok) {
        if (this.indice === this.acertijos.length - 1) {
          this.mateListo = true;
          if (!this.completar('mate')) {                  // faltan otros puzzles: la partida sigue
            this.tras = 'seguir';
            this.transHasta = ahora + 750;
            this.cambiar(Estado.TRANSITION);
          }
        } else {
          this.tras = 'avanzar';
          this.transHasta = ahora + 750;
          this.cambiar(Estado.TRANSITION);
        }
        return 'acierto';
      }
      if (this.penalizar() === 'derrota') return 'derrota';
      this.tras = 'seguir';
      this.transHasta = ahora + 450;
      this.cambiar(Estado.TRANSITION);
      return 'fallo';
    }

    // Penalización única y compartida por TODOS los minijuegos: una vida y 10 segundos
    penalizar() {
      if (!this.enCurso || this.pausado) return null;
      const ahora = this.ahora();
      this.vidas -= 1;
      this.finMs -= PENALIZACION * 1000;
      this.flash = { color: C.rojo, ini: ahora, hasta: ahora + 500 };
      this.sacudidaHasta = ahora + 400;
      this.sucio = true;
      if (this.vidas <= 0 || this.tiempo <= 0) { this.perder(); return 'derrota'; }
      return 'fallo';
    }

    perder() {
      if (this.estado === Estado.WON || this.estado === Estado.LOST) return;
      this.tiempoFinal = this.tiempo;
      this.cambiar(Estado.LOST);
    }

    colorDestello() {
      const f = this.flash;
      return f && this.ahora() < f.hasta ? (f.color === C.verde ? 0x3ddc84 : 0xff3b30) : 0xff3b30;
    }

    /* ----- Entrada (coordenadas en píxeles del canvas) ----- */
    zonaEn(x, y) {
      for (let i = this.zonas.length - 1; i >= 0; i--) {
        const z = this.zonas[i];
        if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z;
      }
      return null;
    }
    esInteractivo(x, y) { return !!this.zonaEn(x, y); }

    alPulsar(x, y) {
      const z = this.zonaEn(x, y);
      if (!z) return false;
      if (z.id === 'iniciar') return this.estado === Estado.READY && (this.iniciar(), true);
      if (z.id === 'reiniciar') return (this.estado === Estado.WON || this.estado === Estado.LOST) && (this.reiniciar(), true);
      if (this.estado !== Estado.PLAYING || this.pausado) return false;
      this.down = z.valor;
      if (this.acertijos[this.indice].tipo === 'potencia-cero') this.arrastre = { valor: z.valor, x, y };
      this.sucio = true;
      return true;
    }
    alMover(x, y) {
      if (this.arrastre) { this.arrastre.x = x; this.arrastre.y = y; this.sucio = true; }
    }
    alSoltar(x, y) {
      const arr = this.arrastre, down = this.down;
      this.arrastre = null;
      this.down = null;
      this.sucio = true;
      if (arr) {
        if (this.sobreSlot(x, y)) this.responder(arr.valor);
      } else if (down !== null) {
        const z = this.zonaEn(x, y);
        if (z && z.id === 'op' && z.valor === down) this.responder(down);
      }
    }
    sobreSlot(x, y, margen = 8) {
      const s = this.slot;
      return !!s && x >= s.x - margen && x <= s.x + s.w + margen && y >= s.y - margen && y <= s.y + s.h + margen;
    }

    /* ----- Presentación ----- */
    texto(s, x, y, tam, color, alinear = 'center') {
      const c = this.ctx;
      c.font = `${tam}px ${FUENTE}`;
      c.fillStyle = color;
      c.textAlign = alinear;
      c.textBaseline = 'middle';
      c.fillText(s, x, y);
    }
    corazon(x, y, lleno) {
      const c = this.ctx;
      c.fillStyle = lleno ? C.rojo : '#3a1d1f';
      CORAZON.forEach((fila, r) => [...fila].forEach((ch, k) => { if (ch === '#') c.fillRect(x + k * 2, y + r * 2, 2, 2); }));
    }
    boton(z, etiquetaBtn, color) {
      const c = this.ctx;
      c.fillStyle = C.boton; c.fillRect(z.x, z.y, z.w, z.h);
      c.strokeStyle = color; c.lineWidth = 2; c.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
      this.texto(etiquetaBtn, z.x + z.w / 2, z.y + z.h / 2 + 1, 10, color);
    }

    dibujar() {
      const c = this.ctx;
      if (!c) return false;
      const ahora = this.ahora();
      const animando = ahora < this.sacudidaHasta || !!this.arrastre || (this.flash && ahora < this.flash.hasta);
      if (!this.sucio && !animando) return false;
      this.sucio = !!animando;

      const e = this.estado;
      const p = this.acertijos[Math.min(this.indice, 2)];
      const zonas = [];
      const dx = ahora < this.sacudidaHasta ? Math.round(Math.sin(ahora / 18) * 3) : 0;

      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = C.fondo; c.fillRect(0, 0, W, H);
      c.setTransform(1, 0, 0, 1, dx, 0);

      // Cabecera: progreso y vidas
      this.texto(`ACERTIJO ${Math.min(this.indice + 1, 3)}/3`, 8, 8, 8, C.ambar, 'left');
      for (let i = 0; i < VIDAS; i++) this.corazon(W - 8 - (VIDAS - i) * 13, 3, i < this.vidas);

      // Enunciado
      const y = 29;
      this.slot = null;
      if (p.tipo === 'potencia-cero') {
        c.font = `15px ${FUENTE}`;
        const t1 = `(${p.a} + ${p.b})`;
        const w1 = c.measureText(t1).width;
        const w3 = c.measureText(' = ').width;
        c.font = `9px ${FUENTE}`;
        const w2 = c.measureText('0').width;
        const wSlot = 30;
        const x0 = (W - (w1 + w2 + w3 + wSlot)) / 2;
        this.texto(t1, x0, y, 15, C.texto, 'left');
        this.texto('0', x0 + w1, y - 7, 9, C.texto, 'left');
        this.texto(' = ', x0 + w1 + w2, y, 15, C.texto, 'left');
        const s = { x: x0 + w1 + w2 + w3, y: y - 10, w: wSlot, h: 20 };
        this.slot = s;
        const cerca = this.arrastre && this.sobreSlot(this.arrastre.x, this.arrastre.y);
        c.fillStyle = cerca ? '#2b2a10' : '#10131b'; c.fillRect(s.x, s.y, s.w, s.h);
        c.strokeStyle = cerca ? C.ambar : C.tenue; c.lineWidth = 2; c.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
        this.texto('?', s.x + s.w / 2, s.y + s.h / 2 + 1, 12, cerca ? C.ambar : C.tenue);
      } else if (p.tipo === 'aritmetica') {
        this.texto(`${miles(p.a)} ${p.op} ${miles(p.b)} = ?`, W / 2, y, 15, C.texto);
      } else {
        this.texto(`${p.a} ÷ ${p.b} = ?`, W / 2, y, 15, C.texto);
      }

      // Cuatro viñetas de respuesta
      p.opciones.forEach((op, i) => {
        const z = { id: 'op', valor: op.valor, x: 6 + i * 73, y: 50, w: 67, h: 26 };
        const m = this.marca && ahora < this.marca.hasta && this.marca.valor === op.valor ? this.marca : null;
        const arrastrada = this.arrastre && this.arrastre.valor === op.valor;
        c.fillStyle = arrastrada ? '#0f121a' : C.boton; c.fillRect(z.x, z.y, z.w, z.h);
        c.strokeStyle = m ? (m.ok ? C.verde : C.rojo) : C.tenue; c.lineWidth = 2;
        c.strokeRect(z.x + 1, z.y + 1, z.w - 2, z.h - 2);
        this.texto(etiqueta(op.valor), z.x + z.w / 2, z.y + z.h / 2 + 1, op.valor === INDEF ? 9 : 11, arrastrada ? C.tenue : C.texto);
        if (e === Estado.PLAYING) zonas.push(z);
      });
      if (this.arrastre) {
        const a = this.arrastre;
        c.fillStyle = C.ambar; c.fillRect(a.x - 20, a.y - 10, 40, 20);
        this.texto(etiqueta(a.valor), a.x, a.y + 1, 11, '#0b0d12');
      }

      if (this.mateListo && e !== Estado.READY) {         // acertijos terminados: indica qué falta
        zonas.length = 0;
        c.fillStyle = C.fondo; c.fillRect(3, 14, W - 6, H - 17);
        this.texto('ACERTIJOS RESUELTOS', W / 2, 30, 12, C.verde);
        if (this.faltan.length) this.texto(`FALTA: ${this.faltan.join(' + ')} (ATRAS)`, W / 2, 54, 8, C.ambar);
      }

      // Destello de acierto o error
      if (this.flash && ahora < this.flash.hasta) {
        c.globalAlpha = 0.35 * (1 - (ahora - this.flash.ini) / (this.flash.hasta - this.flash.ini));
        c.fillStyle = this.flash.color; c.fillRect(-4, 0, W + 8, H);
        c.globalAlpha = 1;
      }

      // Pantallas de inicio, victoria y derrota
      if (e === Estado.READY) {
        c.fillStyle = 'rgba(0,0,0,0.78)'; c.fillRect(-4, 0, W + 8, H);
        this.texto('3 PUZZLES · 3 VIDAS · 1 RELOJ', W / 2, 20, 9, C.texto);
        const z = { id: 'iniciar', x: 100, y: 36, w: 100, h: 28 };
        this.boton(z, 'INICIAR', C.verde); zonas.push(z);
      } else if (e === Estado.LOST || e === Estado.WON) {
        const gana = e === Estado.WON;
        c.fillStyle = gana ? 'rgba(0,25,10,0.8)' : 'rgba(0,0,0,0.82)'; c.fillRect(-4, 0, W + 8, H);
        this.texto(gana ? 'DESAFÍO COMPLETADO' : 'DESAFÍO FALLIDO', W / 2, 17, 13, gana ? C.verde : C.rojo);
        const t = Math.ceil(this.tiempo);
        this.texto(gana ? `TIEMPO RESTANTE ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
                        : (this.vidas <= 0 ? 'SIN VIDAS' : 'TIEMPO AGOTADO'), W / 2, 34, 9, C.texto);
        const z = { id: 'reiniciar', x: 90, y: 46, w: 120, h: 26 };
        this.boton(z, gana ? 'OTRA VEZ' : 'REINTENTAR', gana ? C.verde : C.rojo); zonas.push(z);
      }

      if (this.pausado && this.enCurso) {                 // pantalla de pausa
        zonas.length = 0;
        c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(-4, 0, W + 8, H);
        this.texto('PAUSA', W / 2, 30, 18, C.ambar);
        this.texto('REANUDA PARA CONTINUAR', W / 2, 56, 8, C.texto);
      }

      c.setTransform(1, 0, 0, 1, 0, 0);
      c.strokeStyle = e === Estado.WON ? C.verde : C.borde; c.lineWidth = 2; c.strokeRect(1, 1, W - 2, H - 2);
      this.zonas = zonas;
      return true;
    }
  }

  const API = { MiniJuego, Estado, resolver, esCorrecta, acertijo1, acertijo2, acertijo3, INDEF, PENALIZACION, TIEMPO_INICIAL };
  global.MiniJuego = MiniJuego;
  global.MiniJuegoAPI = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
