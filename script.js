import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { crearJuego, formatearTiempo } from './juego.js';
import { crearEfectos } from './efectos.js';
import { crearColores, COLORES } from './colores.js';

/* =========================================================
   Maletín voxel 3D (objeto decorativo y ficticio)
   ========================================================= */

const contenedor = document.getElementById('escena');
const btnPausa = document.getElementById('btn-pausa');
const btnReset = document.getElementById('btn-reset');
const btnFondo = document.getElementById('btn-fondo');

const U = 0.25;                                   // tamaño de un "voxel" en unidades de escena
const POS_INICIAL = new THREE.Vector3(3.6, 2.1, 6.4);
const VEL_GIRO = 0.45;                            // rad/s
const GIRO_TRASERO = Math.PI;                    // la placa del panel está detrás: se gira el maletín 180°
const ANCHO_PANEL = 1000;                         // tamaño de diseño del panel (px) y su
const ALTO_PANEL = 340;                           // proporción sobre la tapa: 10 x 3.4 voxels
const TAU = Math.PI * 2;

/* ---------- Renderizador con transparencia real ---------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  contenedor.innerHTML = '<p class="error">Tu navegador no pudo iniciar WebGL.</p>';
  throw e;
}
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
contenedor.appendChild(renderer.domElement);

const scene = new THREE.Scene();                  // sin background: el canvas queda transparente
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.copy(POS_INICIAL);
scene.add(camera);                               // las criaturas viven en espacio de cámara

/* ---------- Controles ---------- */
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 14;
controls.target.set(0, 0, 0);

/* ---------- Iluminación (da volumen sin escenario) ---------- */
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a5568, 0.7));

const luzPrincipal = new THREE.DirectionalLight(0xfff1dc, 2.4);
luzPrincipal.position.set(4, 6, 5);
luzPrincipal.castShadow = true;
luzPrincipal.shadow.mapSize.set(1024, 1024);
luzPrincipal.shadow.camera.left = luzPrincipal.shadow.camera.bottom = -3;
luzPrincipal.shadow.camera.right = luzPrincipal.shadow.camera.top = 3;
luzPrincipal.shadow.bias = -0.0005;
scene.add(luzPrincipal);

const luzContorno = new THREE.DirectionalLight(0x9db8ff, 1.3);   // contraste en los bordes
luzContorno.position.set(-5, 2, -5);
scene.add(luzContorno);

const luzRelleno = new THREE.DirectionalLight(0xffffff, 0.5);
luzRelleno.position.set(3, -3, 4);
scene.add(luzRelleno);

const luzPantalla = new THREE.PointLight(0xff3b30, 0.6, 4);       // brillo rojo discreto
luzPantalla.position.set(0, 0.6, 1.3);

/* ---------- Pantalla digital (canvas con píxeles grandes) ---------- */
const FUENTE = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111',
  '3': '111001111001111', '4': '101101111001001', '5': '111100111001111',
  '6': '111100111101111', '7': '111001001001001', '8': '111101111101111',
  '9': '111101111001111', ':': '000010000010000',
  A: '010101111101101', B: '110101110101110', E: '111100110100111',
  F: '111100110100100', M: '101111111101101', O: '111101101101111', S: '111100111001111'
};

const lienzo = document.createElement('canvas');
lienzo.width = 96;                                // pantalla ancha: el temporizador es lo más grande del frente
lienzo.height = 28;
const ctx = lienzo.getContext('2d');
const texPantalla = new THREE.CanvasTexture(lienzo);
texPantalla.colorSpace = THREE.SRGBColorSpace;
texPantalla.magFilter = THREE.NearestFilter;
texPantalla.minFilter = THREE.NearestFilter;
texPantalla.generateMipmaps = false;

/* ---------- Partida maestra (acertijos.js): reloj, vidas y estado de TODOS los puzzles ---------- */
const partida = new MiniJuego();
const texJuego = new THREE.CanvasTexture(partida.canvas);
texJuego.colorSpace = THREE.SRGBColorSpace;
texJuego.magFilter = THREE.NearestFilter;
texJuego.minFilter = THREE.NearestFilter;
texJuego.generateMipmaps = false;

function dibujarTexto(texto, x, y, s, color) {
  ctx.fillStyle = color;
  for (const ch of texto) {
    const bits = FUENTE[ch];
    if (bits) {
      for (let i = 0; i < 15; i++) {
        if (bits[i] === '1') ctx.fillRect(x + (i % 3) * s, y + Math.floor(i / 3) * s, s, s);
      }
    }
    x += 4 * s;
  }
}

