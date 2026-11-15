/* =========================================================
   Efectos visuales 3D de la bomba: explosión (fallo) y
   desactivación (victoria). Partículas hechas con voxels.
   ========================================================= */

const GRAVEDAD = -7;

export function crearEfectos(THREE, scene) {
  const cubo = new THREE.BoxGeometry(1, 1, 1);
  const anillo = new THREE.RingGeometry(0.92, 1, 48);
  const materiales = {
    fuego:  new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
    brasa:  new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    humo:   new THREE.MeshBasicMaterial({ color: 0x2a2a30 }),
    metal:  new THREE.MeshBasicMaterial({ color: 0xa3aab6 }),
    verde:  new THREE.MeshBasicMaterial({ color: 0x3ddc84 }),
    lima:   new THREE.MeshBasicMaterial({ color: 0xb6ffd0 }),
    ambar:  new THREE.MeshBasicMaterial({ color: 0xffb000 })
  };
  const matAnillo = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, side: THREE.DoubleSide, depthWrite: false });

  const luz = new THREE.PointLight(0xffffff, 0, 14);
  luz.position.set(0, 0.3, 1.6);
  scene.add(luz);

  let particulas = [];
  let ondas = [];
  let destello = { t: 0, dur: 0, pico: 0 };
  let sacudida = { t: 0, dur: 0, fuerza: 0 };

  function lanzar(cantidad, tipos, { velMin, velMax, tamMin, tamMax, vida, arriba = 0, origen }) {
    for (let i = 0; i < cantidad; i++) {
      const m = new THREE.Mesh(cubo, materiales[tipos[Math.floor(Math.random() * tipos.length)]]);
      const tam = tamMin + Math.random() * (tamMax - tamMin);
      m.scale.setScalar(tam);
      m.position.set(
        origen.x + (Math.random() - 0.5) * 1.6,
        origen.y + (Math.random() - 0.5) * 1.0,
        origen.z + (Math.random() - 0.5) * 0.6
      );
      // dirección aleatoria hacia fuera (y hacia la cámara, para que se vea)
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.15, Math.random() * 0.8 + 0.1).normalize();
      const v = velMin + Math.random() * (velMax - velMin);
      particulas.push({
        m,
        vel: d.multiplyScalar(v).add(new THREE.Vector3(0, arriba, 0)),
        giro: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        edad: 0,
        vida: vida * (0.7 + Math.random() * 0.6),
        tam
      });
      scene.add(m);
    }
  }

  function limpiar() {
    for (const p of particulas) scene.remove(p.m);
    for (const o of ondas) { scene.remove(o.m); o.m.material.dispose(); }
    particulas = [];
    ondas = [];
    luz.intensity = 0;
    destello = { t: 0, dur: 0, pico: 0 };
    sacudida = { t: 0, dur: 0, fuerza: 0 };
  }

  const origen = new THREE.Vector3(0, 0.1, 0.4);

  function explosion(reducirMovimiento) {
    limpiar();
    lanzar(reducirMovimiento ? 24 : 90, ['fuego', 'brasa', 'humo', 'metal'],
      { velMin: 2, velMax: 6.5, tamMin: 0.06, tamMax: 0.2, vida: 2.2, arriba: 1.5, origen });
    luz.color.set(0xff8a2a);
    destello = { t: 0, dur: 0.9, pico: 18 };
    if (!reducirMovimiento) sacudida = { t: 0, dur: 0.8, fuerza: 0.09 };
  }

  function desactivacion(reducirMovimiento) {
    limpiar();
    lanzar(reducirMovimiento ? 16 : 60, ['verde', 'lima', 'ambar'],
      { velMin: 1.5, velMax: 4.5, tamMin: 0.05, tamMax: 0.16, vida: 2.4, arriba: 3, origen: new THREE.Vector3(0, 0.6, 0.6) });
    luz.color.set(0x3ddc84);
    destello = { t: 0, dur: 0.9, pico: 9 };
    for (let i = 0; i < 3; i++) {           // ondas verdes de "desactivado"
      const m = new THREE.Mesh(anillo, matAnillo.clone());
      m.position.set(0, 0.25, 0.7);
      m.scale.setScalar(0.01);
      m.visible = false;
      scene.add(m);
      ondas.push({ m, retraso: i * 0.22, t: 0, dur: 1.1 });
    }
  }

  /** Devuelve el desplazamiento de sacudida (x, y) a aplicar al modelo. */
  const salida = { x: 0, y: 0 };
  function actualizar(dt) {
    for (let i = particulas.length - 1; i >= 0; i--) {
      const p = particulas[i];
      p.edad += dt;
      if (p.edad >= p.vida) { scene.remove(p.m); particulas.splice(i, 1); continue; }
      p.vel.y += GRAVEDAD * dt;
      p.m.position.addScaledVector(p.vel, dt);
      p.m.rotation.x += p.giro.x * dt;
      p.m.rotation.y += p.giro.y * dt;
      const resto = 1 - p.edad / p.vida;
      p.m.scale.setScalar(p.tam * Math.min(1, resto * 2.5));
    }
    for (let i = ondas.length - 1; i >= 0; i--) {
      const o = ondas[i];
      o.retraso -= dt;
      if (o.retraso > 0) continue;
      o.t += dt;
      const k = o.t / o.dur;
      if (k >= 1) { scene.remove(o.m); o.m.material.dispose(); ondas.splice(i, 1); continue; }
      o.m.visible = true;
      o.m.scale.setScalar(0.3 + k * 2.2);
      o.m.material.opacity = 1 - k;
    }
    if (destello.dur > 0) {
      destello.t += dt;
      const k = destello.t / destello.dur;
      luz.intensity = k >= 1 ? 0 : destello.pico * (1 - k) * (1 - k);
      if (k >= 1) destello.dur = 0;
    }
    if (sacudida.dur > 0) {
      sacudida.t += dt;
      const k = sacudida.t / sacudida.dur;
      const f = k >= 1 ? 0 : sacudida.fuerza * (1 - k);
      salida.x = (Math.random() - 0.5) * 2 * f;
      salida.y = (Math.random() - 0.5) * 2 * f;
      if (k >= 1) sacudida.dur = 0;
    } else { salida.x = salida.y = 0; }
    return salida;
  }

  function liberar() {
    limpiar();
    scene.remove(luz);
    cubo.dispose();
    anillo.dispose();
    matAnillo.dispose();
    Object.values(materiales).forEach((m) => m.dispose());
  }

  return { explosion, desactivacion, limpiar, actualizar, liberar };
}
