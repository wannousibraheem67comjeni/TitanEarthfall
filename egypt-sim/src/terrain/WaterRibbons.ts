/**
 * Rivers and canals as vector water ribbons at their true width and water level.
 *
 * Terrain vertices can only resolve a channel when they are closer together than its
 * width (≈300 m for the Suez Canal), so mid-range LODs would show the Nile branches
 * and canals as zig-zags or not at all. Instead the terrain only carves the channel
 * and these ribbons, built from the same polylines the terrain samples, draw the water
 * — crisp at every distance, and identical to the carved banks up close.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import type { World } from '../gis/world';
import { injectAtmosphere } from '../environment/atmosphere';

const MAX_CHUNK_VERTICES = 48;
/** Water surface lift above the carved bed's nominal level (m). */
const LIFT = 0.15;

export class WaterRibbons {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;

  constructor(world: World, skyReflect: { value: Color }) {
    this.group.name = 'rivers';
    this.material = new MeshStandardMaterial({
      color: new Color(0.07, 0.17, 0.19), roughness: 0.08, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.material.onBeforeCompile = (shader) => {
      injectAtmosphere(shader);
      shader.uniforms.uSkyReflect = skyReflect;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSkyReflect;
float rHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rHash(i), rHash(i + vec2(1, 0)), u.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), u.x), u.y); }
vec3 rWave = vec3(0.0, 1.0, 0.0);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 q = vApWorld.xz * 0.09;
  float a = rNoise(q + vec2(uTime * 0.4, uTime * 0.15));
  float b = rNoise(q * 2.6 - vec2(uTime * 0.55, -uTime * 0.25));
  float amp = 0.2 * (1.0 - smoothstep(150.0, 3000.0, length(vApWorld - cameraPosition))) + 0.03;
  rWave = normalize(vec3((a - 0.5) + (b - 0.5) * 0.6, 3.0 / amp, (b - 0.5) + (a - 0.5) * 0.5));
  normal = normalize((viewMatrix * vec4(rWave, 0.0)).xyz);
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 V = normalize(cameraPosition - vApWorld);
  totalEmissiveRadiance += uSkyReflect * (pow(1.0 - max(dot(V, rWave), 0.0), 5.0) * 0.95 + 0.03);
}`);
    };
    this.material.customProgramCacheKey = () => 'egypt-river-v1';

    for (const river of world.gis.rivers) {
      const pts: [number, number, number, boolean][] = [];
      for (let i = 0; i < river.points.length; i += 2) {
        const [x, z] = world.proj.forward(river.points[i], river.points[i + 1]);
        pts.push([x, z, river.surface[i / 2] + LIFT, world.water.inStandingWater(x, z)]);
      }
      // Split into runs that are not inside lakes or the sea (the terrain draws those),
      // keeping one vertex of overlap so the ribbon meets the shoreline.
      const runs: [number, number, number][][] = [];
      let run: [number, number, number][] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x, z, y, standing] = pts[i];
        const prevStanding = i > 0 && pts[i - 1][3];
        if (standing && prevStanding) {
          if (run.length > 1) runs.push(run);
          run = [];
          continue;
        }
        run.push([x, z, y]);
      }
      if (run.length > 1) runs.push(run);
      for (const r of runs) {
        for (let start = 0; start < r.length - 1; start += MAX_CHUNK_VERTICES - 1) {
          const chunk = r.slice(start, Math.min(r.length, start + MAX_CHUNK_VERTICES));
          // Neighbours outside the chunk keep miters continuous across chunk seams.
          const prev = start > 0 ? r[start - 1] : null;
          const next = start + chunk.length < r.length ? r[start + chunk.length] : null;
          this.group.add(this.ribbon(chunk, prev, next, river.width / 2, river.id));
        }
      }
    }
  }

  private ribbon(pts: [number, number, number][], prev: [number, number, number] | null, next: [number, number, number] | null, half: number, name: string): Mesh {
    const [ox, oz] = pts[0];
    const n = pts.length;
    const pos = new Float32Array(n * 2 * 3);
    const nrm = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? pts[i - 1] : prev ?? pts[i];
      const b = i < n - 1 ? pts[i + 1] : next ?? pts[i];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // Miter: widen at bends by 1/cos(half-angle), capped to avoid spikes.
      let miter = 1;
      if (i > 0 && i < n - 1) {
        const s1 = Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) || 1;
        const cos = ((pts[i][0] - a[0]) / s1) * dx + ((pts[i][1] - a[1]) / s1) * dz;
        miter = Math.min(2, 1 / Math.max(0.5, cos));
      }
      const nx = -dz * half * miter;
      const nz = dx * half * miter;
      const [x, z, y] = pts[i];
      pos.set([x - ox + nx, y, z - oz + nz, x - ox - nx, y, z - oz - nz], i * 6);
      nrm.set([0, 1, 0, 0, 1, 0], i * 6);
      if (i > 0) {
        const l0 = (i - 1) * 2;
        const l1 = i * 2;
        // Left side (+n) to right side (−n), CCW seen from above for either flow direction is not
        // guaranteed, so emit both windings (cheap: rivers are a few thousand quads in total).
        idx.push(l0, l1, l0 + 1, l1, l1 + 1, l0 + 1, l0, l0 + 1, l1, l1, l0 + 1, l1 + 1);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nrm, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new Mesh(g, this.material);
    m.position.set(ox, 0, oz);
    m.receiveShadow = true;
    m.name = `river-${name}`;
    m.renderOrder = 2;
    return m;
  }
}
