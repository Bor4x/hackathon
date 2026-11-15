/* =========================================================
   Juego: máquina de estados + interfaz del panel de la bomba
   Estados: 'inicio' → 'activo' → 'victoria' | 'derrota' → 'inicio'
   No conoce Three.js: avisa de lo que ocurre mediante `alEvento`.
   ========================================================= */
import { generarPuzzle, esCorrecta } from './puzzles.js';

const $ = (id) => document.getElementById(id);

export function formatearTiempo(segundos) {
  const s = Math.max(0, Math.ceil(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * @param {{ alEvento?: (nombre: string, juego: object) => void }} opciones
 *   Eventos: 'inicio', 'activo', 'error', 'victoria', 'derrota'.
 */
export function crearJuego({ maestro, alEvento = () => {} }) {
  const TOTAL = globalThis.MiniJuegoAPI.TIEMPO_INICIAL;   // reloj y vidas los lleva `maestro` (acertijos.js)
  const el = {
    panel: $('bomba'),
    reloj: $('bomba-reloj'),
    instruccion: $('bomba-instruccion'),
    lista: $('bomba-imagenes'),
    form: $('bomba-form'),
    entrada: $('bomba-input'),
    mensaje: $('bomba-mensaje'),
    velo: $('bomba-velo'),
    veloTitulo: $('velo-titulo'),
    veloTexto: $('velo-texto'),
    accion: $('bomba-accion'),
    lightbox: $('lightbox'),
    lightboxImg: $('lightbox-img'),
    lightboxPie: $('lightbox-pie')
  };

  let estado = 'inicio';
  let puzzle = null;
  let restanteMs = 0;
  let segundoMostrado = -1;
  let ultimoColocado = null;
  let imagenesOk = false;        // puzzle 1
  const enPausa = () => maestro.pausado;   // un único sistema de pausa (acertijos.js)

  /* ---------- Utilidades de interfaz ---------- */
  function mostrarMensaje(texto, tipo = '') {
    el.mensaje.textContent = texto;
    el.mensaje.dataset.tipo = tipo;
  }

  function pintarReloj() {
    const seg = Math.ceil(restanteMs / 1000);
    if (seg === segundoMostrado) return;
    segundoMostrado = seg;
    el.reloj.textContent = formatearTiempo(seg);
    el.reloj.classList.toggle('urgente', estado === 'activo' && seg <= 10);
  }

  function ponerEstado(nuevo) {
    estado = nuevo;
    el.panel.dataset.estado = nuevo;
    el.velo.hidden = nuevo === 'activo';
    el.entrada.disabled = nuevo !== 'activo' || imagenesOk;
  }

  function construirImagenes() {
    el.lista.replaceChildren();
    puzzle.imagenes.forEach((im, i) => {
      const li = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'bomba__imagen';
      boton.setAttribute('aria-label', `Ampliar imagen ${i + 1}, categoría ${im.categoria}`);

      const marco = document.createElement('span');
      marco.className = 'bomba__marco';
      const foto = document.createElement('img');
      foto.src = im.src;
      foto.alt = `Imagen ${i + 1} (pista de la categoría ${im.categoria})`;   // nunca el nombre
      foto.draggable = false;
      marco.append(foto);

      const pie = document.createElement('span');
      pie.className = 'bomba__pie';
      const etiqueta = document.createElement('b');
      etiqueta.textContent = `IMG ${i + 1}`;
      const cat = document.createElement('i');
      cat.textContent = im.categoria;
      pie.append(etiqueta, cat);

      boton.append(marco, pie);
      boton.addEventListener('click', () => abrirLightbox(i));
      li.append(boton);
      el.lista.append(li);
    });
    el.lista.dataset.cantidad = String(puzzle.imagenes.length);
  }

  /* ---------- Ampliar imagen (examinar con calma) ---------- */
  function abrirLightbox(i) {
    const im = puzzle.imagenes[i];
    el.lightboxImg.src = im.src;
    el.lightboxImg.alt = `Imagen ${i + 1} ampliada`;
    el.lightboxPie.textContent = `IMG ${i + 1} · ${im.categoria}`;
    el.lightbox.hidden = false;
    el.lightbox.querySelector('button').focus();
  }
  function cerrarLightbox() { el.lightbox.hidden = true; }
  el.lightbox.addEventListener('click', cerrarLightbox);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarLightbox(); });

  /* ---------- Estado 1: inicio ---------- */
  function reiniciar() {
    imagenesOk = false;
    puzzle = generarPuzzle(ultimoColocado);
    puzzle.segundos = TOTAL;     // combinación aleatoria + palabra secreta
    ultimoColocado = puzzle;
    puzzle.imagenes.forEach((im) => { new Image().src = im.src; });   // precarga

    restanteMs = puzzle.segundos * 1000;
    segundoMostrado = -1;
    construirImagenes();
    el.entrada.value = '';
    el.entrada.maxLength = 12;
    el.entrada.placeholder = '_'.repeat(puzzle.palabra.length);
    mostrarMensaje('');
    el.veloTitulo.textContent = 'Desactiva la bomba';
    el.veloTitulo.dataset.tipo = '';
    el.veloTexto.textContent =
      `Hay ${puzzle.imagenes.length} imágenes del Perú. Identifica la primera letra del nombre de cada una, ` +
      `júntalas en orden y escribe la palabra secreta. Además: acertijos al frente y colores atrás. Tienes ${formatearTiempo(puzzle.segundos)}.`;
    el.accion.textContent = 'Comenzar';
    el.instruccion.textContent =
      'Identifica qué es cada imagen peruana y junta la primera letra de cada nombre, en orden, para formar la palabra.';
    ponerEstado('inicio');
    pintarReloj();
    alEvento('inicio', api);
  }

  /* ---------- Estado 2: puzzle activo ---------- */
  function comenzar() {
    if (estado !== 'inicio') return;
    restanteMs = maestro.tiempo * 1000;
    ponerEstado('activo');
    pintarReloj();
    el.entrada.focus({ preventScroll: true });
    alEvento('activo', api);
  }

  /* ---------- Estados 3 y 4: comprobar respuesta ---------- */
  function comprobar(texto = el.entrada.value) {
    if (estado !== 'activo' || imagenesOk || enPausa()) return;
    if (!texto.trim()) {
      mostrarMensaje('ESCRIBE LA PALABRA SECRETA', 'aviso');
      return;
    }
    if (esCorrecta(puzzle, texto)) {
      imagenesOk = true;                         // puzzle 1 resuelto: NO detiene el reloj por sí solo
      el.entrada.disabled = true;
      maestro.completar('palabra');              // si faltan otros puzzles, la partida sigue
      const f = maestro.faltan.map((k) => k);
      mostrarMensaje(f.length ? `✔ PALABRA CORRECTA · FALTAN: ${f.join(' + ')}` : '✔ CÓDIGO CORRECTO', 'ok');
      alEvento('imagenes', api);
    } else {
      mostrarMensaje('✖ PALABRA INCORRECTA · INTÉNTALO DE NUEVO', 'error');
      el.entrada.select();
      el.form.classList.remove('sacudir');
      void el.form.offsetWidth;                  // reinicia la animación
      el.form.classList.add('sacudir');
      alEvento('error', api);                    // el temporizador sigue corriendo
    }
  }

  /* ---------- Victoria: la decide `maestro` cuando están los 3 puzzles ---------- */
  function ganar() {
    restanteMs = maestro.tiempo * 1000;
    pintarReloj();
    mostrarMensaje('✔ CÓDIGO CORRECTO', 'ok');
    el.veloTitulo.textContent = 'BOMBA DESACTIVADA';
    el.veloTitulo.dataset.tipo = 'ok';
    el.veloTexto.textContent =
      `Palabra secreta: ${puzzle.palabra}. Te sobraron ${formatearTiempo(restanteMs / 1000)}.`;
    el.accion.textContent = 'Jugar de nuevo';
    ponerEstado('victoria');
    alEvento('victoria', api);
  }

  /* ---------- Estado 5: tiempo agotado ---------- */
  function agotarTiempo() {
    restanteMs = 0;
    pintarReloj();
    mostrarMensaje('');
    el.veloTitulo.textContent = 'BOMBA EXPLOTADA';
    el.veloTitulo.dataset.tipo = 'error';
    el.veloTexto.textContent = `¡BOOM! ${maestro.vidas <= 0 ? 'Te quedaste sin vidas' : 'Se agotó el tiempo'}. La palabra secreta era ${puzzle.palabra}.`;
    el.accion.textContent = 'Reiniciar';
    ponerEstado('derrota');
    alEvento('derrota', api);
  }

  /** Se llama una vez por fotograma: refleja el reloj y el estado de `maestro`. */
  function actualizar() {
    restanteMs = maestro.tiempo * 1000;
    pintarReloj();
    if (estado !== 'activo') return;
    if (maestro.estado === 'WON') ganar();
    else if (maestro.estado === 'LOST') agotarTiempo();
  }

  /* ---------- Eventos de la interfaz ---------- */
  el.form.addEventListener('submit', (e) => { e.preventDefault(); comprobar(); });
  el.accion.addEventListener('click', () => (estado === 'inicio' ? maestro.iniciar() : maestro.reiniciar()));   // alIniciar de `maestro` arranca este módulo
  el.entrada.addEventListener('input', () => { if (el.mensaje.dataset.tipo !== 'ok') mostrarMensaje(''); });

  const api = {
    get estado() { return estado; },
    get restanteSeg() { return restanteMs / 1000; },
    get totalSeg() { return TOTAL; },
    get cantidad() { return puzzle.imagenes.length; },
    get pausado() { return enPausa(); },
    get imagenesCompletado() { return imagenesOk; },
    get coloresCompletado() { return maestro.modulos.colores; },
    comenzar, comprobar, reiniciar, actualizar,
    marcarColores() { maestro.completar('colores'); },
    /** Botón rojo 3D: inicia la partida o confirma lo que haya escrito. */
    confirmar() { if (estado === 'inicio') comenzar(); else if (!enPausa()) comprobar(); }
  };

  el.panel.hidden = false;
  reiniciar();
  return api;
}