/* La pantalla refleja el estado real de la partida (reloj en tiempo real, no animación). */
let pasoPantalla = -1, segPantalla = -2;
function actualizarPantalla(ahora) {             // `ahora`: segundos reales (solo parpadeos)
  const paso = Math.floor(ahora * 6);             // 6 actualizaciones por segundo
  const seg = juego.estado === 'activo' ? Math.ceil(juego.restanteSeg) : -1;
  if (paso === pasoPantalla && seg === segPantalla) return;
  pasoPantalla = paso; segPantalla = seg;

  const estado = juego.estado;
  ctx.fillStyle = '#140505';
  ctx.fillRect(0, 0, 96, 28);

  let colorBits = '#3ddc84';
  if (estado === 'victoria') {
    dibujarTexto('SAFE', 18, 2, 4, '#3ddc84');
  } else if (estado === 'derrota') {
    dibujarTexto('BOOM', 18, 2, 4, paso % 2 === 0 ? '#ff3b30' : '#7a1d18');
    colorBits = '#ff3b30';
  } else {
    // inicio: tiempo disponible; activo: cuenta atrás real (se congela en pausa porque lee la partida)
    const t = estado === 'activo' ? juego.restanteSeg : juego.totalSeg;
    const urgente = estado === 'activo' && t <= 10 && !juego.pausado;
    const dosPuntos = estado === 'inicio' || juego.pausado || ahora % 1 < 0.5 ? ':' : ' ';
    const texto = formatearTiempo(t);
    dibujarTexto(`${texto.slice(0, 2)}${dosPuntos}${texto.slice(3)}`, 10, 2, 4,
      urgente && paso % 2 === 0 ? '#ffd0cc' : '#ff3b30');
  }

  const reac = estado === 'activo' ? criaturas.reaccion : null;   // tiempo para reaccionar a una criatura
  for (let i = 0; i < 16; i++) {                  // fila inferior: barra de reacción o bits decorativos
    const x = Math.round(3 + i * 5.75);
    if (reac) {
      const on = i < Math.ceil(reac.fraccion * 16);
      ctx.fillStyle = !on ? '#1c1c1c' : reac.restante <= 3 ? (paso % 2 ? '#ff3b30' : '#7a1a14') : reac.fraccion < 0.5 ? '#ffb000' : '#3ddc84';
      ctx.fillRect(x, 24, 4, 3);
      continue;
    }
    const r = Math.sin((i + 1) * 12.9898 + (juego.pausado ? 0 : paso) * 78.233) * 43758.5453;
    const vivo = estado === 'victoria' || (r - Math.floor(r)) > 0.55;
    ctx.fillStyle = vivo ? colorBits : (estado === 'derrota' ? '#3a1c1c' : '#1c3a2a');
    ctx.fillRect(x, 24, 4, 3);
  }
  texPantalla.needsUpdate = true;
}

/* ---------- Materiales (reutilizados) ---------- */
const mat = {
  negro:  new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.85, metalness: 0.1 }),
  gris:   new THREE.MeshStandardMaterial({ color: 0x3a3a45, roughness: 0.8, metalness: 0.15 }),
  metal:  new THREE.MeshStandardMaterial({ color: 0xa3aab6, roughness: 0.45, metalness: 0.35 }),
  rojo:   new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.6, emissive: 0xd62828, emissiveIntensity: 0.25 }),
  ledA:   new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff2b2b, emissiveIntensity: 1 }),
  ledB:   new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff2b2b, emissiveIntensity: 0.3 }),
  ambar:  new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0xffb000, emissiveIntensity: 0.6 }),
  verde:  new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x3ddc84, emissiveIntensity: 0.6 }),
  pantalla: new THREE.MeshBasicMaterial({ map: texPantalla, toneMapped: false }),
  panelJuego: new THREE.MeshBasicMaterial({ map: texJuego, toneMapped: false })
};

/* ---------- Modelo: una sola BoxGeometry reutilizada ---------- */
const unidad = new THREE.BoxGeometry(1, 1, 1);
const maletin = new THREE.Group();

function vox(material, w, h, d, x, y, z, padre = maletin) {
  const m = new THREE.Mesh(unidad, material);
  m.scale.set(w * U, h * U, d * U);
  m.position.set(x * U, y * U, z * U);
  m.castShadow = true;
  m.receiveShadow = true;
  padre.add(m);
  return m;
}

// Cuerpo: base, tapa y junta central (12 x 8 x 4 voxels)
vox(mat.negro, 12, 3.6, 4, 0, -2.2, 0);
vox(mat.negro, 12, 3.6, 4, 0, 2.2, 0);
vox(mat.gris, 12.2, 0.8, 4.2, 0, 0, 0);

// Esquinas metálicas escalonadas
for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
  vox(mat.metal, 1.5, 1.5, 1.5, sx * 5.3, sy * 3.3, sz * 1.3);
}

// Placas frontales y traseras
for (const sz of [-1, 1]) {
  vox(mat.gris, 10, 2.8, 0.3, 0, 2.2, sz * 2.1);
  vox(mat.gris, 10, 2.8, 0.3, 0, -2.2, sz * 2.1);
}
// Remaches
for (const sx of [-1, 1]) for (const y of [3.3, 1.1, -1.1, -3.3]) {
  vox(mat.metal, 0.45, 0.45, 0.3, sx * 4.6, y, 2.3);
}

// Pantalla con marco
vox(mat.metal, 8.6, 2.75, 0.3, 0, 2.2, 2.3);
const pantalla = new THREE.Mesh(new THREE.PlaneGeometry(8.4 * U, 2.45 * U), mat.pantalla);   // 96x28 px: mismo tamaño de píxel
pantalla.position.set(0, 2.2 * U, 2.46 * U);
maletin.add(pantalla);
maletin.add(luzPantalla);

