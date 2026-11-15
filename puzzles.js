/* =========================================================
   Datos y generación de puzzles (sin dependencias de DOM)
   ---------------------------------------------------------
   Cada imagen conoce internamente su nombre y su inicial.
   La inicial se DERIVA del nombre, así nunca se desincronizan.
   Para usar fotos reales basta con cambiar el `src` de una
   imagen (por ejemplo 'img/ceviche.jpg'); no hay que tocar nada más.
   ========================================================= */

/** Quita tildes, pasa a mayúsculas y elimina cualquier espacio. */
export function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

const img = (id, nombre, categoria) => ({
  id,
  nombre,                                   // solo interno: nunca se muestra al jugador
  categoria,
  inicial: normalizar(nombre)[0],
  src: new URL(`./img/${id}.svg`, import.meta.url).href
});

export const IMAGENES = [
  // Animales
  img('alpaca', 'Alpaca', 'Animal'),
  img('llama', 'Llama', 'Animal'),
  img('cuy', 'Cuy', 'Animal'),
  img('condor', 'Cóndor andino', 'Animal'),
  img('gallito', 'Gallito de las rocas', 'Animal'),
  img('guacamayo', 'Guacamayo', 'Animal'),
  img('oso', 'Oso de anteojos', 'Animal'),
  img('pinguino', 'Pingüino de Humboldt', 'Animal'),
  img('tucan', 'Tucán', 'Animal'),
  // Comida y productos
  img('anticuchos', 'Anticuchos', 'Comida'),
  img('ceviche', 'Ceviche', 'Comida'),
  img('papa', 'Papa nativa', 'Comida'),
  img('limon', 'Limón', 'Fruta'),
  img('maiz', 'Maíz', 'Comida'),
  img('palta', 'Palta', 'Fruta'),
  img('uva', 'Uva', 'Fruta'),
  img('coca', 'Hoja de coca', 'Planta'),
  img('pisco', 'Pisco', 'Bebida'),
  // Lugares y cultura
  img('machupicchu', 'Machu Picchu', 'Lugar'),
  img('lago', 'Lago Titicaca', 'Lugar'),
  img('inti', 'Inti', 'Historia'),
  img('marinera', 'Marinera', 'Danza')
];

/* Palabras posibles (3 a 6 letras). Cada una se valida al cargar el módulo:
   solo se admite si hay imágenes DISTINTAS suficientes para cada una de sus letras. */
const PALABRAS_CANDIDATAS = [
  'OLA', 'ALA', 'LIMA', 'PAPA', 'COCA', 'MACA', 'PUMA', 'LAGO', 'PALTA', 'PATO', 'CAMA', 'CALMA', 'COPA', 'PICO', 'GOMA',
  'TOMA', 'LOMA', 'CAPA', 'TAPA', 'MAGMA'
];

const porInicial = new Map();
for (const im of IMAGENES) {
  if (!porInicial.has(im.inicial)) porInicial.set(im.inicial, []);
  porInicial.get(im.inicial).push(im);
}

function esResoluble(palabra) {
  const necesarias = new Map();
  for (const l of palabra) necesarias.set(l, (necesarias.get(l) || 0) + 1);
  for (const [l, n] of necesarias) {
    if ((porInicial.get(l)?.length || 0) < n) return false;
  }
  return palabra.length >= 3 && palabra.length <= 6;
}

export const PALABRAS = PALABRAS_CANDIDATAS.filter(esResoluble);

function mezclar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Tiempo de partida según la dificultad: 105 s para 3 letras, +20 s por letra extra. */
export function tiempoPara(longitud) {
  return 45 + 20 * longitud;
}

/**
 * Genera un puzzle aleatorio: elige una palabra y, para cada letra, una imagen
 * cuya inicial coincide (sin repetir imágenes dentro del mismo puzzle).
 * `previo` evita repetir inmediatamente la misma palabra.
 */
export function generarPuzzle(previo = null) {
  const opciones = PALABRAS.filter((p) => p !== previo?.palabra);
  const palabra = opciones[Math.floor(Math.random() * opciones.length)];

  const usadas = new Set();
  const imagenes = [...palabra].map((letra) => {
    const libres = mezclar(porInicial.get(letra)).filter((im) => !usadas.has(im.id));
    const elegida = libres[0];
    usadas.add(elegida.id);
    return elegida;
  });

  return {
    palabra,                                 // la palabra secreta (solo interna)
    imagenes,
    segundos: tiempoPara(palabra.length)
  };
}

/** Compara ignorando mayúsculas, tildes y espacios accidentales. */
export function esCorrecta(puzzle, intento) {
  return normalizar(intento) === puzzle.palabra;
}
