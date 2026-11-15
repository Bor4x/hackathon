/* =========================================================
   Puzzle 2: sincronización de colores (lógica pura, sin Three.js)
   Estados: 'preparado' → 'activo' ⇄ 'error' → 'completado' | 'agotado'
   No tiene reloj propio: la velocidad depende del tiempo restante REAL
   de la partida (juego.restanteSeg) y avanza con el `dt` que le pase el
   bucle principal (dt = 0 en pausa).
   ========================================================= */

/** Los tres primarios y los tres secundarios. La comparación es siempre por `id`. */
export const COLORES = [
  { id: 'rojo',     nombre: 'ROJO',     hex: 0xEF2929 },
  { id: 'amarillo', nombre: 'AMARILLO', hex: 0xF5D928 },
  { id: 'azul',     nombre: 'AZUL',     hex: 0x245BE8 },
  { id: 'naranja',  nombre: 'NARANJA',  hex: 0xF28C28 },
  { id: 'verde',    nombre: 'VERDE',    hex: 0x27A94D },
  { id: 'violeta',  nombre: 'VIOLETA',  hex: 0x8736C8 }
];

/** [segundos restantes, segundos entre cambios], de más a menos tiempo.
 *  Menos tiempo → cambios MÁS LENTOS. Entre puntos se interpola de forma lineal. */
export const VELOCIDADES = [[100, 0.45], [75, 0.65], [50, 0.95], [25, 1.5], [10, 2.2], [1, 3.2]];

export function intervaloPara(restanteSeg, tabla = VELOCIDADES) {
  if (restanteSeg >= tabla[0][0]) return tabla[0][1];
  for (let i = 0; i < tabla.length - 1; i++) {
    const [s0, i0] = tabla[i], [s1, i1] = tabla[i + 1];
    if (restanteSeg >= s1) return i0 + (i1 - i0) * ((s0 - restanteSeg) / (s0 - s1));
  }
  return tabla[tabla.length - 1][1];
}

function mezclar(a) {
  a = [...a];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** @param {{ juego: () => object, alCambio?: (tipo: string) => void }} o  `juego()` devuelve la API de juego.js */
export function crearColores({ juego, alCambio = () => {} }) {
  let estado = 'preparado', objetivo = COLORES[0], actual = null, cola = [], espera = 0, errorT = 0;

  function siguiente() {
    if (!cola.length) {                                // bolsa aleatoria: recorre los seis; nunca repite seguido
      do { cola = mezclar(COLORES); } while (actual && cola[cola.length - 1].id === actual.id);
    }
    actual = cola.pop();
    espera = intervaloPara(juego().restanteSeg);       // se mide con el reloj general
    alCambio('color');
  }

  const api = {
    get estado() { return estado; },
    get objetivo() { return objetivo; },
    get actual() { return actual; },
    get completado() { return estado === 'completado'; },
    reiniciar() {                                      // nueva partida: objetivo nuevo, fijo hasta el siguiente reinicio
      objetivo = COLORES[Math.floor(Math.random() * COLORES.length)];
      estado = 'preparado'; actual = null; cola = []; errorT = 0;
      alCambio('estado');
    },
    iniciar() { if (estado === 'preparado') { estado = 'activo'; siguiente(); alCambio('estado'); } },
    agotar() { if (estado !== 'completado') { estado = 'agotado'; alCambio('estado'); } },
    actualizar(dt) {
      if (estado === 'error' && (errorT -= dt) <= 0) { estado = 'activo'; alCambio('estado'); }
      if (estado !== 'activo' && estado !== 'error') return;
      if (juego().estado !== 'activo') return;
      if ((espera -= dt) <= 0) siguiente();
    },
    /** Botón físico. Devuelve 'acierto' | 'error' | 'ignorado'. */
    presionar() {
      const j = juego();
      if ((estado !== 'activo' && estado !== 'error') || j.estado !== 'activo' || j.pausado) return 'ignorado';
      if (actual.id === objetivo.id) {
        estado = 'completado'; alCambio('estado');
        j.marcarColores();                              // la bomba solo se desactiva si el puzzle 1 también está hecho
        return 'acierto';
      }
      estado = 'error'; errorT = 0.8; alCambio('estado');
      return 'error';                                   // el tiempo general NO se toca
    }
  };
  return api;
}