// Panel inferior frontal: pantalla de los 3 acertijos con marco metálico
vox(mat.metal, 9.4, 2.5, 0.3, 0, -2.2, 2.3);
const pantallaJuego = new THREE.Mesh(new THREE.PlaneGeometry(9 * U, 2.4 * U), mat.panelJuego);
pantallaJuego.position.set(0, -2.2 * U, 2.46 * U);
maletin.add(pantallaJuego);

// LEDs de estado junto a la pantalla superior
vox(mat.ledA, 0.5, 0.5, 0.4, -4.7, 2.7, 2.35);
vox(mat.ambar, 0.5, 0.5, 0.4, -4.7, 1.7, 2.35);
vox(mat.ledB, 0.5, 0.5, 0.4, 4.7, 2.7, 2.35);
vox(mat.verde, 0.5, 0.5, 0.4, 4.7, 1.7, 2.35);

// Cerraduras decorativas
for (const sx of [-1, 1]) {
  vox(mat.metal, 1.6, 1.8, 0.6, sx * 4.4, 0, 2.3);
  vox(mat.negro, 0.4, 0.6, 0.3, sx * 4.4, 0, 2.65);
}

// Franjas rojas laterales
for (const sx of [-1, 1]) vox(mat.rojo, 0.3, 0.7, 3, sx * 6.0, 0, 0);
for (const sx of [-1, 1]) vox(mat.rojo, 0.5, 0.5, 0.4, sx * 4.6, 3.3, -2.3);

// Bisagras traseras
for (const sx of [-1, 1]) {
  vox(mat.metal, 2, 1.6, 0.6, sx * 3, 0, -2.3);
  vox(mat.negro, 2.2, 0.5, 0.8, sx * 3, 0, -2.35);
}

// Asa hecha con bloques
for (const sx of [-1, 1]) {
  vox(mat.metal, 1.6, 0.4, 1.6, sx * 2.8, 4.2, 0);
  vox(mat.gris, 1, 1.4, 1, sx * 2.8, 4.9, 0);
}
vox(mat.gris, 6.6, 1, 1, 0, 5.9, 0);
vox(mat.rojo, 1.2, 0.3, 1.1, 0, 6.45, 0);

// Patas
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  vox(mat.gris, 1.4, 0.5, 1.4, sx * 4.6, -4.2, sz * 1.2);
}

/* ---------- Módulo del puzzle 2 (colores): placa inferior TRASERA ---------- */
/* Todo se apoya sobre la cara trasera de la placa (z = -2.25 vox) y sale hacia -z. */
const emi = (hex, k = 0.9) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: k, roughness: 0.5 });
const mc = {
  panel:  emi(0x222226, 0.15),
  muestra: emi(COLORES[0].hex, 0.8),
  marco:  new THREE.MeshStandardMaterial({ color: 0x14141a, emissive: 0xff0000, emissiveIntensity: 0, roughness: 0.8 }),
  boton:  new THREE.MeshStandardMaterial({ color: 0xf5d928, emissive: 0xf5d928, emissiveIntensity: 0.25, roughness: 0.55 }),
  led1: emi(0xffb000, 0.7), led2: emi(0xffb000, 0.7), led3: emi(0xff2b2b, 0.8)
};
vox(mat.metal, 6.8, 2.5, 0.3, -1.1, -2.2, -2.4);              // marco metálico
vox(mc.marco, 6.4, 2.1, 0.1, -1.1, -2.2, -2.6);               // fondo oscuro (parpadea en rojo al fallar)
const panelColor = vox(mc.panel, 2.9, 1.7, 0.1, -2.75, -2.2, -2.7);   // panel luminoso
vox(mat.metal, 1.1, 1.1, 0.1, -0.7, -2.2, -2.7);              // marco de la muestra
vox(mc.muestra, 0.9, 0.9, 0.1, -0.7, -2.2, -2.8);             // muestra del color objetivo
vox(mat.metal, 1.9, 1.9, 0.3, 3.5, -2.0, -2.4);               // base del botón
const botonColor = vox(mc.boton, 1.2, 1.2, 0.35, 3.5, -2.0, -2.725);
const Z_BOTON_COLOR = botonColor.position.z;
vox(mc.led1, 0.5, 0.5, 0.2, 2.7, -3.3, -2.35);                // LEDs: energía / estado del puzzle / bomba
const ledEstado = vox(mc.led2, 0.5, 0.5, 0.2, 3.5, -3.3, -2.35);
vox(mc.led3, 0.5, 0.5, 0.2, 4.3, -3.3, -2.35);
for (const y of [-1.3, -3.3]) {                               // detalles electrónicos
  vox(mat.metal, 0.35, 0.35, 0.15, -4.75, y, -2.325);
  vox(mat.ambar, 0.3, 0.3, 0.2, -4.75 + (y < -2 ? 0.0 : 0.0), y + (y < -2 ? 0.5 : -0.5), -2.35);
}
vox(mat.negro, 0.2, 1.2, 0.2, -4.75, -2.3, -2.35);            // cable

