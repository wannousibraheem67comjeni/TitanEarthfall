/**
 * Outside the glass: the pavement in front of the shop under a striped awning, the
 * kerb, a two-lane road with cars going both ways (white Land Cruisers, saloons,
 * pickups), parked cars, palms and street lamps, and a row of shops and flats across
 * the road whose signs and windows light up at night.
 */
import { BoxGeometry, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, Shape, Vector3 } from 'three';
import { Batcher } from './batch';
import { mat } from './products';
import { asphalt, awningTexture, cached, concrete, facadeGlow, facadeTexture, frondTexture, kerb, pavers, type Surface } from './textures';

export interface Street {
  group: Group;
  update(dt: number, minute: number, night: number, people: Vector3[]): void;
  /** Called when a car passes the door (for the whoosh), with its distance. */
  onPass: ((distance: number) => void) | null;
}

function surf(s: Surface, rough = 0.9): MeshStandardMaterial {
  return cached(`street${s.map.uuid}`, () => {
    const m = new MeshStandardMaterial({ map: s.map, roughness: rough });
    if (s.roughnessMap) m.roughnessMap = s.roughnessMap;
    if (s.normalMap) m.normalMap = s.normalMap;
    return m;
  });
}

/** A flat strip with world-tiled UVs. */
function strip(x0: number, x1: number, z0: number, z1: number, y: number, size: number): PlaneGeometry {
  const g = new PlaneGeometry(x1 - x0, z1 - z0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / size, (uv.getY(i) * (z1 - z0)) / size);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  return g;
}

// ---------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------

type CarKind = 'suv' | 'sedan' | 'pickup';

const PAINT = ['#f4f4f2', '#f4f4f2', '#f4f4f2', '#c9ccd0', '#1c1d20', '#7d8288', '#8a1e22', '#d9cdb4', '#1f3a5f'];

