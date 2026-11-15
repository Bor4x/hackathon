/* =========================================================
   Bienvenida + manual de instrucciones + controles + «cómo ganar»
   ---------------------------------------------------------
   Es una capa de interfaz independiente: NO conoce Three.js ni la lógica
   de los puzzles. Solo lee el tiempo inicial (MiniJuegoAPI.TIEMPO_INICIAL)
   y avisa mediante `ManualUI.alComenzar` cuando el jugador pulsa
   «COMENZAR PARTIDA». Mientras está abierta, la partida sigue en READY:
   no corre el reloj ni hay criaturas ni acertijos activos.
   ========================================================= */
(function (global) {
  'use strict';

  const API = global.MiniJuegoAPI || {};
  const TIEMPO = API.TIEMPO_INICIAL || 150;
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const T_TXT = mmss(TIEMPO);
  const PENAL = API.PENALIZACION || 10;
  const FONT = '"Silkscreen","Courier New",monospace';

  /* ---------- Ilustraciones (SVG inline, estilo voxel) ---------- */
  let uid = 0;
  const px = (filas, paleta, cls = 'pix') => {
    const r = [];
    filas.forEach((f, y) => [...f].forEach((c, x) => { if (paleta[c]) r.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${paleta[c]}"/>`); }));
    return `<svg class="${cls}" viewBox="0 0 ${filas[0].length} ${filas.length}" shape-rendering="crispEdges" aria-hidden="true">${r.join('')}</svg>`;
  };
  // Mismos sprites 12x12 que los botones físicos del juego (criaturas.js)
  const RATA = px(['............', '........gp..', '..ggggggggg.', '.ggggggggegp', 'tggggggggggp', '.tgggggggg..', '..tgggggg...', '..g.g..g.g..', '..g.g..g.g..', '............', '............', '............'],
    { g: '#9a9088', p: '#f0909f', e: '#111111', t: '#f0909f' });
  const MOSCA = px(['............', '..ww....ww..', '.wwww..wwww.', '.wwww..wwww.', '..ww.bb.ww..', '...rrbbrr...', '....bbbb....', '....bbbb....', '....bbbb....', '...l.bb.l...', '..l..bb..l..', '............'],
    { b: '#3a3a46', w: '#bfe3ff', r: '#e03030', l: '#8a8a96' });
  const CORAZON = (lleno = true) => px(['.#.#.', '#####', '#####', '.###.', '..#..'], { '#': lleno ? '#ff3b30' : '#3a1d1f' });

  const pulso = (x, y, w, h, c = 'var(--ac,#ffb000)') =>
    `<rect class="mn-pulso" x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="7 4"/>`;
  const marca = (x, y, n) =>
    `<g><circle cx="${x}" cy="${y}" r="9" fill="var(--ac,#ffb000)" stroke="#000" stroke-width="1.5"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-family='${FONT}' font-size="10" font-weight="700" fill="#05070a">${n}</text></g>`;

  /** Maletín voxel visto de frente o por detrás. `res`: elementos a resaltar. */
  function maletinSVG(vista, res = [], marcas = true) {
    const f = vista === 'frente';
    const has = (k) => res.includes(k);
    const lados = [8, 220].map((x, i) => `<rect x="${x}" y="106" width="12" height="46" fill="#a3aab6"/><rect x="${x + (i ? 0 : 6)}" y="110" width="6" height="38" fill="#2a2f3a"/>`).join('');
    let placaSup, placaInf;
    if (f) {
      placaSup = `
        <rect x="38" y="34" width="164" height="50" fill="#3a3a45"/>
        <rect x="44" y="38" width="152" height="42" fill="#a3aab6"/>
        <rect x="48" y="42" width="144" height="34" fill="#140505"/>
        <text x="120" y="70" text-anchor="middle" font-family='${FONT}' font-size="31" font-weight="700" fill="#ff3b30" style="filter:drop-shadow(0 0 5px #ff3b30)">${T_TXT}</text>
        <rect x="41" y="38" width="4" height="4" fill="#ff2b2b"/><rect x="41" y="74" width="4" height="4" fill="#3ddc84"/>
        <rect x="195" y="38" width="4" height="4" fill="#ff2b2b"/><rect x="195" y="74" width="4" height="4" fill="#3ddc84"/>`;
      placaInf = `
        <rect x="38" y="102" width="164" height="54" fill="#3a3a45"/>
        <rect x="46" y="106" width="148" height="46" fill="#a3aab6"/>
        <rect x="50" y="110" width="140" height="38" fill="#0b0d12"/>
        <text x="120" y="124" text-anchor="middle" font-family='${FONT}' font-size="9" fill="#e9e6dc">(a + b)⁰ = ?</text>
        ${[0, 1, 2, 3].map((i) => `<rect x="${54 + i * 34}" y="130" width="30" height="14" fill="#1a2030" stroke="#7c8396" stroke-width="1.5"/>`).join('')}`;
    } else {
      placaSup = `
        <rect x="38" y="34" width="164" height="50" fill="#3a3a45"/>
        <rect x="42" y="37" width="156" height="44" fill="#0e0e12" stroke="#a3aab6" stroke-width="2"/>
        ${['oso', 'cuy', 'alpaca', 'papa'].map((n, i) => `<rect x="${47 + i * 37}" y="41" width="33" height="24" fill="#24242d" stroke="#3a3a45" stroke-width="1.5"/><image href="img/${n}.svg" x="${48 + i * 37}" y="42" width="31" height="22" preserveAspectRatio="xMidYMid slice"/>`).join('')}
        <rect x="47" y="69" width="86" height="9" fill="#140505" stroke="#a3aab6" stroke-width="1.5"/>
        <text x="90" y="76.5" text-anchor="middle" font-family='${FONT}' font-size="7" fill="#ffb000">_ _ _</text>
        <rect x="140" y="69" width="54" height="9" fill="#d62828"/>`;
      placaInf = `
        <rect x="38" y="102" width="164" height="54" fill="#3a3a45"/>
        <rect x="42" y="105" width="132" height="48" fill="#a3aab6"/>
        <rect x="46" y="108" width="124" height="42" fill="#14141a"/>
        <rect class="mn-ciclo" x="50" y="112" width="52" height="34" fill="#EF2929"/>
        <rect x="108" y="119" width="20" height="20" fill="#a3aab6"/>
        <rect class="mn-ciclo" x="111" y="122" width="14" height="14" fill="#EF2929" style="animation-delay:-3s"/>
        <rect x="136" y="116" width="30" height="8" fill="#0c0c10"/><rect x="140" y="118" width="22" height="4" fill="#9aa0aa"/>
        <rect x="178" y="110" width="22" height="40" fill="#a3aab6"/>
        <circle cx="189" cy="128" r="9" fill="#f5d928" stroke="#7a6a10" stroke-width="2"/>
        <rect x="136" y="132" width="6" height="6" fill="#ffb000"/><rect x="146" y="132" width="6" height="6" fill="#ffb000"/><rect x="156" y="132" width="6" height="6" fill="#ff2b2b"/>`;
    }
    let overlay = '';
    if (f) {
      if (has('tiempo')) overlay += pulso(36, 32, 168, 54, '#ff3b30');
      if (has('mate')) overlay += pulso(36, 100, 168, 58);
      if (has('botones')) overlay += pulso(4, 102, 20, 54) + pulso(216, 102, 20, 54);
      if (marcas) overlay += marca(214, 36, 1) + marca(214, 104, 2) + marca(10, 100, 3);
    } else {
      if (has('palabra')) overlay += pulso(36, 32, 168, 54);
      if (has('colores')) overlay += pulso(36, 100, 168, 58);
      if (marcas) overlay += marca(214, 36, 1) + marca(214, 104, 2);
    }
    return `<svg viewBox="0 0 240 190" shape-rendering="crispEdges" role="img" aria-label="Maletín voxel visto ${f ? 'de frente' : 'por detrás'}">
      <rect x="86" y="14" width="10" height="14" fill="#3a3a45"/><rect x="144" y="14" width="10" height="14" fill="#3a3a45"/>
      <rect x="86" y="8" width="68" height="8" fill="#3a3a45"/><rect x="112" y="3" width="16" height="5" fill="#d62828"/>
      <rect x="14" y="26" width="212" height="140" fill="#1c1c22"/>
      <rect x="12" y="92" width="216" height="8" fill="#3a3a45"/>
      <rect x="14" y="26" width="212" height="2" fill="#2d2d36"/>
      ${[[10, 22], [214, 22], [10, 150], [214, 150]].map(([x, y]) => `<rect x="${x}" y="${y}" width="16" height="16" fill="#a3aab6"/><rect x="${x + 2}" y="${y + 2}" width="12" height="12" fill="#8a919d"/>`).join('')}
      ${placaSup}${placaInf}${f ? lados : ''}
      <rect x="20" y="166" width="24" height="7" fill="#3a3a45"/><rect x="196" y="166" width="24" height="7" fill="#3a3a45"/>
      ${overlay}
    </svg>`;
  }

  const ratonSVG = (boton) => {
    const id = `m${++uid}`;
    const sel = (lado) => (boton === lado ? '#ffb000' : 'transparent');
    return `<svg viewBox="0 0 60 90" aria-hidden="true">
      <defs><clipPath id="${id}"><rect x="6" y="4" width="48" height="82" rx="22"/></clipPath></defs>
      <rect x="6" y="4" width="48" height="82" rx="22" fill="#1a2030" stroke="#5b667d" stroke-width="3"/>
      <g clip-path="url(#${id})">
        <rect x="0" y="0" width="30" height="38" fill="${sel('izq')}"/><rect x="30" y="0" width="30" height="38" fill="${sel('der')}"/>
        ${boton === 'rueda' ? '<rect x="27" y="12" width="6" height="14" rx="3" fill="#ffb000"/>' : ''}
      </g>
      <path d="M30 4 V38 M6 38 H54" stroke="#5b667d" stroke-width="3" fill="none"/>
      ${boton === 'mover' ? '<path d="M30 52 l-6 8 h12 z M30 78 l-6 -8 h12 z" fill="#ffb000"/>' : ''}
    </svg>`;
  };
  const teclado = (...teclas) => `<span class="mn-teclas">${teclas.map((t) => `<kbd class="mn-tecla">${t}</kbd>`).join('')}</span>`;

  /* ---------- Contenido de las páginas del manual ---------- */
  const reglas = (items) => `<ul class="mn-reglas">${items.map((i) => (typeof i === 'string' ? `<li>${i}</li>` : `<li class="${i[0]}"${i[0] === 'num' ? ` data-n="${i[2]}"` : ''}>${i[1]}</li>`)).join('')}</ul>`;
  const tarjeta = (titulo, cuerpo, extra = '') => `<article class="mn-tarjeta ${extra}">${titulo ? `<h3>${titulo}</h3>` : ''}${cuerpo}</article>`;

  const PAGINAS = [
    {
      id: 'maletin', corto: 'Maletín y tiempo', titulo: 'El maletín y el temporizador', ubic: 'FRENTE DEL MALETÍN', color: '#ff3b30',
      html: () => `
        <div class="mn-grid">
          ${tarjeta('', maletinSVG('frente', ['tiempo']) + `<div class="mn-leyenda"><span><b>1</b>Temporizador</span><span><b>2</b>Acertijos</span><span><b>3</b>Botones</span></div>`, 'mn-tarjeta--arte')}
          ${tarjeta('Cómo funciona', reglas([
            'El <b>maletín</b> guarda todos los desafíos necesarios para desactivar la bomba.',
            `El <b>temporizador grande</b> está en la parte <b>frontal</b> del maletín: empieza en <b>${T_TXT}</b> (${TIEMPO} segundos).`,
            'Todos los desafíos comparten <b>el mismo temporizador</b>: nunca se detiene mientras resuelves.',
            ['mal', 'Si el tiempo llega a <b>cero</b>, pierdes.'],
            'También administras tus <b>tres vidas</b>: si se acaban, la bomba explota.'
          ]))}
        </div>
        ${tarjeta('Tus recursos', `<div class="mn-tiempo">
            <div><b>${T_TXT}</b><small>Tiempo total · reloj único</small></div>
            <div><span class="mn-corazones">${CORAZON()}${CORAZON()}${CORAZON()}</span><small>3 vidas compartidas</small></div>
            <div><b>−${PENAL}s</b><small>Cada error: −1 vida y −${PENAL} segundos</small></div>
          </div>`)}`
    },
    {
      id: 'mate', corto: 'Acertijos matemáticos', titulo: 'Acertijos matemáticos', ubic: 'FRENTE DEL MALETÍN', color: '#ffb000',
      html: () => `
        <div class="mn-grid">
          ${tarjeta('Dónde está', maletinSVG('frente', ['mate'], false), 'mn-tarjeta--arte')}
          ${tarjeta('Reglas', reglas([
            'Hay <b>tres acertijos</b> seguidos en la pantalla inferior del frente.',
            'Elige la respuesta tocándola o <b>arrástrala</b> hasta el casillero «?», según el acertijo.',
            ['ok', 'Cada respuesta <b>correcta</b> te deja avanzar al siguiente.'],
            ['mal', 'Cada respuesta <b>incorrecta</b> resta <b>1 vida</b> y <b>' + PENAL + ' segundos</b>.'],
            'Debes completar los <b>tres</b> para superar este módulo.'
          ]))}
        </div>
        <div class="mn-trio">
          ${tarjeta('Acertijo 1 · Potencia con exponente cero', `<span class="mn-modo">ARRASTRAR</span>
            <div class="mn-mini"><div class="mn-mini__eq">(a + b)<sup>0</sup> = <span class="mn-slot">?</span></div>
            <div class="mn-chips"><span class="arrastra">▢</span><span>▢</span><span>▢</span><span>▢</span></div>
            <p class="mn-mini__pie">Resuelve y suelta la respuesta en el «?».</p></div>`)}
          ${tarjeta('Acertijo 2 · Operaciones aritméticas', `<span class="mn-modo">ELEGIR</span>
            <div class="mn-mini"><div class="mn-mini__eq">12 + 15 = ?</div>
            <div class="mn-chips"><span>25</span><span class="pulsa">27</span><span>29</span><span>37</span></div>
            <p class="mn-mini__pie">Sumas o multiplicaciones: calcula y toca el resultado correcto.</p></div>`)}
          ${tarjeta('Acertijo 3 · División entre cero', `<span class="mn-modo">ELEGIR</span>
            <div class="mn-mini"><div class="mn-mini__eq">n ÷ 0 = ?</div>
            <div class="mn-chips"><span>0</span><span>n</span><span>1</span><span class="pulsa" style="font-size:.5rem">Indef.</span></div>
            <p class="mn-mini__pie">Identifica que dividir entre cero da un resultado <b>indefinido</b>.</p></div>`)}
        </div>
        <p class="mn-nota">Los números de estos ejemplos son solo ilustrativos: los ejercicios reales aparecen durante la partida.</p>`
    },
    {
      id: 'palabra', corto: 'Palabra secreta', titulo: 'Palabra secreta con imágenes peruanas', ubic: 'PARTE TRASERA DEL MALETÍN', color: '#4aa8ff',
      html: () => `
        <div class="mn-grid">
          ${tarjeta('Dónde está', maletinSVG('atras', ['palabra'], false) + '<div class="mn-leyenda">Gira el maletín (ratón) o usa «Ver panel trasero».</div>', 'mn-tarjeta--arte')}
          ${tarjeta('Cómo se resuelve', reglas([
            ['num', 'Aparecen <b>varias imágenes</b> de Perú: animales, gastronomía, lugares, cultura…', 1],
            ['num', '<b>Identifica</b> cada imagen (toca una para ampliarla).', 2],
            ['num', 'Toma la <b>primera letra</b> de su nombre, <b>en orden</b>.', 3],
            ['num', 'Une las letras: forman la <b>palabra secreta</b>.', 4],
            ['num', 'Escríbela en el campo de respuesta y pulsa «Desactivar».', 5]
          ]))}
        </div>
        ${tarjeta('Ejemplo ilustrativo · cómo se obtienen las iniciales', `<div class="mn-ejemplo">
            <div class="mn-ejemplo__fila">
              <div class="mn-foto"><div class="mn-foto__marco"><img src="img/oso.svg" alt="Ejemplo: oso"></div><small>OSO</small></div>
              <div class="mn-foto"><div class="mn-foto__marco"><img src="img/cuy.svg" alt="Ejemplo: cuy"></div><small>CUY</small></div>
              <div class="mn-foto"><div class="mn-foto__marco"><img src="img/alpaca.svg" alt="Ejemplo: alpaca"></div><small>ALPACA</small></div>
              <span class="mn-flecha">▶</span>
            </div>
            <div class="mn-letras" aria-label="O, C, A"><span>O</span><span>C</span><span>A</span></div>
            <span class="mn-sello">EJEMPLO · NO ES LA PALABRA DE LA PARTIDA</span>
          </div>`)}
        <div class="mn-aviso"><span class="ico">!</span><span>En el juego <b>no se muestran los nombres</b>: solo una pista de categoría (Animal, Comida, Lugar…). Las tildes y mayúsculas no importan.</span></div>`
    },
    {
      id: 'colores', corto: 'Desafío de colores', titulo: 'Desafío de colores', ubic: 'PARTE TRASERA DEL MALETÍN', color: '#3ddc84',
      html: () => {
        const C = (k, n, t) => `<div class="mn-color" style="--k:${k}"><i></i><span>${n}</span><small>${t}</small></div>`;
        return `
        <div class="mn-grid">
          ${tarjeta('El panel', maletinSVG('atras', ['colores'], false) + '<div class="mn-leyenda">Panel que cambia · leyenda «OBJETIVO» · botón amarillo</div>', 'mn-tarjeta--arte')}
          ${tarjeta('Reglas', reglas([
            'El módulo muestra una <b>leyenda con un color objetivo</b>.',
            'Un <b>panel cambia de color</b> sin parar.',
            ['ok', 'Pulsa el <b>botón</b> justo cuando el panel tenga <b>el mismo color</b> que la leyenda.'],
            'El objetivo <b>puede variar</b> en cada partida.',
            'Cuanto <b>menos tiempo</b> queda en la bomba, <b>más lento</b> cambia el panel.',
            ['mal', 'Si pulsas con otro color, el módulo parpadea en rojo y puedes volver a intentarlo.']
          ]))}
        </div>
        ${tarjeta('Solo existen seis colores', `<div class="mn-colores">
            <div><h4>PRIMARIOS</h4><div class="mn-colores__fila">${C('#EF2929', 'ROJO', 'primario')}${C('#F5D928', 'AMARILLO', 'primario')}${C('#245BE8', 'AZUL', 'primario')}</div></div>
            <div><h4>SECUNDARIOS</h4><div class="mn-colores__fila">${C('#F28C28', 'NARANJA', 'rojo + amarillo')}${C('#27A94D', 'VERDE', 'amarillo + azul')}${C('#8736C8', 'VIOLETA', 'azul + rojo')}</div></div>
            <p class="mn-aviso-sin"><s>COLORES TERCIARIOS</s> · NO EXISTEN EN ESTE DESAFÍO</p>
          </div>`)}`;
      }
    },
    {
      id: 'interf', corto: 'Rata y mosca', titulo: 'Interferencias: rata y mosca', ubic: 'TODA LA ESCENA', color: '#ff7a3d',
      html: () => `
        <div class="mn-aviso mn-aviso--rojo"><span class="ico">!</span><span><b>Son interferencias ambientales, NO acertijos adicionales.</b> No cuentan como módulo ni hay que «resolverlas»: solo debes reaccionar a tiempo y seguir con tus desafíos.</span></div>
        <div class="mn-criaturas">
          ${tarjeta('Rata', `<div class="mn-criatura">
              <div class="mn-criatura__arte">${RATA}<div class="ctl">${ratonSVG('der')}BOTÓN DERECHO</div></div>
              ${reglas(['Aparece <b>sobre el maletín</b> y se desplaza o <b>trepa</b> por sus superficies.', 'Mantente atento a su aparición.', 'Responde con el <b>botón derecho</b> del maletín o la tecla ' + teclado('D') + '.'])}
            </div>`)}
          ${tarjeta('Mosca', `<div class="mn-criatura">
              <div class="mn-criatura__arte">${MOSCA}<div class="ctl">${ratonSVG('izq')}BOTÓN IZQUIERDO</div></div>
              ${reglas(['Aparece <b>volando</b> por la escena y puede <b>posarse sobre el panel</b> de operaciones.', 'Elimínala con el <b>botón izquierdo</b> del maletín o la tecla ' + teclado('A') + '.', ['ok', 'Eliminarla correctamente <b>no tiene penalización</b>.']])}
            </div>`)}
        </div>
        <p class="mn-nota">Cuando una criatura te pida reacción, usar el botón equivocado o tardar demasiado cuesta 1 vida y ${PENAL} segundos, como cualquier error.</p>`
    },
    {
      id: 'controles', corto: 'Controles', titulo: 'Controles', ubic: 'TECLADO Y RATÓN', color: '#4aa8ff',
      html: () => `
        <div class="mn-controles">
          <div class="mn-control" style="--k:#4aa8ff"><div class="mn-control__ico">${ratonSVG('mover')}</div><h3>Explorar el maletín</h3><p><b>Ratón</b> y controles de cámara: arrastra para girar, rueda para acercar. «Ver frente» y «Ver panel trasero» recolocan la cámara.</p></div>
          <div class="mn-control" style="--k:#ffb000"><div class="mn-control__ico">${ratonSVG('izq')}</div><h3>Resolver acertijos</h3><p><b>Clic</b> sobre las opciones (o arrastrar la respuesta al «?»).</p></div>
          <div class="mn-control" style="--k:#3ddc84"><div class="mn-control__ico">${teclado('P', 'A', 'L')}</div><h3>Escribir palabra secreta</h3><p><b>Teclado</b>: escribe en el campo y pulsa Intro o «Desactivar».</p></div>
          <div class="mn-control" style="--k:#ff7a3d"><div class="mn-control__ico">${ratonSVG('der')}</div><h3>Interactuar con la rata</h3><p><b>Botón derecho</b> del maletín o tecla ${teclado('D')}</p></div>
          <div class="mn-control" style="--k:#bfe3ff"><div class="mn-control__ico">${ratonSVG('izq')}</div><h3>Eliminar la mosca</h3><p><b>Botón izquierdo</b> del maletín o tecla ${teclado('A')}</p></div>
          <div class="mn-control" style="--k:#ffb000"><div class="mn-control__ico"><span class="mn-pausa-ico"><i></i><i></i></span></div><h3>Pausar la partida</h3><p><b>Botón «Pausar»</b> de la barra inferior. Congela el tiempo y las criaturas.</p></div>
        </div>
        <p class="mn-nota">Los botones «izquierdo» y «derecho» del maletín son los botones físicos laterales del modelo 3D (iconos de mosca y rata). También funcionan las flechas ← y →.</p>`
    },
    {
      id: 'ganar', corto: '¿Cómo ganar?', titulo: '¿Cómo ganar?', ubic: 'OBJETIVOS', color: '#3ddc84', final: true,
      html: () => `
        <div class="mn-meta">
          <div class="mn-modulo" style="--k:#ffb000">${px(['..#..#..', '.######.', '..#..#..', '########', '..#..#..', '.######.', '..#..#..', '........'], { '#': '#ffb000' }, 'pix')}<b>MATEMÁTICAS</b><small>3 acertijos · frente</small></div>
          <div class="mn-modulo" style="--k:#4aa8ff">${px(['.######.', '#......#', '#.####.#', '#.#..#.#', '#.####.#', '#......#', '.######.', '........'], { '#': '#4aa8ff' }, 'pix')}<b>PALABRA SECRETA</b><small>imágenes · atrás</small></div>
          <div class="mn-modulo" style="--k:#3ddc84">${px(['rrrryyyy', 'rrrryyyy', 'oooogggg', 'oooogggg', 'bbbbvvvv', 'bbbbvvvv', '........', '........'], { r: '#EF2929', y: '#F5D928', b: '#245BE8', o: '#F28C28', g: '#27A94D', v: '#8736C8' }, 'pix')}<b>COLORES</b><small>un botón · atrás</small></div>
        </div>
        <div class="mn-grid">
          ${tarjeta('Objetivos', reglas([
            ['ok', 'Completar los <b>tres acertijos</b> matemáticos.'],
            ['ok', 'Descubrir la <b>palabra secreta</b> de las imágenes peruanas.'],
            ['ok', 'Completar el <b>desafío de colores</b>.'],
            ['ok', '<b>Sobrevivir a las interferencias</b> (rata y mosca).'],
            ['ok', 'Conservar <b>al menos una vida</b>.'],
            ['ok', 'Terminar <b>antes de que el temporizador llegue a cero</b>.']
          ]))}
          <div style="display:grid;gap:12px">
            <div class="mn-frase">Para desactivar la bomba debes completar los <b>tres módulos obligatorios</b>: <b>matemáticas, palabra secreta y colores</b>.</div>
            <div class="mn-aviso mn-aviso--rojo"><span class="ico">⏱</span><span>Tienes <b>${T_TXT}</b> y <b>3 vidas</b>. Al pulsar el botón, el reloj arranca y la cámara muestra el frente del maletín.</span></div>
          </div>
        </div>
        <div class="mn-cta"><button type="button" class="mn-btn mn-btn--grande" data-acc="comenzar">ESTOY LISTO - COMENZAR PARTIDA</button></div>`
    }
  ];
  const N = PAGINAS.length;

  /* ---------- Estado y render ---------- */
  const raiz = document.createElement('div');
  raiz.className = 'mn';
  raiz.id = 'manual-ui';
  raiz.setAttribute('role', 'dialog');
  raiz.setAttribute('aria-modal', 'true');
  raiz.setAttribute('aria-label', 'PERUKISTAN: bienvenida y manual');
  raiz.hidden = true;

  let actual = -1;                 // -1 = bienvenida
  let dir = 'adelante';
  const vistas = new Set();

  function bienvenidaHTML() {
    return `
    <div class="mn-bienvenida">
      <div class="mn-hero">
        <div>
          <span class="mn-etiqueta-lab"><i class="mn-led"></i>LABORATORIO DE DESACTIVACIÓN · BOMBA ARMADA</span>
          <h1 class="mn-titulo">PERUKISTAN<span>DESACTIVA LA BOMBA</span></h1>
          <p class="mn-lema">Resuelve los desafíos, evita las interferencias y desactiva la bomba antes de que termine el tiempo.</p>
          <div class="mn-botones">
            <button type="button" class="mn-btn mn-btn--grande" data-acc="manual">▶ VER MANUAL</button>
            <button type="button" class="mn-btn mn-btn--azul mn-btn--grande" data-acc="controles">⌨ CONTROLES</button>
          </div>
          <div class="mn-botones" style="margin-top:6px"><button type="button" class="mn-btn mn-btn--enlace" data-acc="directo">Ya sé jugar · comenzar directo ▸</button></div>
        </div>
        <div class="mn-hero__arte mn-esquinas" style="--ac:#ff3b30">${maletinSVG('frente', ['tiempo'], false)}</div>
      </div>
      <div class="mn-datos" role="list" aria-label="Datos de la misión">
        <div class="mn-dato" role="listitem" style="--ac:#ff3b30"><small>TIEMPO DISPONIBLE</small><b>${T_TXT}</b></div>
        <div class="mn-dato" role="listitem" style="--ac:#ff3b30"><small>VIDAS</small><span class="mn-corazones">${CORAZON()}${CORAZON()}${CORAZON()}</span></div>
        <div class="mn-dato" role="listitem" style="--ac:#3ddc84"><small>MÓDULOS OBLIGATORIOS</small><b>3</b></div>
        <div class="mn-dato" role="listitem" style="--ac:#ffb000"><small>DIFICULTAD</small><span class="mn-barras" aria-label="Dificultad 4 de 5"><i class="on"></i><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span></div>
      </div>
    </div>`;
  }

  function manualHTML() {
    const p = PAGINAS[actual];
    const prev = actual > 0;
    return `
    <header class="mn-top">
      <span class="mn-marca">PERUKISTAN</span>
      <div class="mn-progreso">
        <div class="mn-progreso__fila"><span>MANUAL · SECCIÓN ${actual + 1}/${N}</span><span>LEÍDO ${vistas.size}/${N}</span></div>
        <div class="mn-barra" aria-hidden="true">${PAGINAS.map((_, i) => `<i class="${i === actual ? 'actual' : vistas.has(i) ? 'vista' : ''}"></i>`).join('')}</div>
      </div>
      <button type="button" class="mn-btn mn-btn--rojo" data-acc="menu">✕ MENÚ</button>
    </header>
    <div class="mn-cuerpo">
      <nav class="mn-indice" aria-label="Índice del manual">
        ${PAGINAS.map((q, i) => `<button type="button" data-ir="${i}" style="--bc:${q.color}" class="${vistas.has(i) && i !== actual ? 'vista' : ''}" ${i === actual ? 'aria-current="page"' : ''}><span class="n">${i + 1}</span><span class="t">${q.corto}</span><span class="ok">✔</span></button>`).join('')}
      </nav>
      <div class="mn-scroll" id="mn-scroll">
        <section class="mn-pagina" data-dir="${dir === 'atras' ? 'atras' : 'adelante'}" style="--ac:${p.color}" aria-live="polite">
          <div class="mn-pagina__cab"><h2><em>${String(actual + 1).padStart(2, '0')}</em>${p.titulo.toUpperCase()}</h2><span class="mn-ubic">◉ ${p.ubic}</span></div>
          ${p.html()}
        </section>
      </div>
    </div>
    <footer class="mn-pie">
      <button type="button" class="mn-btn mn-btn--ambar" data-acc="anterior" ${prev ? '' : 'disabled'}>◀ ANTERIOR</button>
      <span class="mn-pie__pag">${p.corto.toUpperCase()}</span>
      ${p.final ? '<button type="button" class="mn-btn mn-btn--enlace" data-acc="menu">MENÚ</button>' : '<button type="button" class="mn-btn" data-acc="siguiente">SIGUIENTE ▶</button>'}
    </footer>`;
  }

  function render(foco) {
    raiz.innerHTML = actual < 0 ? bienvenidaHTML() : manualHTML();
    raiz.style.setProperty('--ac', actual < 0 ? '#ffb000' : PAGINAS[actual].color);
    if (actual >= 0) {
      const act = raiz.querySelector('.mn-indice [aria-current="page"]');
      if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    if (foco !== false) {
      const sel = actual < 0 ? '[data-acc="manual"]' : PAGINAS[actual].final ? '.mn-cta .mn-btn' : '[data-acc="siguiente"]';
      const btn = raiz.querySelector(sel);
      if (btn) btn.focus({ preventScroll: true });
    }
  }

  function ir(i, direccion) {
    i = Math.max(0, Math.min(N - 1, i));
    dir = direccion || (i < actual ? 'atras' : 'adelante');
    actual = i;
    vistas.add(i);
    render();
  }
  function bienvenida() { actual = -1; dir = 'atras'; render(); }

  /* ---------- Acciones ---------- */
  function mostrar() {
    vistas.clear();
    actual = -1;
    raiz.hidden = false;
    document.body.classList.add('manual-abierto');
    render();
  }
  function ocultar() {
    raiz.hidden = true;
    document.body.classList.remove('manual-abierto');
  }
  function comenzar() {
    if (raiz.hidden) return;
    ocultar();
    const cb = api.alComenzar;
    if (typeof cb === 'function') cb();
  }

  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !raiz.contains(b)) return;
    if (b.dataset.ir !== undefined) return ir(Number(b.dataset.ir));
    switch (b.dataset.acc) {
      case 'manual': return ir(0, 'adelante');
      case 'controles': return ir(PAGINAS.findIndex((p) => p.id === 'controles'), 'adelante');
      case 'siguiente': return ir(actual + 1, 'adelante');
      case 'anterior': return ir(actual - 1, 'atras');
      case 'menu': return bienvenida();
      case 'comenzar': case 'directo': return comenzar();
      default:
    }
  });

  window.addEventListener('keydown', (e) => {
    if (raiz.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (actual >= 0) {
      if (e.key === 'ArrowRight') { e.preventDefault(); if (actual < N - 1) ir(actual + 1, 'adelante'); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (actual > 0) ir(actual - 1, 'atras'); }
      else if (e.key === 'Escape') bienvenida();
      else if (/^[1-7]$/.test(e.key) && Number(e.key) <= N) ir(Number(e.key) - 1);
    }
  });

  const api = {
    alComenzar: null,
    get abierto() { return !raiz.hidden; },
    mostrarBienvenida: mostrar,
    abrirManual() { mostrar(); ir(0, 'adelante'); },   // tras la introducción: directo a la sección 1
    ocultar
  };
  global.ManualUI = api;

  function montar() {
    document.body.appendChild(raiz);
    if (!global.PERUKISTAN_INTRO) mostrar();      // con intro.js, la introducción abre el manual al terminar u omitirse
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})(window);