const lienzoLey = document.createElement('canvas');           // leyenda: objetivo + estado
lienzoLey.width = 264; lienzoLey.height = 192;
const ctxLey = lienzoLey.getContext('2d');
const texLey = new THREE.CanvasTexture(lienzoLey);
texLey.colorSpace = THREE.SRGBColorSpace;
const leyenda = new THREE.Mesh(new THREE.PlaneGeometry(2.1 * U, 1.6 * U), new THREE.MeshBasicMaterial({ map: texLey, toneMapped: false }));
leyenda.position.set(0.85 * U, -2.2 * U, -2.66 * U);
leyenda.rotation.y = Math.PI;                                 // mira hacia fuera (−z)
maletin.add(leyenda);

// Soporte del panel de desactivación: placa atornillada a la tapa TRASERA (el panel HTML va fijado a ella)
vox(mat.metal, 10.8, 3.7, 0.4, 0, 2.2, -2.45);
vox(mat.negro, 10.2, 3.5, 0.2, 0, 2.2, -2.62);
for (const sx of [-1, 1]) for (const y of [0.7, 3.7]) vox(mat.rojo, 0.5, 0.5, 0.3, sx * 5.1, y, -2.75);

// Criaturas al fondo, botones físicos laterales (rata = derecho, mosca = izquierdo) e interferencias ambientales
const criaturas = CriaturasFactory(THREE, { scene, camera, juego: partida });
criaturas.crearBotones(maletin, U, mat.metal);
const interf = InterferenciasFactory(THREE, { scene, camera, juego: partida, criaturas, maletin, pantallaJuego, renderer, U });

maletin.position.y = -1.2 * U;                    // centra el modelo (incluida el asa)
const modelo = new THREE.Group();                 // pivote para girar y flotar
modelo.add(maletin);
scene.add(modelo);

/* ---------- Estado de animación ---------- */
const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let pausado = reducirMovimiento;
partida.pausar(pausado);                          // ambos sistemas siempre sincronizados
let factorAnim = pausado ? 0 : 1;                 // transición suave pausa/reanudar
let factorGiro = 1;                               // transición suave al interactuar
let interactuando = false;
let reanudarEn = 0;
let reseteando = false;
let t = 0;

function actualizarBotonPausa() {
  btnPausa.textContent = pausado ? 'Reanudar' : 'Pausar';
  btnPausa.setAttribute('aria-pressed', String(pausado));
}
actualizarBotonPausa();

let camaraTocada = false;                         // mientras no se toque, un cambio de tamaño reencuadra el frente
controls.addEventListener('start', () => { interactuando = true; reseteando = false; camaraTocada = true; });
controls.addEventListener('end', () => { interactuando = false; reanudarEn = performance.now() + 1200; });

btnPausa.addEventListener('click', () => {
  pausado = !pausado;
  partida.pausar(pausado);                        // reloj, vidas, criaturas, colores y palabra dependen de este reloj
  actualizarBotonPausa();
});
const btnTrasera = document.getElementById('btn-trasera');
const inicioEl = document.getElementById('inicio-partida');
document.getElementById('btn-comenzar').addEventListener('click', () => partida.iniciar());   // arranca TODOS los módulos (alIniciar)
let vistaActual = null, giroObj = 0;              // destino del botón «Ver frente» / «Ver panel trasero»
function irA(vista, giro) { vistaActual = vista; giroObj = giro; reseteando = true; }
btnReset.addEventListener('click', () => irA(vistaFrente, 0));
btnTrasera.addEventListener('click', () => irA(vistaTrasera, GIRO_TRASERO));
btnFondo.addEventListener('click', () => {
  document.body.dataset.fondo = String((Number(document.body.dataset.fondo) + 1) % 3);
});

/* =========================================================
   Minijuego: desactivar la bomba (lógica en juego.js / puzzles.js)
   Aquí solo se conecta con el maletín: LEDs, pantalla, efectos y panel.
   ========================================================= */
const efectos = crearEfectos(THREE, scene);
const panelBomba = document.getElementById('bomba');
const destelloDom = document.getElementById('destello');
const avisoPanel = document.getElementById('aviso-panel');

/* ---------- Panel fijado al maletín (CSS3DRenderer) ---------- */
/* El panel HTML es hijo del grupo del maletín: hereda su posición, giro, escala y flotación,
   con perspectiva real. Ya no es una ventana flotante que "persigue" al modelo. */
const css3d = new CSS3DRenderer();
css3d.domElement.className = 'capa-css3d';
document.body.insertBefore(css3d.domElement, contenedor.nextSibling);
const soporte = document.createElement('div');   // contenedor 3D del panel
soporte.className = 'bomba-soporte';
soporte.style.cssText = `width:${ANCHO_PANEL}px;height:${ALTO_PANEL}px;pointer-events:none;backface-visibility:hidden;`;
soporte.append(panelBomba);
document.body.append(soporte);                   // en el documento desde el inicio; CSS3DRenderer lo recoloca
css3d.domElement.append(soporte);               // en el DOM desde ya; el renderizador lo recoloca en cada fotograma
const panel3d = new CSS3DObject(soporte);
panel3d.position.set(0, 2.2 * U, -2.74 * U);
panel3d.rotation.y = Math.PI;                    // mira hacia fuera de la tapa trasera
panel3d.scale.setScalar((10 * U) / ANCHO_PANEL); // 1000 px de diseño = 10 voxels
maletin.add(panel3d);
soporte.style.pointerEvents = 'none';

