/* Procedural asset factories. Coordinates are metres; +Z is the prop's front.
   Every silhouette is solid geometry, including card relief and chain links.
   Replace named factory roots with GLB nodes, retaining their local axes. */
export function createTunnelWorld(T, scene, path, quality) {
  const low = quality === 'LOW', high = quality === 'HIGH';
  const material = (color, roughness, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness });
  const mats = {
    paper: material(0xe7e0d2, .93), wood: material(0x111111, .85),
    trim: material(0x68645f, .8), metal: material(0x686868, .55, .8),
    bone: material(0xf4f0e7, .37), wall: material(0x292929, .95),
    glow: new T.MeshStandardMaterial({ color: 0xfffdf5, emissive: 0xfffdf5, emissiveIntensity: 2, roughness: .7 }),
    glass: material(0x17191a, .25, .6)
  };
  // Subtle surface variation is shading on the solid meshes, never scenery
  // billboards or raster artwork. Keep the same inexpensive material pipeline.
  for (const mat of [mats.paper, mats.wood, mats.trim, mats.wall, mats.metal]) {
    mat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCraftPosition;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvCraftPosition = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCraftPosition;').replace('#include <color_fragment>', `#include <color_fragment>
        float grain = sin(vCraftPosition.x * 83.0 + sin(vCraftPosition.y * 13.0) * 1.8) * sin(vCraftPosition.z * 67.0 + vCraftPosition.y * 131.0);
        float wear = sin(vCraftPosition.y * 2.7 + vCraftPosition.x * 4.3) * sin(vCraftPosition.z * 3.1);
        diffuseColor.rgb *= 0.94 + grain * 0.035 + wear * 0.035;`);
    };
    mat.customProgramCacheKey = () => 'storybook-surface-v1';
  }
  const box = new T.BoxGeometry(1, 1, 1);
  const sphere = new T.SphereGeometry(1, 16, 10);
  const cylinder = new T.CylinderGeometry(1, 1, 1, 16);
  const ring = new T.TorusGeometry(1, .1, 6, 28);
  const v = (x, y, z) => new T.Vector3(x, y, z);
  const group = name => { const g = new T.Group(); g.name = name; return g; };
  function mesh(parent, geometry, mat, position = [0, 0, 0], scale = [1, 1, 1]) {
    const m = new T.Mesh(geometry, mat); m.position.set(...position); m.scale.set(...scale); parent.add(m); return m;
  }
  function bar(parent, a, b, radius, mat) {
    const delta = b.clone().sub(a);
    const m = mesh(parent, cylinder, mat, a.clone().add(b).multiplyScalar(.5).toArray(), [radius, delta.length(), radius]);
    m.quaternion.setFromUnitVectors(v(0, 1, 0), delta.normalize()); return m;
  }
  function pipe(parent, points, radius, mat, segments = 24) {
    return mesh(parent, new T.TubeGeometry(new T.CatmullRomCurve3(points), segments, radius, 6, false), mat);
  }
  // Bake static submeshes by material, preserving a named replaceable root.
  // This reduces hundreds of sculpted parts to a handful of draw calls.
  function bake(root) {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const batches = new Map();
    root.traverse(child => {
      if (!child.isMesh) return;
      const matrix = inverse.clone().multiply(child.matrixWorld);
      const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
      geometry.applyMatrix4(matrix);
      const bucket = batches.get(child.material) || { p: [], n: [], count: 0 };
      bucket.p.push(geometry.attributes.position.array); bucket.n.push(geometry.attributes.normal.array);
      bucket.count += geometry.attributes.position.array.length;
      batches.set(child.material, bucket); geometry.dispose();
    });
    root.clear();
    batches.forEach((data, mat) => {
      const p = new Float32Array(data.count), n = new Float32Array(data.count);
      let offset = 0;
      data.p.forEach((a, i) => { p.set(a, offset); n.set(data.n[i], offset); offset += a.length; });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(p, 3));
      geo.setAttribute('normal', new T.BufferAttribute(n, 3));
      mesh(root, geo, mat);
    });
    return root;
  }
  function anchor(p, name, offset = [0, 0, 0]) {
    const a = group(name);
    a.position.copy(path.position.getPoint(p));
    a.quaternion.setFromUnitVectors(v(0, 0, -1), path.position.getTangent(p));
    a.position.add(v(...offset).applyQuaternion(a.quaternion));
    scene.add(a); return a;
  }
  function chain(parent, length) {
    const count = Math.ceil(length / .18);
    for (let i = 0; i < count; i++) {
      const link = mesh(parent, ring, mats.metal, [Math.sin(i * .28) * .035, i * .18, 0], [.105, .15, .105]);
      link.rotation.y = (i % 2) * Math.PI / 2;
    }
  }
  function createArchPlaceholder() {
    const g = group('ENV_Arch_01');
    const points = [v(-2.5, -3, 0), v(-2.45, 0, 0), v(-1.85, 2.3, 0), v(.12, 4.1, 0), v(1.9, 2.1, 0), v(2.55, -.1, 0), v(2.65, -3, 0)];
    pipe(g, points, .16, mats.trim, 36);
    pipe(g, points.map(p => v(p.x * .94, p.y * .96, .16)), .055, mats.paper, 36);
    for (const side of [-1, 1]) {
      mesh(g, box, mats.wood, [side * 2.55, -2.4, 0], [.6, 1.5, .65]);
      mesh(g, box, mats.trim, [side * 2.55, -1.65, 0], [.7, .13, .7]);
      for (const y of [-1.4, -.1, 1.15]) {
        const x = side * (y > 0 ? 2.2 : 2.5);
        mesh(g, box, mats.wood, [x, y, -.06], [.48, .14, .58]);
        mesh(g, box, mats.trim, [x, y + .09, .02], [.52, .055, .6]);
      }
    }
    mesh(g, new T.OctahedronGeometry(.25), mats.paper, [.12, 4.1, .11], [1, 1.6, .6]);
    return bake(g);
  }
  function createRabbitPlaceholder() {
    const g = group('PROP_Rabbit_01');
    mesh(g, sphere, mats.bone, [0, .38, 0], [.3, .43, .27]);
    mesh(g, sphere, mats.bone, [.11, .83, 0], [.24, .25, .22]);
    mesh(g, sphere, mats.bone, [-.27, .3, 0], [.16, .16, .16]);
    for (const x of [-.02, .2]) {
      const ear = mesh(g, sphere, mats.bone, [x, 1.24, 0], [.075, .37, .065]); ear.rotation.z = x ? -.2 : .2;
      mesh(g, sphere, mats.wood, [x, 1.26, .058], [.03, .25, .015]);
    }
    mesh(g, sphere, mats.wood, [.17, .86, .196], [.025, .025, .025]);
    mesh(g, sphere, mats.bone, [.12, .04, .15], [.28, .08, .14]);
    return bake(g);
  }
  function createLanternPlaceholder() {
    const g = group('PROP_Lantern_01');
    for (const y of [-.65, .65]) mesh(g, box, mats.metal, [0, y, 0], [.72, .13, .72]);
    for (const x of [-.3, .3]) for (const z of [-.3, .3]) bar(g, v(x, -.65, z), v(x * .8, .65, z * .8), .035, mats.metal);
    mesh(g, new T.ConeGeometry(.5, .5, 4), mats.metal, [0, .93, 0]).rotation.y = Math.PI / 4;
    mesh(g, sphere, mats.glow, [0, 0, 0], [.09, .36, .09]);
    const links = group('lantern-chain'); links.position.y = 1.17; chain(links, 1.6); g.add(links);
    return bake(g);
  }
  function createPocketWatchPlaceholder() {
    const g = group('PROP_Watch_01');
    mesh(g, cylinder, mats.metal, [0, 0, 0], [1.46, .28, 1.46]).rotation.x = Math.PI / 2;
    mesh(g, cylinder, mats.paper, [0, 0, .17], [1.29, .055, 1.29]).rotation.x = Math.PI / 2;
    mesh(g, ring, mats.metal, [0, 0, .18], [1.33, 1.33, .7]);
    for (let i = 0; i < 60; i++) {
      const a = i * Math.PI / 30;
      const tick = mesh(g, box, mats.wood, [Math.sin(a) * 1.14, Math.cos(a) * 1.14, .22], [i % 5 ? .013 : .035, i % 5 ? .06 : .17, .012]);
      tick.rotation.z = -a;
    }
    const numerals = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    numerals.forEach((roman, i) => {
      const a = i * Math.PI / 6, center = v(Math.sin(a) * .91, Math.cos(a) * .91, .235);
      [...roman].forEach((letter, j) => {
        const x = center.x + (j - (roman.length - 1) / 2) * .075, y = center.y;
        if (letter === 'I') bar(g, v(x, y - .095, .235), v(x, y + .095, .235), .01, mats.wood);
        else if (letter === 'V') {
          bar(g, v(x - .03, y + .095, .235), v(x, y - .095, .235), .01, mats.wood);
          bar(g, v(x + .03, y + .095, .235), v(x, y - .095, .235), .01, mats.wood);
        } else {
          bar(g, v(x - .03, y + .095, .235), v(x + .03, y - .095, .235), .01, mats.wood);
          bar(g, v(x + .03, y + .095, .235), v(x - .03, y - .095, .235), .01, mats.wood);
        }
      });
    });
    bar(g, v(0, 0, .26), v(.13, .85, .26), .024, mats.wood);
    bar(g, v(0, 0, .28), v(-.6, -.33, .28), .037, mats.wood);
    mesh(g, sphere, mats.metal, [0, 0, .29], [.08, .08, .04]);
    mesh(g, ring, mats.metal, [0, 1.7, 0], [.28, .33, .28]);
    mesh(g, cylinder, mats.metal, [0, 1.48, 0], [.16, .2, .16]);
    const links = group('watch-chain'); links.position.y = 2; chain(links, 3); g.add(links);
    return bake(g);
  }
  function createKeyPlaceholder() {
    const g = group('PROP_Key');
    mesh(g, ring, mats.metal, [0, .45, 0], [.25, .25, .25]);
    bar(g, v(0, .2, 0), v(0, -.6, 0), .045, mats.metal);
    mesh(g, box, mats.metal, [.12, -.5, 0], [.27, .1, .09]);
    mesh(g, box, mats.metal, [.22, -.42, 0], [.08, .15, .09]);
    return bake(g);
  }
  function createTeapotPlaceholder() {
    const g = group('PROP_Teapot_01');
    const points = [[.25, -.6], [.5, -.54], [.65, -.22], [.63, .22], [.4, .48]].map(p => new T.Vector2(...p));
    mesh(g, new T.LatheGeometry(points, 24), mats.bone);
    mesh(g, sphere, mats.bone, [0, .48, 0], [.44, .1, .44]);
    mesh(g, sphere, mats.metal, [0, .62, 0], [.1, .1, .1]);
    pipe(g, [v(.5, -.2, 0), v(.8, -.02, 0), v(.85, .4, 0), v(1.18, .72, 0)], .12, mats.bone);
    pipe(g, [v(-.4, .32, 0), v(-1, .5, 0), v(-1.12, -.22, 0), v(-.5, -.42, 0)], .075, mats.bone);
    for (const y of [-.51, .44]) mesh(g, ring, mats.wood, [0, y, 0], [.39, .39, .18]).rotation.x = Math.PI / 2;
    return bake(g);
  }
  function createChessPlaceholder() {
    const g = group('PROP_Chess_01');
    const points = [[.42, 0], [.45, .12], [.25, .22], [.2, .4], [.13, .85], [.25, 1.05], [.24, 1.15]].map(p => new T.Vector2(...p));
    mesh(g, new T.LatheGeometry(points, 20), mats.bone);
    mesh(g, sphere, mats.bone, [.08, 1.35, 0], [.22, .25, .22]);
    mesh(g, box, mats.wood, [.08, 1.65, 0], [.09, .4, .09]);
    mesh(g, box, mats.wood, [.08, 1.71, 0], [.28, .075, .08]);
    g.rotation.z = -.14; return bake(g);
  }
  function createMushroomsPlaceholder() {
    const g = group('PROP_Mushroom_01');
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * .55, h = .7 + i * .3;
      pipe(g, [v(x, 0, 0), v(x + .15, h * .55, 0), v(x - .1, h, 0)], .09, mats.bone, 12);
      mesh(g, sphere, i % 2 ? mats.trim : mats.paper, [x - .1, h, 0], [.45 + i * .1, .2, .4]);
      for (let j = 0; j < 4; j++) mesh(g, sphere, mats.wood, [x - .35 + j * .15, h + .14, .1], [.035, .04, .04]);
    }
    return bake(g);
  }
  function createDoorPlaceholder(name, skew) {
    const g = group(name), hinge = group(`${name}_Hinge`);
    const frame = createArchPlaceholder(); frame.scale.set(.69, 1, .85); g.add(frame);
    hinge.position.set(-1.55, 0, 0); g.add(hinge);
    mesh(hinge, box, mats.wood, [1.55, .12, 0], [3.1, 6.3, .23]);
    for (const y of [-1.45, 1.55]) {
      mesh(hinge, box, mats.trim, [1.55, y, .13], [2.7, 2.6, .1]);
      mesh(hinge, box, mats.wood, [1.55, y, .2], [2.45, 2.32, .09]);
    }
    mesh(hinge, sphere, mats.metal, [2.8, -.05, .32], [.1, .1, .1]);
    bake(hinge); g.rotation.z = skew;
    return { root: g, hinge };
  }
  function createLookingGlassPlaceholder() {
    const g = group('PROP_LookingGlass_01');
    mesh(g, ring, mats.metal, [0, 0, 0], [1.9, 3.4, 1.5]);
    mesh(g, ring, mats.paper, [0, 0, .09], [1.75, 3.22, .7]);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      mesh(g, sphere, mats.trim, [Math.sin(a) * 1.92, Math.cos(a) * 3.43, 0], [.12, .2, .14]);
    }
    bake(g);
    const surface = mesh(g, sphere, mats.glass, [0, 0, -.08], [1.72, 3.17, .09]);
    surface.name = 'PROP_LookingGlass_Surface';
    g.userData.surface = surface;
    return g;
  }
  function keyholeShape(scale = 1) {
    const s = new T.Shape();
    s.moveTo(-.85 * scale, -.1 * scale);
    s.bezierCurveTo(-1.8 * scale, .7 * scale, -.95 * scale, 2.4 * scale, 0, 2.4 * scale);
    s.bezierCurveTo(.95 * scale, 2.4 * scale, 1.8 * scale, .7 * scale, .85 * scale, -.1 * scale);
    s.lineTo(1.15 * scale, -2.6 * scale); s.lineTo(-1.15 * scale, -2.6 * scale); s.closePath();
    return s;
  }
  function createKeyholeDoorPlaceholder() {
    const g = group('PROP_Keyhole_01');
    const outer = new T.Shape(); outer.moveTo(-4.4, -5); outer.lineTo(4.7, -5); outer.lineTo(4.2, 5); outer.lineTo(-3.9, 5.4); outer.closePath();
    const hole = new T.Path(); hole.copy(keyholeShape()); outer.holes.push(hole);
    mesh(g, new T.ExtrudeGeometry(outer, { depth: .45, bevelEnabled: true, bevelSize: .08, bevelThickness: .05, bevelSegments: 1, steps: 1, curveSegments: 24 }), mats.wood);
    const outline = keyholeShape().getPoints(64).map(p => v(p.x, p.y, .5)); outline.push(outline[0].clone());
    pipe(g, outline, .075, mats.glow, 100);
    // Receding ribs behind the cut-out make the opening's depth unambiguous.
    for (let i = 1; i <= 4; i++) pipe(g, outline.map(p => v(p.x * (1 + i * .12), p.y * (1 + i * .12), -i * 2)), .035, mats.trim, 64);
    return bake(g);
  }
  const profile = p => {
    const chamber = Math.max(0, 1 - Math.abs(p - .345) / .105);
    const narrow = Math.max(0, 1 - Math.abs(p - .49) / .085);
    return [3.25 + chamber * 3.75 - narrow * .8, 3.5 + chamber * 4];
  };
  // A continuous hollow architectural shell with real inner/outer thickness.
  const positions = [], indices = [];
  const sections = 144, sides = 7;
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i <= sections; i++) {
    const p = i / sections, center = path.position.getPoint(p);
    const q = new T.Quaternion().setFromUnitVectors(v(0, 0, -1), path.position.getTangent(p));
    const [w, h] = profile(p), thickness = layer * .3;
    const cross = [[-w, -h], [w, -h], [w, h * .35], [w * .65, h], [0, h * 1.4], [-w * .65, h], [-w, h * .35]];
    cross.forEach(([x, y], j) => {
      const irregular = 1 + Math.sin(i * .6 + j * 2) * .018;
      const point = v(x * irregular + Math.sign(x) * thickness, y * irregular + Math.sign(y) * thickness, 0).applyQuaternion(q).add(center);
      positions.push(...point.toArray());
    });
  }
  const stride = (sections + 1) * sides;
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i < sections; i++) for (let j = 0; j < sides; j++) {
    const a = layer * stride + i * sides + j, b = layer * stride + i * sides + (j + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  for (const i of [0, sections]) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    indices.push(a, a + stride, b, b, a + stride, b + stride);
  }
  const walls = new T.BufferGeometry(); walls.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); walls.setIndex(indices); walls.computeVertexNormals();
  mats.wall.side = T.DoubleSide;
  const wall = mesh(scene, walls, mats.wall); wall.name = 'ENV_Tunnel_01';
  const archSource = createArchPlaceholder();
  for (let i = 0; i < (low ? 21 : 30); i++) {
    const p = .023 + i * .9 / (low ? 21 : 30), [w, h] = profile(p);
    const root = anchor(p, `ENV_Arch_${String(i + 1).padStart(2, '0')}`);
    const arch = archSource.clone(); arch.name = 'arch-sculpture';
    arch.scale.set(w / 2.8, h / 3.5, 1); arch.rotation.z = Math.sin(i * 1.7) * .11;
    root.add(arch);
  }
  // Solid chessboard floor fragments that disappear into the vertical shaft.
  const tileCount = low ? 126 : 210;
  const tiles = new T.InstancedMesh(box, mats.trim, tileCount), dummy = new T.Object3D();
  tiles.name = 'ENV_BrokenChessFloor'; scene.add(tiles);
  for (let i = 0; i < tileCount; i++) {
    const row = Math.floor(i / 6), col = i % 6, p = .015 + row / Math.ceil(tileCount / 6) * .77;
    const [w, h] = profile(p), q = new T.Quaternion().setFromUnitVectors(v(0, 0, -1), path.position.getTangent(p));
    dummy.position.copy(path.position.getPoint(p)).add(v((col - 2.5) * w / 3, -h + .08, 0).applyQuaternion(q));
    dummy.quaternion.copy(q); dummy.rotateY(Math.sin(i * 2) * .035);
    dummy.scale.set(w / 3 * .96, .13, .9); dummy.updateMatrix(); tiles.setMatrixAt(i, dummy.matrix);
    tiles.setColorAt(i, new T.Color((row + col) % 2 ? 0x181818 : 0xbab3a5));
  }
  const lantern = anchor(.085, 'LOC_Lantern', [1.15, 1.2, 0]); lantern.add(createLanternPlaceholder());
  const rabbit = anchor(.13, 'LOC_Rabbit', [0, -2.9, 0]);
  const rabbitVisual = createRabbitPlaceholder(); rabbit.add(rabbitVisual);
  const rabbitDoor = anchor(.132, 'ENV_RabbitDoor');
  for (const side of [-1, 1]) mesh(rabbitDoor, box, mats.wood, [side * 2.8, -.6, 0], [2.1, 5.8, .7]);
  bake(rabbitDoor);
  const watchAnchor = anchor(.505, 'LOC_Watch', [0, 1.9, 0]);
  const watch = createPocketWatchPlaceholder(); watchAnchor.add(watch);
  const teapot = anchor(.465, 'LOC_Teapot', [-1.7, -.9, 0]); teapot.add(createTeapotPlaceholder()); teapot.rotation.z += .2;
  const chess = anchor(.205, 'LOC_Chess', [1.6, -2.8, 0]); chess.add(createChessPlaceholder()); chess.scale.setScalar(1.4);
  const mushrooms = anchor(.17, 'LOC_Mushrooms', [-2, -3.2, 0]); mushrooms.add(createMushroomsPlaceholder());
  // Recessed architectural cabinets, framed voids, and long overhead braces.
  // The dark backs sit behind thick jambs; grazing light exposes their depth.
  for (let i = 0; i < (low ? 4 : 7); i++) {
    const p = .1 + i * .066, side = i % 2 ? -1 : 1, [w] = profile(p);
    const niche = anchor(p, `ENV_Niche_${i}`, [side * (w - .15), -.35, 0]);
    niche.rotateY(-side * Math.PI / 2); niche.rotateZ(side * (.06 + i % 3 * .035));
    mesh(niche, box, mats.wood, [0, 0, -.4], [1.6, 3.9, .3]);
    for (const x of [-.88, .88]) mesh(niche, box, mats.trim, [x, 0, 0], [.16, 4.15, .95]);
    for (const y of [-2.05, 2.05]) mesh(niche, box, mats.trim, [0, y, 0], [1.9, .16, .95]);
    for (const y of [-1.4, -.35, .72]) mesh(niche, box, mats.wood, [0, y, .04], [1.65, .11, .85]);
    if (i % 2) { const item = createChessPlaceholder(); item.position.set(.2, -1.35, 0); item.scale.setScalar(.6); niche.add(item); }
    bake(niche);
  }
  const doors = [.625, .674, .72].map((p, i) => {
    const a = anchor(p, `LOC_Door_${i + 1}`), door = createDoorPlaceholder(`PROP_Door_0${i + 1}`, [-.08, .18, -.2][i]);
    a.add(door.root); return { ...door, p };
  });
  const mirror = anchor(.785, 'LOC_Mirror');
  const mirrorVisual = createLookingGlassPlaceholder(); mirror.add(mirrorVisual); mirror.rotateZ(.08);
  const portal = anchor(.966, 'LOC_Keyhole'); portal.add(createKeyholeDoorPlaceholder());
  const keys = [];
  for (let i = 0; i < (low ? 4 : 8); i++) {
    const p = .5 + i * .05;
    const key = anchor(p, `LOC_Key_${i}`, [(i % 2 ? -1 : 1) * 1.25, .2 + (i % 3) * .65, 0]);
    key.add(createKeyPlaceholder()); keys.push({ root: key, base: key.position.clone(), q: key.quaternion.clone() });
  }
  // The shaft is populated on multiple sides and depths, including sideways
  // doorways. These remain real world-space objects as the camera pitches down.
  const shaftProps = [];
  for (let i = 0; i < (low ? 4 : high ? 10 : 7); i++) {
    const p = .815 + i * .012, angle = i * 2.39996;
    const root = anchor(p, `LOC_ShaftProp_${i}`, [Math.cos(angle) * 2.3, Math.sin(angle) * 2.3, 0]);
    const factory = [createTeapotPlaceholder, createMushroomsPlaceholder, createChessPlaceholder, createLanternPlaceholder][i % 4];
    root.add(factory()); root.scale.setScalar(i % 4 === 1 ? 1.5 : .85);
    root.rotateZ(angle * .5);
    shaftProps.push({ root, q: root.quaternion.clone(), base: root.position.clone() });
  }
  for (const p of [.84, .895]) {
    const root = anchor(p, 'ENV_ShaftSideDoor', [2.8, 0, 0]);
    const door = createDoorPlaceholder('PROP_ShaftDoor', .2); root.add(door.root); root.rotateY(-Math.PI / 2); root.scale.setScalar(.55);
  }
  // Thick cards and inset suit emblems share transforms using InstancedMesh.
  function createCardInstanceSet() {
    let count = low ? 32 : high ? 60 : 48;
    const cardGeo = new T.BoxGeometry(1.05, 1.65, .012);
    const cards = new T.InstancedMesh(cardGeo, mats.paper, count); cards.name = 'PROP_Card_01';
    const suit = new T.Shape(); suit.moveTo(0, .32); suit.bezierCurveTo(-.12, .13, -.36, -.02, -.23, -.17); suit.bezierCurveTo(-.12, -.29, -.04, -.13, 0, -.14); suit.lineTo(-.08, -.31); suit.lineTo(.08, -.31); suit.lineTo(0, -.14); suit.bezierCurveTo(.04, -.13, .12, -.29, .23, -.17); suit.bezierCurveTo(.36, -.02, .12, .13, 0, .32);
    const marks = new T.InstancedMesh(new T.ExtrudeGeometry(suit, { depth: .015, bevelEnabled: false, curveSegments: 8 }), mats.wood, count); marks.name = 'PROP_Card_Suits';
    const borderRoot = group('card-border');
    for (const side of [-1, 1]) {
      mesh(borderRoot, box, mats.wood, [side * .46, 0, .009], [.008, 1.51, .008]);
      mesh(borderRoot, box, mats.wood, [0, side * .75, .009], [.92, .008, .008]);
      mesh(borderRoot, box, mats.wood, [side * .38, side * .62, .01], [.035, .1, .009]);
    }
    bake(borderRoot);
    const borders = new T.InstancedMesh(borderRoot.children[0].geometry, mats.wood, count); borders.name = 'PROP_Card_Engraving';
    const bases = [];
    for (let i = 0; i < count; i++) {
      const p = i < count * .75 ? .24 + i / (count * .75) * .2 : .83 + (i - count * .75) / (count * .25) * .11;
      const q = new T.Quaternion().setFromUnitVectors(v(0, 0, -1), path.position.getTangent(p));
      const angle = i * 2.39996, radius = p < .5 ? 2 + (i % 5) * .7 : 1.5 + (i % 3) * .4;
      const point = path.position.getPoint(p).add(v(Math.cos(angle) * radius, Math.sin(angle) * radius, 0).applyQuaternion(q));
      bases.push({ point, q, p });
    }
    scene.add(cards, marks, borders);
    function update(progress) {
      for (let i = 0; i < count; i++) {
        const b = bases[i]; dummy.position.copy(b.point); dummy.quaternion.copy(b.q);
        const motion = i % 4 === 0 ? 0 : progress;
        dummy.position.y += Math.sin(motion * 8 + i) * .18 + Math.max(0, progress - .82) * 8;
        dummy.rotateX(Math.sin(motion * 4 + i) * .3); dummy.rotateY(Math.cos(motion * 3 + i) * .4); dummy.rotateZ(i * 1.3 + motion * (i % 2 ? .7 : -.7));
        dummy.scale.setScalar(.8 + i % 4 * .1); dummy.updateMatrix(); cards.setMatrixAt(i, dummy.matrix); marks.setMatrixAt(i, dummy.matrix); borders.setMatrixAt(i, dummy.matrix);
      }
      cards.instanceMatrix.needsUpdate = marks.instanceMatrix.needsUpdate = borders.instanceMatrix.needsUpdate = true;
    }
    // Instances move; conservative bounds avoid stale first-frame culling.
    cards.frustumCulled = marks.frustumCulled = borders.frustumCulled = false;
    update(0); return { update, reduce: () => { count = Math.min(count, 32); cards.count = marks.count = borders.count = count; } };
  }
  const cards = createCardInstanceSet();
  // A broken staircase of thick card slabs, all at physically different depths.
  const bridge = anchor(.35, 'ENV_CardStaircase');
  for (let i = 0; i < 10; i++) {
    const stair = mesh(bridge, box, mats.paper, [(i - 5) * .8, -2.8 + i * .19, -i * .5], [1.2, .045, 1.8]);
    stair.rotation.set(.04 * i, -.15, Math.sin(i) * .08);
  }
  bake(bridge);
  let count = low ? 140 : high ? 500 : 280;
  const particleBase = new Float32Array(count * 3), particleData = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = (i * .61803398875) % 1, [w] = profile(p);
    const pos = path.position.getPoint(p).add(v(Math.sin(i * 3.1) * w * .7, Math.cos(i * 1.7) * 2.5, 0));
    particleBase.set(pos.toArray(), i * 3);
  }
  const dustGeo = new T.BufferGeometry(); dustGeo.setAttribute('position', new T.BufferAttribute(particleData, 3));
  const dust = new T.Points(dustGeo, new T.PointsMaterial({ color: 0xe7e0d2, size: .035, transparent: true, opacity: .5, depthWrite: false })); dust.name = 'FX_Dust'; dust.frustumCulled = false; scene.add(dust);
  function update(p) {
    cards.update(p);
    watch.rotation.z = Math.sin(p * 18) * .24;
    lantern.rotation.z = Math.sin(p * 15) * .055;
    rabbitVisual.position.x = -1.5 + T.MathUtils.smoothstep(p, .015, .115) * 6;
    // The silver surface slides aside as the camera passes through its frame.
    mirrorVisual.userData.surface.position.x = smoothMirror(p) * 4.8;
    mirrorVisual.userData.surface.rotation.y = smoothMirror(p) * 1.2;
    shaftProps.forEach((item, i) => { item.root.position.copy(item.base); item.root.position.y += Math.max(0, p - .82) * 5; item.root.quaternion.copy(item.q); item.root.rotateZ(Math.sin(p * 7 + i) * .16); });
    doors.forEach(door => { door.hinge.rotation.y = T.MathUtils.smoothstep(p, door.p - .1, door.p - .025) * Math.PI * .52; });
    keys.forEach((key, i) => { key.root.position.copy(key.base); key.root.position.y += Math.max(0, p - .82) * 10; key.root.quaternion.copy(key.q); key.root.rotateZ(Math.sin(p * 10 + i) * .3); });
    for (let i = 0; i < count; i++) {
      particleData[i * 3] = particleBase[i * 3] + Math.sin(p * 6 + i) * .12;
      particleData[i * 3 + 1] = particleBase[i * 3 + 1] + p * .5 + Math.max(0, p - .82) * 24;
      particleData[i * 3 + 2] = particleBase[i * 3 + 2];
    }
    dustGeo.attributes.position.needsUpdate = true;
    // Fog isn't a culling mechanism. Cull distant architectural roots explicitly.
    const cameraPosition = path.position.getPoint(p);
    for (const root of scene.children) {
      if (/^(ENV_Arch_|ENV_Niche_|LOC_)/.test(root.name) && root !== portal) root.visible = !root.userData.qualityHidden && root.position.distanceToSquared(cameraPosition) < (low ? 32 * 32 : 44 * 44);
    }
  }
  function smoothMirror(p) { return T.MathUtils.smoothstep(p, .72, .772); }
  return { update, portal, materials: mats, factories: { createRabbitPlaceholder, createKeyholeDoorPlaceholder, createPocketWatchPlaceholder, createCardInstanceSet, createTeapotPlaceholder, createChessPlaceholder, createMushroomsPlaceholder, createLookingGlassPlaceholder, createLanternPlaceholder, createArchPlaceholder }, low: () => { count = Math.min(count, 140); dust.geometry.setDrawRange(0, count); cards.reduce(); shaftProps.forEach((item, i) => { if (i >= 4) item.root.userData.qualityHidden = true; }); } };
}