function paint(color: string): MeshPhysicalMaterial {
  return cached(`paint${color}`, () => new MeshPhysicalMaterial({ color: new Color(color), metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
}

const tinted = () => cached('tinted', () => new MeshPhysicalMaterial({ color: '#1a2128', metalness: 0.2, roughness: 0.05, clearcoat: 1 }));

function profile(points: [number, number][]): Shape {
  const s = new Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

function extrude(points: [number, number][], width: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(profile(points), { depth: width, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, steps: 1 });
  g.translate(0, 0, -width / 2);
  return g;
}

export interface Car {
  root: Group;
  lights: { head: MeshStandardMaterial; tail: MeshStandardMaterial };
  length: number;
}

export function makeCar(kind: CarKind, color: string): Car {
  const root = new Group();
  const W = kind === 'sedan' ? 1.8 : 1.95;
  const body = paint(color);
  const shapes: Record<CarKind, { lower: [number, number][]; cabin: [number, number][]; length: number; wheel: number }> = {
    sedan: {
      lower: [
        [-2.38, 0.32],
        [2.38, 0.32],
        [2.44, 0.62],
        [2.25, 0.8],
        [1.0, 0.92],
        [-1.45, 0.95],
        [-2.32, 0.9],
        [-2.44, 0.62],
      ],
      cabin: [
        [0.98, 0.9],
        [0.25, 1.4],
        [-0.95, 1.42],
        [-1.55, 0.93],
      ],
      length: 4.8,
      wheel: 0.33,
    },
    suv: {
      lower: [
        [-2.45, 0.42],
        [2.45, 0.42],
        [2.5, 0.88],
        [2.3, 1.06],
        [1.35, 1.12],
        [-2.42, 1.14],
        [-2.5, 0.75],
      ],
      cabin: [
        [1.33, 1.1],
        [0.72, 1.8],
        [-2.3, 1.84],
        [-2.42, 1.12],
      ],
      length: 4.95,
      wheel: 0.4,
    },
    pickup: {
      lower: [
        [-2.6, 0.45],
        [2.5, 0.45],
        [2.55, 0.9],
        [2.35, 1.06],
        [1.4, 1.1],
        [-2.6, 1.12],
      ],
      cabin: [
        [1.38, 1.08],
        [0.8, 1.75],
        [-0.6, 1.78],
        [-0.75, 1.1],
      ],
      length: 5.2,
      wheel: 0.4,
    },
  };
  const sp = shapes[kind];
  const lower = new Mesh(extrude(sp.lower, W - 0.08), body);
  lower.castShadow = true;
  const cabin = new Mesh(extrude(sp.cabin, W - 0.22), tinted());
  cabin.castShadow = true;
  // Roof skin and pillars in body colour.
  const roofY = Math.max(...sp.cabin.map((p) => p[1]));
  const roofX0 = Math.min(...sp.cabin.filter((p) => p[1] > roofY - 0.1).map((p) => p[0]));
  const roofX1 = Math.max(...sp.cabin.filter((p) => p[1] > roofY - 0.1).map((p) => p[0]));
  const roof = new Mesh(new BoxGeometry(roofX1 - roofX0 + 0.06, 0.05, W - 0.18), body);
  roof.position.set((roofX0 + roofX1) / 2, roofY + 0.03, 0);
  root.add(lower, cabin, roof);
  if (kind === 'pickup') {
    const bed = new Mesh(new BoxGeometry(1.75, 0.08, W - 0.1), mat('#2a2b2e', 0.8));
    bed.position.set(-1.65, 0.75, 0);
    root.add(bed);
  }
  // Wheels.
  const tyre = mat('#141414', 0.85);
  const rim = mat('#c7cbcf', 0.25, 1);
  for (const x of [sp.length / 2 - 0.85, -sp.length / 2 + 0.9])
    for (const z of [-W / 2 + 0.12, W / 2 - 0.12]) {
      const t = new Mesh(new CylinderGeometry(sp.wheel, sp.wheel, 0.24, 20).rotateX(Math.PI / 2), tyre);
      t.position.set(x, sp.wheel, z);
      const r = new Mesh(new CylinderGeometry(sp.wheel * 0.6, sp.wheel * 0.6, 0.25, 12).rotateX(Math.PI / 2), rim);
      r.position.copy(t.position);
      root.add(t, r);
    }
  // Lights.
  const head = new MeshStandardMaterial({ color: '#f4f6f8', emissive: new Color('#fff6dd'), emissiveIntensity: 0.1, roughness: 0.1 });
  const tail = new MeshStandardMaterial({ color: '#7a0d0d', emissive: new Color('#ff1a1a'), emissiveIntensity: 0.2, roughness: 0.2 });
  const front = sp.lower[2];
  for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) {
    const hl = new Mesh(new BoxGeometry(0.06, 0.1, 0.32), head);
    hl.position.set(front[0] + 0.02, front[1] - 0.06, z);
    const tl = new Mesh(new BoxGeometry(0.06, 0.12, 0.26), tail);
    tl.position.set(-sp.length / 2 - 0.02, (kind === 'sedan' ? 0.78 : 0.95) - 0.02, z);
    root.add(hl, tl);
  }
  return { root, lights: { head, tail }, length: sp.length };
}

// ---------------------------------------------------------------------------
// Palms and lamps
// ---------------------------------------------------------------------------

function palm(b: Batcher, group: Group, x: number, z: number, height: number, seed: number): void {
  const trunk = mat('#8b7356', 0.95);
  const segs = 9;
  for (let i = 0; i < segs; i++) {
    const y0 = (i / segs) * height;
    const r = 0.2 - i * 0.008;
    b.place(new CylinderGeometry(r * 0.92, r, height / segs + 0.02, 10), trunk, x + Math.sin(i * 0.3 + seed) * 0.04 * i, y0 + height / segs / 2, z, i * 0.4);
  }
  const frondMat = cached('frondMat', () => new MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: DoubleSide, roughness: 0.7 }));
  const n = 11;
  for (let i = 0; i < n; i++) {
    const g = new PlaneGeometry(2.6, 0.7, 8, 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const u = (pos.getX(k) + 1.3) / 2.6;
      pos.setY(k, pos.getY(k) - u * u * 1.1);
    }
    g.translate(1.3, 0, 0);
    g.rotateX(Math.PI / 2 - 0.3);
    const m = new Mesh(g, frondMat);
    m.position.set(x + Math.sin(segs * 0.3 + seed) * 0.04 * segs, height, z);
    m.rotation.set(0, (i / n) * Math.PI * 2 + seed, 0.35 + (i % 3) * 0.12);
    m.castShadow = true;
    group.add(m);
  }
}

function lamp(b: Batcher, group: Group, x: number, z: number, facing: 1 | -1): { head: MeshStandardMaterial } {
  const pole = mat('#6f7378', 0.4, 0.8);
  b.cylinder(x, 0, z, 0.09, 7.5, pole, 10, 0.06);
  void group;
  b.boxMinMax(x - 0.04, 7.35, Math.min(z, z + facing * 1.6), x + 0.04, 7.45, Math.max(z, z + facing * 1.6), pole, 1, 1);
  const head = new MeshStandardMaterial({ color: '#f0e6d0', emissive: new Color('#ffcf8a'), emissiveIntensity: 0, roughness: 0.3 });
  const m = new Mesh(new BoxGeometry(0.32, 0.12, 0.6), head);
  m.position.set(x, 7.32, z + facing * 1.6);
  group.add(m);
  return { head };
}

// ---------------------------------------------------------------------------

export function buildStreet(fz: number, shopW: number, stage: number, shadows: boolean): Street {
  const group = new Group();
  const b = new Batcher();
  const near = fz; // the shopfront line
  const curbNear = near - 3.6;
  const curbFar = curbNear - 8.4;
  const buildings = curbFar - 3.2;
  const X = 60;

  // Pavements, kerbs, road.
  const pav = surf(pavers(), 0.85);
  const asph = surf(asphalt(), 0.9);
  b.add(strip(-X, X, curbNear, near, 0, pavers().size), pav, undefined, { cast: false });
  b.add(strip(-X, X, buildings, curbFar, 0, pavers().size), pav, undefined, { cast: false });
  b.add(strip(-X, X, curbFar, curbNear, -0.15, asphalt().size), asph, undefined, { cast: false });
  const kerbM = surf(kerb(), 0.7);
  for (const z of [curbNear, curbFar]) {
    const g = new BoxGeometry(2 * X, 0.16, 0.18);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * 2 * X) / kerb().size);
    b.add(g.translate(0, -0.07, z + (z === curbNear ? 0.09 : -0.09)), kerbM, undefined, { cast: false });
  }
  // Lane markings.
  const white = mat('#e9e7e0', 0.6);
  const mid = (curbNear + curbFar) / 2;
  for (let x = -X; x < X; x += 6) b.boxMinMax(x, -0.148, mid - 0.06, x + 3, -0.142, mid + 0.06, white, 1, 1, { cast: false });
  for (const z of [curbNear - 2.3, curbFar + 0.3]) b.boxMinMax(-X, -0.148, z - 0.05, X, -0.142, z + 0.05, mat('#e8c547', 0.6), 1, 1, { cast: false });
  // The neighbours' frontage either side of our glass, and our awning.
  const neighbour = surf(concrete('#e4dccd'), 0.9);
  b.boxMinMax(-X, 0, near - 0.3, -shopW / 2 - 0.15, 5.2, near, neighbour, 3, 3);
  b.boxMinMax(shopW / 2 + 0.15, 0, near - 0.3, X, 5.2, near, neighbour, 3, 3);
  b.boxMinMax(-shopW / 2 - 0.15, 3.2, near - 0.3, shopW / 2 + 0.15, 5.2, near - 0.15, neighbour, 3, 3);
  const awn = new Mesh(new PlaneGeometry(shopW + 0.4, 1.25), cached('awnMat', () => new MeshStandardMaterial({ map: awningTexture(), side: DoubleSide, roughness: 0.8 })));
  awningTexture().repeat.set((shopW + 0.4) / 1.2, 1);
  awn.position.set(0, 2.22, near - 0.6);
  awn.rotation.x = -Math.PI / 2 + 0.36;
  awn.castShadow = true;
  group.add(awn);
  // A bench and a bin on our pavement.
  b.boxMinMax(shopW / 2 + 0.6, 0.45, near - 1.2, shopW / 2 + 2.2, 0.5, near - 0.8, mat('#7a5a3c', 0.8), 1, 1);
  for (const dx of [0.7, 2.1]) b.boxMinMax(shopW / 2 + dx - 0.04, 0.15, near - 1.15, shopW / 2 + dx + 0.04, 0.45, near - 0.85, mat('#3a3d40', 0.5, 0.6), 1, 1);
  b.cylinder(-shopW / 2 - 1.2, 0.15, near - 1.0, 0.22, 0.85, mat('#2e6b3a', 0.6, 0.2), 14);

  // Buildings across the road.
  const glowMats: MeshStandardMaterial[] = [];
  let x = -X;
  let i = 0;
  while (x < X) {
    const wdt = 10 + ((i * 7) % 5);
    const hgt = 7 + (i % 3) * 1.2;
    const tex = facadeTexture(i % 6);
    const front = new MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: new Color('#ffffff'), emissiveMap: facadeGlow(i % 6), emissiveIntensity: 0 });
    glowMats.push(front);
    const side = mat('#d8ccb6', 0.9);
    const box = new Mesh(new BoxGeometry(wdt, hgt, 6), [side, side, mat('#cbbfa8', 0.95), side, front, side]);
    box.position.set(x + wdt / 2, hgt / 2, buildings - 3);
    box.receiveShadow = true;
    box.castShadow = shadows;
    group.add(box);
    // Parapet.
    b.boxMinMax(x, hgt, buildings - 0.25, x + wdt, hgt + 0.5, buildings, mat('#efe7da', 0.85), 1, 1);
    x += wdt + (i % 4 === 2 ? 3 : 0);
    i++;
  }

  // Palms and lamps.
  for (const px of [-14, -5.5, 6.5, 15]) if (Math.abs(px) > shopW / 2 + 0.8) palm(b, group, px, curbNear + 0.8, 5.5 + (Math.abs(px) % 3), px);
  for (const px of [-18, -6, 6, 18]) palm(b, group, px + 3, curbFar - 1.2, 6 + (Math.abs(px) % 2), px * 1.7);
  const lamps = [lamp(b, group, -9.5, curbNear + 0.3, -1), lamp(b, group, 9.5, curbNear + 0.3, -1), lamp(b, group, -20, curbFar - 0.3, 1), lamp(b, group, 0, curbFar - 0.3, 1), lamp(b, group, 20, curbFar - 0.3, 1)];
  // One sodium lamp's glow on the road in front of the shop at night.
  const lampLight = new PointLight('#ffb866', 0, 18, 1.5);
  lampLight.position.set(5, 6.5, curbNear - 2);
  group.add(lampLight);

  // Parked cars along our kerb (fewer in the morning).
  const parked: Group[] = [];
  const kinds: CarKind[] = ['suv', 'sedan', 'pickup'];
  for (const [px, k] of [
    [-11, 0],
    [-4.8 - shopW / 4, 1],
    [8.5, 0],
    [16, 2],
  ] as [number, number][]) {
    const car = makeCar(kinds[k], PAINT[(Math.abs(px) * 3) % PAINT.length]);
    car.root.position.set(px, -0.15, curbNear - 1.15);
    car.root.rotation.y = px > 0 ? 0 : Math.PI;
    group.add(car.root);
    parked.push(car.root);
  }
  void stage;

  // Traffic.
  interface Moving {
    car: Car;
    dir: 1 | -1;
    speed: number;
    passed: boolean;
  }
  const moving: Moving[] = [];
  let next = 2;
  let n = 0;
  let lastNight = -1;
  const street: Street = {
    group,
    onPass: null,
    update(dt, minute, night) {
      // Outside, the sky is most of the light: dim reflections and fill after sunset.
      if (Math.abs(night - lastNight) > 0.02) {
        lastNight = night;
        group.traverse((o) => {
          const m = (o as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
          for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
            if (!('envMapIntensity' in mm)) continue;
            mm.envMapIntensity = 1 - night * 0.9;
            // Textured outdoor surfaces (paving, road, walls) lose their daylight.
            if (mm.map) {
              const base = (mm.userData.dayColor ??= mm.color.clone()) as Color;
              mm.color.copy(base).multiplyScalar(1 - night * 0.72);
            }
          }
        });
      }
      lampLight.intensity = night * 40;
      for (const l of lamps) l.head.emissiveIntensity = night * 4;
      for (const g of glowMats) g.emissiveIntensity = night * 0.9;
      next -= dt;
      const hour = minute / 60;
      const busy = hour < 7 ? 0.3 : hour < 9 ? 1.3 : hour < 13 ? 0.8 : hour < 16 ? 0.6 : hour < 21 ? 1.2 : 0.7;
      if (next <= 0 && moving.length < 6) {
        next = (5 + Math.random() * 12) / busy;
        const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
        const car = makeCar(kinds[n % 3 === 2 ? 2 : Math.random() < 0.55 ? 0 : 1], PAINT[Math.floor(Math.random() * PAINT.length)]);
        n++;
        car.root.position.set(-dir * 55, -0.15, dir > 0 ? curbNear - 3.4 : curbFar + 2.4);
        car.root.rotation.y = dir > 0 ? 0 : Math.PI;
        group.add(car.root);
        moving.push({ car, dir, speed: 9 + Math.random() * 6, passed: false });
      }
      for (const m of [...moving]) {
        m.car.root.position.x += m.dir * m.speed * dt;
        m.car.lights.head.emissiveIntensity = 0.1 + night * 6;
        m.car.lights.tail.emissiveIntensity = 0.2 + night * 3;
        if (!m.passed && Math.sign(m.car.root.position.x) === m.dir) {
          m.passed = true;
          street.onPass?.(Math.abs(m.car.root.position.z - near));
        }
        if (Math.abs(m.car.root.position.x) > 56) {
          m.car.root.removeFromParent();
          moving.splice(moving.indexOf(m), 1);
        }
      }
    },
  };
  group.add(b.build());
  return street;
}