/* ---------- LEDs ---------- */
const COLORES_LED = {
  normal: { a: 0xff2b2b, b: 0xff2b2b, ambar: 0xffb000, verde: 0x3ddc84, luz: 0xff3b30 },
  ok:     { a: 0x3ddc84, b: 0x3ddc84, ambar: 0x3ddc84, verde: 0x3ddc84, luz: 0x3ddc84 },
  fallo:  { a: 0xff2b2b, b: 0xff2b2b, ambar: 0xff2b2b, verde: 0xff2b2b, luz: 0xff2b2b }
};
let modoLeds = 'normal';
let errorHasta = 0;                               // parpadeo rápido tras una respuesta incorrecta
let botonApretadoHasta = 0;

function pintarLed(material, hex) { material.color.setHex(hex); material.emissive.setHex(hex); }
function aplicarLeds(modo) {
  modoLeds = modo;
  const c = COLORES_LED[modo];
  pintarLed(mat.ledA, c.a); pintarLed(mat.ledB, c.b);
  pintarLed(mat.ambar, c.ambar); pintarLed(mat.verde, c.verde);
  luzPantalla.color.setHex(c.luz);
}

function lanzarDestelloDom(tipo) {
  destelloDom.dataset.tipo = tipo;
  destelloDom.classList.remove('activo');
  void destelloDom.offsetWidth;                   // reinicia la animación CSS
  destelloDom.classList.add('activo');
}

let claveLeyenda = '';
const colores = crearColores({ juego: () => juego });
const TEXTO_ESTADO = {
  preparado: ['ESPERANDO', '#9aa0aa'], activo: ['PULSA AL', '#ffffff'], agotado: ['TIEMPO', '#ff3b30'],
  error: ['COLOR', '#ff3b30'], completado: ['SISTEMA', '#3ddc84']
};
function pintarLeyenda(ahora) {
  const e = colores.estado, c = colores.objetivo;
  const parpadeo = e === 'error' && Math.floor(ahora / 120) % 2 === 0;
  const clave = `${e}|${c.id}|${parpadeo}`;
  if (clave === claveLeyenda) return;
  claveLeyenda = clave;
  ctxLey.fillStyle = '#0c0c10'; ctxLey.fillRect(0, 0, 264, 192);
  ctxLey.textAlign = 'center';
  ctxLey.fillStyle = '#9aa0aa'; ctxLey.font = '700 22px Silkscreen, monospace';
  ctxLey.fillText('OBJETIVO', 132, 34);
  ctxLey.fillStyle = '#' + c.hex.toString(16).padStart(6, '0'); ctxLey.font = '700 40px Silkscreen, monospace';
  ctxLey.fillText(c.nombre, 132, 84);
  const l2 = { preparado: 'INICIA LA PARTIDA', activo: 'COINCIDIR', error: 'INCORRECTO', completado: 'DESACTIVADO', agotado: 'AGOTADO' }[e];
  ctxLey.font = '700 22px Silkscreen, monospace';
  ctxLey.fillStyle = e === 'error' && !parpadeo ? '#7a1d18' : TEXTO_ESTADO[e][1];
  ctxLey.fillText(e === 'preparado' ? 'ESPERANDO' : TEXTO_ESTADO[e][0], 132, 128);
  ctxLey.fillText(l2 === 'INICIA LA PARTIDA' ? 'INICIO' : l2, 132, 160);
  texLey.needsUpdate = true;
}
let apretadoColorHasta = 0;

const juego = crearJuego({
  maestro: partida,
  alEvento(nombre) {
    if (nombre === 'inicio') { efectos.limpiar(); aplicarLeds('normal'); colores.reiniciar(); }
    else if (nombre === 'activo') { aplicarLeds('normal'); colores.iniciar(); }
    else if (nombre === 'error') errorHasta = performance.now() + 700;
    else if (nombre === 'victoria') {
      aplicarLeds('ok');
      efectos.desactivacion(reducirMovimiento);
      lanzarDestelloDom('ok');
    } else if (nombre === 'derrota') {
      colores.agotar();
      aplicarLeds('fallo');
      efectos.explosion(reducirMovimiento);
      lanzarDestelloDom('fallo');
    }
  }
});

// Un único arranque (desde el panel frontal o el trasero) pone en marcha TODOS los módulos
partida.alIniciar = () => {
  juego.reiniciar();                              // palabra nueva + colores nuevos
  juego.comenzar();
  criaturas.iniciar();
  interf.iniciar();
  if (miraPanel < 0.2) irA(vistaFrente, 0);       // si empezó desde el frente, el maletín se coloca de cara
};

/* ---------- Manual de instrucciones (manual.js) ----------
   Mientras el manual está abierto la partida permanece en READY: sin reloj, criaturas ni acertijos activos.
   «COMENZAR PARTIDA» usa el mismo arranque de siempre (partida.iniciar → alIniciar), que deja la cámara de frente. */
const manualUI = window.ManualUI;
if (manualUI) manualUI.alComenzar = () => partida.iniciar();

