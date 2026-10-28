/** Shared materials, created once and reused by every builder. */
import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial, type Texture } from 'three';
import * as T from './textures';

const cache = new Map<string, MeshStandardMaterial>();

/** A plain coloured material; same colour and roughness → same instance. */
export function solid(color: string, roughness = 0.85, metalness = 0, extra: { emissive?: string; emissiveIntensity?: number } = {}): MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}|${extra.emissive ?? ''}|${extra.emissiveIntensity ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color: new Color(color), roughness, metalness });
    if (extra.emissive) {
      m.emissive = new Color(extra.emissive);
      m.emissiveIntensity = extra.emissiveIntensity ?? 1;
    }
    cache.set(key, m);
  }
  return m;
}

export function textured(key: string, map: Texture, opts: { color?: string; roughness?: number; metalness?: number; emissiveMap?: Texture; emissive?: string; transparent?: boolean; alphaTest?: number; doubleSide?: boolean } = {}): MeshStandardMaterial {
  const k = `tex|${key}|${opts.color ?? ''}`;
  let m = cache.get(k);
  if (!m) {
    m = new MeshStandardMaterial({
      map,
      color: new Color(opts.color ?? '#ffffff'),
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      transparent: opts.transparent ?? false,
      alphaTest: opts.alphaTest ?? 0,
    });
    if (opts.doubleSide) m.side = DoubleSide;
    if (opts.emissiveMap) {
      m.emissiveMap = opts.emissiveMap;
      m.emissive = new Color(opts.emissive ?? '#ffffff');
      m.emissiveIntensity = 0;
    }
    cache.set(k, m);
  }
  return m;
}

/** Materials whose emissive glow follows the day/night cycle (windows, signs, lamps). */
export const nightGlow: { material: MeshStandardMaterial | MeshBasicMaterial; max: number }[] = [];

export function registerNightGlow(material: MeshStandardMaterial, max: number): MeshStandardMaterial {
  nightGlow.push({ material, max });
  return material;
}

export const M = {
  sand: () => textured('sand', T.sandTexture(), { roughness: 1 }),
  road: () => textured('road', T.roadTexture(), { roughness: 0.95 }),
  asphalt: () => textured('asphalt', T.asphaltTexture(), { roughness: 0.95 }),
  paver: () => textured('paver', T.paverTexture(), { roughness: 0.9 }),
  curb: () => textured('curb', T.curbTexture(), { roughness: 0.8 }),
  grass: () => textured('grass', T.grassTexture(), { roughness: 1 }),
  stucco: (color: string) => textured('stucco', T.stuccoTexture(), { color, roughness: 0.95 }),
  roof: () => solid('#cfc6b4', 0.95),
  trim: (color: string) => solid(color, 0.8),
  glassDark: () => solid('#20323f', 0.15, 0.4),
  metal: () => solid('#8d9297', 0.45, 0.6),
  darkMetal: () => solid('#3a3d41', 0.5, 0.5),
  white: () => solid('#f4f4f2', 0.6),
  black: () => solid('#151515', 0.7),
  wood: () => solid('#7a5233', 0.8),
  concrete: () => solid('#b9b3a8', 0.95),
  lampGlow: () => solid('#fff2cf', 0.4, 0, { emissive: '#ffd58a', emissiveIntensity: 0 }),
};