/** Vuelve al estado inicial del videojuego (sin recargar la página) y reabre la pantalla de bienvenida. */
function volverAlMenu() {
  pausado = false;
  partida.pausar(false);
  actualizarBotonPausa();
  partida.resetear();                             // READY, 3 vidas, 150 s, acertijos nuevos
  juego.reiniciar();                              // palabra nueva + estado 'inicio' (limpia efectos y colores)
  criaturas.detener();
  interf.detener();
  irA(vistaFrente, 0);                            // cámara de frente, con el temporizador grande
  if (manualUI) manualUI.mostrarBienvenida();
}
document.getElementById('btn-menu').addEventListener('click', () => {
  if (manualUI && manualUI.abierto) return;
  if (partida.enCurso) {                          // el reloj se congela mientras se pregunta
    const estabaPausada = partida.pausado;
    partida.pausar(true);
    const seguro = window.confirm('¿Volver al menú? Se perderá el progreso de la partida actual.');
    if (!seguro) { if (!estabaPausada) partida.pausar(false); return; }
  }
  volverAlMenu();
});

/* ---------- Vista de cámara y panel anclado a la tapa ---------- */
/* En pantallas grandes el panel se dibuja sobre la placa frontal de la tapa del maletín
   y la sigue (posición y escala) al girar, acercar o flotar. En pantallas pequeñas
   se acopla como un panel fijo para que siga siendo legible. */

const Y_PLACA = 2.2 * U;                          // centro de la placa frontal (local al maletín)
const Z_PLACA = -2.74 * U;                        // plano del panel, fijado delante del soporte trasero
const vistaFrente = { pos: POS_INICIAL.clone(), target: new THREE.Vector3() };
const vistaTrasera = { pos: POS_INICIAL.clone(), target: new THREE.Vector3() };   // se recalcula en calcularVista
vistaActual = vistaFrente;
let miraPanel = 0;
let panelAcoplado = false;

function calcularVista(w, h) {
  panelAcoplado = !(w >= 1000 && w / h >= 1.3);
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // Vista FRONTAL: el maletín (≈3.6 x 3.7 u con asa y botones) centrado y completo; el temporizador grande queda de cara
  const dF = Math.max((3.7 / 2) / tan, (3.6 / 2) / (tan * camera.aspect));
  vistaFrente.target.set(0, 0.05, 0);
  vistaFrente.pos.set(0, 0.35, THREE.MathUtils.clamp(dF, controls.minDistance, controls.maxDistance));
  let dist;
  if (panelAcoplado) {
    dist = THREE.MathUtils.clamp(4.4 / (2 * tan * camera.aspect), 4.5, controls.maxDistance);
    vistaTrasera.target.set(0, -dist * 0.2, 0);          // sube el maletín: el panel ocupa la parte baja
    vistaTrasera.pos.set(0, 0.3, dist);
  } else {
    const anchoPx = Math.min(w * 0.64, 940);      // ancho en pantalla que tendrá la placa
    const d = (10 * U) * h / (anchoPx * 2 * tan);
    const y = maletin.position.y + Y_PLACA;
    const baja = 0.1;                             // sube un poco el panel en pantalla
    vistaTrasera.target.set(0, y - baja, 0);
    vistaTrasera.pos.set(0, y - baja, THREE.MathUtils.clamp(Math.abs(Z_PLACA) + d, controls.minDistance, controls.maxDistance));
  }
  panelBomba.classList.toggle('bomba--acoplada', panelAcoplado);
  panelBomba.classList.toggle('bomba--anclada', !panelAcoplado);
  // Pantallas pequeñas: el panel se acopla abajo para seguir siendo legible; si no, va fijado al maletín.
  (panelAcoplado ? document.body : soporte).append(panelBomba);
  panel3d.visible = !panelAcoplado;
  panelBomba.style.opacity = soporte.style.opacity = '';
  panelBomba.style.visibility = soporte.style.visibility = '';
}

let flotacionY = 0;
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
function actualizarAviso() {                      // el panel solo se ve si la cámara mira la tapa trasera
  modelo.updateMatrixWorld(true);
  _n.set(0, 0, -1).transformDirection(maletin.matrixWorld);
  _c.set(0, Y_PLACA, Z_PLACA).applyMatrix4(maletin.matrixWorld);
  miraPanel = _n.dot(_v.copy(camera.position).sub(_c).normalize());   // >0: la cámara ve la tapa trasera
  const op = THREE.MathUtils.clamp((miraPanel - 0.05) / 0.2, 0, 1);   // se desvanece al girar hacia el frente
  const el = panelAcoplado ? panelBomba : soporte;
  el.style.opacity = String(op);
  el.style.visibility = op < 0.02 ? 'hidden' : 'visible';             // oculto (y sin clics) si no se ve
}

/* ---------- Interacción: panel frontal, botones laterales, botón de colores ---------- */
const rayo = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const planoJuego = new THREE.Plane();
const punto = new THREE.Vector3();
const normal = new THREE.Vector3();
const centro = new THREE.Vector3();
let arrastrando = false;
let inicioToque = null;

function rayoDesde(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  rayo.setFromCamera(ndc, camera);
}
// Convierte el puntero en píxeles del canvas del minijuego (null si no apunta al panel)
function aPixeles(ev, planoInfinito) {
  rayoDesde(ev);
  pantallaJuego.updateWorldMatrix(true, false);
  if (planoInfinito) {                            // permite seguir arrastrando fuera del panel
    normal.set(0, 0, 1).transformDirection(pantallaJuego.matrixWorld);
    planoJuego.setFromNormalAndCoplanarPoint(normal, pantallaJuego.getWorldPosition(centro));
    if (!rayo.ray.intersectPlane(planoJuego, punto)) return null;
  } else {
    const hit = rayo.intersectObject(pantallaJuego)[0];
    if (!hit) return null;
    punto.copy(hit.point);
  }
  pantallaJuego.worldToLocal(punto);
  return { x: (punto.x / (9 * U) + 0.5) * 300, y: (0.5 - punto.y / (2.4 * U)) * 80 };
}
function botonColorBajo(ev) {                     // el primer objeto golpeado decide: no se pulsa a través del maletín
  rayoDesde(ev);
  const hit = rayo.intersectObject(maletin, true)[0];
  return !!hit && hit.object === botonColor;
}

// Fase de captura: si se pulsa un control del juego, OrbitControls no recibe el evento
contenedor.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  rayoDesde(ev);
  const boton = criaturas.botonEn(rayo, maletin);
  if (boton) { criaturas.manejarBoton(boton); ev.stopPropagation(); return; }
  const p = aPixeles(ev, false);
  if (p && partida.alPulsar(p.x, p.y)) {
    arrastrando = true;
    controls.enabled = false;
    renderer.domElement.setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  }
}, true);

renderer.domElement.addEventListener('pointerdown', (ev) => { inicioToque = { x: ev.clientX, y: ev.clientY }; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  const ini = inicioToque;
  inicioToque = null;
  if (!ini || Math.hypot(ev.clientX - ini.x, ev.clientY - ini.y) > 6) return;   // fue un arrastre
  if (botonColorBajo(ev)) {
    const res = colores.presionar();
    if (res !== 'ignorado') apretadoColorHasta = performance.now() + 220;
    if (res === 'acierto') lanzarDestelloDom('ok');
    else if (res === 'error') lanzarDestelloDom('fallo');
  }
});

contenedor.addEventListener('pointermove', (ev) => {
  interf.setPuntero(ev);                          // la rata solo LEE la posición del cursor
  if (arrastrando) {
    const p = aPixeles(ev, true);
    if (p) partida.alMover(p.x, p.y);
  } else if (ev.pointerType === 'mouse' && !interactuando) {
    const p = aPixeles(ev, false);
    rayoDesde(ev);
    renderer.domElement.style.cursor = (p && partida.esInteractivo(p.x, p.y)) || criaturas.botonEn(rayo, maletin) || botonColorBajo(ev) ? 'pointer' : '';
  }
});
contenedor.addEventListener('pointerleave', () => interf.limpiarPuntero());

function soltar(ev, cancelar) {
  if (!arrastrando) return;
  arrastrando = false;
  controls.enabled = true;
  const p = cancelar ? null : aPixeles(ev, true);
  partida.alSoltar(p ? p.x : -999, p ? p.y : -999);
}
contenedor.addEventListener('pointerup', (ev) => soltar(ev, false));
contenedor.addEventListener('pointercancel', (ev) => soltar(ev, true));

/* ---------- Tamaño ---------- */
function ajustar() {
  const w = contenedor.clientWidth || window.innerWidth;
  const h = contenedor.clientHeight || window.innerHeight;
  renderer.setSize(w, h);
  css3d.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 48 : 35;
  camera.updateProjectionMatrix();
  calcularVista(w, h);
}
ajustar();
camera.position.copy(vistaFrente.pos);            // encuadre inicial: el frente del maletín
controls.target.copy(vistaFrente.target);
function alRedimensionar() {
  ajustar();
  if (!camaraTocada) { camera.position.copy(vistaFrente.pos); controls.target.copy(vistaFrente.target); }
}
window.addEventListener('resize', alRedimensionar);

/* ---------- Ciclo de render ---------- */
const reloj = new THREE.Clock();
let idFrame = 0;

function animar() {
  idFrame = requestAnimationFrame(animar);
  const dt = Math.min(reloj.getDelta(), 0.05);
  const suave = (v) => 1 - Math.exp(-v * dt);
  const ahora = performance.now();

  factorAnim += ((pausado ? 0 : 1) - factorAnim) * suave(4);
  const quieto = interactuando || reseteando || partida.enCurso || ahora < reanudarEn;
  factorGiro += ((quieto ? 0 : 1) - factorGiro) * suave(2.5);

  t += dt * factorAnim;
  const sacudida = efectos.actualizar(dt);        // temblor de la explosión
  flotacionY = Math.sin(t * 1.2) * (panelAcoplado ? 0.06 : 0.02);   // flota menos con el panel anclado
  modelo.position.set(sacudida.x, flotacionY + sacudida.y, 0);

  if (reseteando) {
    const k = suave(4);
    const r = ((modelo.rotation.y - giroObj + Math.PI) % TAU + TAU) % TAU - Math.PI;
    modelo.rotation.y = giroObj + r * (1 - k);
    camera.position.lerp(vistaActual.pos, k);
    controls.target.lerp(vistaActual.target, k);
    if (camera.position.distanceTo(vistaActual.pos) < 0.01 && Math.abs(modelo.rotation.y - giroObj) < 0.01) {
      reseteando = false;
      reanudarEn = performance.now() + 600;
    }
  }

  partida.actualizar();                           // reloj único, vidas y transiciones
  juego.actualizar();                             // el módulo de la palabra refleja ese reloj
  const dtJuego = partida.pausado ? 0 : dt;       // en pausa no avanza nada que dependa del tiempo
  colores.actualizar(dtJuego);                    // la velocidad de los colores depende del tiempo restante
  criaturas.actualizar(dtJuego);
  interf.actualizar(dtJuego);
  document.body.classList.toggle('pausado', partida.pausado);
  if (partida.estado === 'READY' !== !inicioEl.hidden) inicioEl.hidden = partida.estado !== 'READY';
  if (partida.dibujar()) texJuego.needsUpdate = true;

  // Módulo de colores
  const ec = colores.estado;
  const rojoErr = ec === 'error' && Math.floor(ahora / 120) % 2 === 0;
  const colPanel = ec === 'completado' ? 0x3ddc84 : ec === 'agotado' ? 0x3a1010 : ec === 'activo' || ec === 'error' ? colores.actual.hex : 0x222226;
  mc.panel.color.setHex(colPanel); mc.panel.emissive.setHex(colPanel);
  mc.panel.emissiveIntensity = ec === 'preparado' || ec === 'agotado' ? 0.15 : 0.9;
  mc.muestra.color.setHex(colores.objetivo.hex); mc.muestra.emissive.setHex(colores.objetivo.hex);
  mc.marco.emissive.setHex(0xff2b2b); mc.marco.emissiveIntensity = rojoErr ? 1 : 0;
  const hexLed = ec === 'completado' ? 0x3ddc84 : ec === 'error' || ec === 'agotado' ? 0xff2b2b : 0xffb000;
  mc.led2.color.setHex(hexLed); mc.led2.emissive.setHex(hexLed);
  mc.led2.emissiveIntensity = ec === 'error' ? (rojoErr ? 1 : 0.2) : 0.9;
  const hexGen = modoLeds === 'ok' ? 0x3ddc84 : 0xff2b2b;
  mc.led3.color.setHex(hexGen); mc.led3.emissive.setHex(hexGen);
  mc.led3.emissiveIntensity = modoLeds === 'fallo' ? (Math.floor(ahora / 160) % 2 ? 1 : 0.15) : 0.9;
  botonColor.position.z = Z_BOTON_COLOR + (ahora < apretadoColorHasta ? 0.15 * U : 0);
  pintarLeyenda(ahora);

  // Efectos luminosos: dependen del estado de la partida
  const apuro = juego.estado === 'activo' && juego.restanteSeg <= 10;
  const vel = errorHasta > ahora ? 14 : apuro ? 9 : 3;
  if (modoLeds === 'ok') {
    mat.ledA.emissiveIntensity = mat.ledB.emissiveIntensity = 1;
    mat.ambar.emissiveIntensity = mat.verde.emissiveIntensity = 1;
    luzPantalla.intensity = 0.9 + 0.2 * Math.sin(t * 2);
  } else if (modoLeds === 'fallo') {
    const on = Math.floor(ahora / 160) % 2 === 0 ? 1 : 0.15;
    mat.ledA.emissiveIntensity = mat.ledB.emissiveIntensity = on;
    mat.ambar.emissiveIntensity = mat.verde.emissiveIntensity = on;
    luzPantalla.intensity = on * 1.2;
  } else {
    mat.ledA.emissiveIntensity = 0.65 + 0.35 * Math.sin(t * vel);
    mat.ledB.emissiveIntensity = 0.65 - 0.35 * Math.sin(t * vel);
    mat.ambar.emissiveIntensity = partida.enCurso ? 1.4 : 0.6;
    mat.verde.emissiveIntensity = 0.6;
    luzPantalla.color.setHex(partida.colorDestello());
    luzPantalla.intensity = 0.5 + 0.15 * Math.sin(t * vel);
  }
  mat.rojo.emissiveIntensity = 0.25 + 0.12 * Math.sin(t * 1.5);

  actualizarPantalla(ahora / 1000);
  controls.update();
  camera.updateMatrixWorld();
  actualizarAviso();
  renderer.render(scene, camera);
  css3d.render(scene, camera);
}
animar();
if (location.search.includes('debug')) window.__bomba = { partida, juego, colores };   // solo para pruebas

/* ---------- Limpieza de recursos ---------- */
function liberar() {
  cancelAnimationFrame(idFrame);
  window.removeEventListener('resize', alRedimensionar);
  controls.dispose();
  efectos.liberar();
  unidad.dispose();
  pantalla.geometry.dispose();
  texPantalla.dispose();
  texLey.dispose();
  texJuego.dispose();
  pantallaJuego.geometry.dispose();
  interf.dispose();
  criaturas.dispose();
  leyenda.geometry.dispose();
  leyenda.material.dispose();
  Object.values(mat).forEach((m) => m.dispose());
  luzPrincipal.shadow.map?.dispose();
  renderer.dispose();
  renderer.domElement.remove();
  css3d.domElement.remove();
}
window.addEventListener('pagehide', liberar);
