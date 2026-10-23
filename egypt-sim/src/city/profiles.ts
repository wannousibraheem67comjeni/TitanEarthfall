/**
 * Urban archetypes. Each profile is a parameter set for the same generator, which is
 * what lets one algorithm produce Islamic Cairo's warped alleys, the New Capital's
 * superblocks, Alexandria's Corniche strip and Hurghada's resort compounds.
 */
import type { CityProfileId } from '../data/schema';

export type LotLayout = 'subdivide' | 'perimeter' | 'towers' | 'resort';

/** Facade shader styles (must match buildingMaterial.ts). */
export const Facade = {
  /** Exposed concrete frame with red-brick infill — the unfinished-looking norm of Egyptian towns. */
  BrickFrame: 0,
  Plaster: 1,
  Glass: 2,
  Stone: 3,
  Resort: 4,
  /** Pools and fountains: shaded as water. */
  Water: 5,
} as const;
export type Facade = (typeof Facade)[keyof typeof Facade];

export type Rgb = [number, number, number];

export interface CityProfile {
  id: CityProfileId;
  label: string;
  /** Grid cell size along / across the grid axis (m). */
  block: [number, number];
  street: number;
  avenue: number;
  /** Every Nth grid line is an avenue. */
  avenueEvery: number;
  /** Corner displacement amplitude (m) and wavelength (m): 0 = planned grid, high = organic medina. */
  warp: number;
  warpScale: number;
  /** Probability that a 2×2 superblock merges into larger blocks. */
  merge: number;
  layout: LotLayout;
  lotArea: number;
  setback: number;
  /** Probability a lot stays open (courtyard, vacant plot, small square). */
  openLot: number;
  floors: [number, number];
  floorHeight: number;
  facades: { facade: Facade; weight: number; colors: Rgb[] }[];
  roofColor: Rgb;
  /** Terrain urban tint and night-light intensity. */
  density: number;
  lights: number;
  /** Fraction of windows lit in the evening. */
  windowsLit: number;
  /** Per-block probabilities of a mosque, a park, palms along streets, roof clutter, pools. */
  mosques: number;
  parks: number;
  palms: number;
  rooftop: number;
  pools: number;
}

const BRICK: Rgb[] = [[0.58, 0.33, 0.24], [0.62, 0.38, 0.27], [0.52, 0.3, 0.22], [0.66, 0.44, 0.32]];
const SAND_PLASTER: Rgb[] = [[0.82, 0.74, 0.6], [0.76, 0.68, 0.55], [0.86, 0.8, 0.68], [0.72, 0.62, 0.48]];
const CREAM: Rgb[] = [[0.92, 0.89, 0.82], [0.88, 0.84, 0.74], [0.94, 0.92, 0.88], [0.85, 0.82, 0.72]];
const STONE: Rgb[] = [[0.74, 0.62, 0.46], [0.68, 0.57, 0.42], [0.8, 0.69, 0.52]];
const GLASS: Rgb[] = [[0.42, 0.55, 0.62], [0.5, 0.58, 0.6], [0.36, 0.46, 0.55]];
const RESORT: Rgb[] = [[0.96, 0.95, 0.9], [0.93, 0.86, 0.74], [0.85, 0.62, 0.45]];

export const PROFILES: Record<CityProfileId, CityProfile> = {
  megacity: {
    id: 'megacity', label: 'Dense metropolis',
    block: [110, 75], street: 10, avenue: 26, avenueEvery: 5, warp: 10, warpScale: 420, merge: 0.25,
    layout: 'subdivide', lotArea: 380, setback: 0.5, openLot: 0.05, floors: [5, 14], floorHeight: 3.1,
    facades: [{ facade: Facade.BrickFrame, weight: 0.6, colors: BRICK }, { facade: Facade.Plaster, weight: 0.4, colors: SAND_PLASTER }],
    roofColor: [0.55, 0.52, 0.48], density: 0.95, lights: 1.0, windowsLit: 0.45,
    mosques: 0.05, parks: 0.03, palms: 0.1, rooftop: 0.6, pools: 0,
  },
  historic: {
    id: 'historic', label: 'Historic medina',
    block: [75, 60], street: 5, avenue: 10, avenueEvery: 6, warp: 24, warpScale: 220, merge: 0.55,
    layout: 'subdivide', lotArea: 170, setback: 0, openLot: 0.12, floors: [2, 5], floorHeight: 3.4,
    facades: [{ facade: Facade.Stone, weight: 0.55, colors: STONE }, { facade: Facade.Plaster, weight: 0.45, colors: SAND_PLASTER }],
    roofColor: [0.66, 0.58, 0.46], density: 1.0, lights: 0.8, windowsLit: 0.35,
    mosques: 0.18, parks: 0, palms: 0.05, rooftop: 0.3, pools: 0,
  },
  modern: {
    id: 'modern', label: 'Planned new city',
    block: [190, 140], street: 20, avenue: 44, avenueEvery: 3, warp: 0, warpScale: 1000, merge: 0.15,
    layout: 'perimeter', lotArea: 900, setback: 8, openLot: 0, floors: [4, 12], floorHeight: 3.3,
    facades: [{ facade: Facade.Plaster, weight: 0.8, colors: CREAM }, { facade: Facade.Glass, weight: 0.2, colors: GLASS }],
    roofColor: [0.7, 0.68, 0.64], density: 0.7, lights: 0.9, windowsLit: 0.4,
    mosques: 0.02, parks: 0.12, palms: 0.6, rooftop: 0.1, pools: 0.03,
  },
  cbd: {
    id: 'cbd', label: 'Business district',
    block: [160, 120], street: 24, avenue: 50, avenueEvery: 2, warp: 0, warpScale: 1000, merge: 0,
    layout: 'towers', lotArea: 2500, setback: 12, openLot: 0, floors: [18, 70], floorHeight: 3.8,
    facades: [{ facade: Facade.Glass, weight: 0.8, colors: GLASS }, { facade: Facade.Plaster, weight: 0.2, colors: CREAM }],
    roofColor: [0.5, 0.52, 0.55], density: 0.9, lights: 1.3, windowsLit: 0.55,
    mosques: 0, parks: 0.15, palms: 0.6, rooftop: 0, pools: 0,
  },
  coastal: {
    id: 'coastal', label: 'Mediterranean port city',
    block: [95, 65], street: 11, avenue: 28, avenueEvery: 5, warp: 5, warpScale: 500, merge: 0.2,
    layout: 'subdivide', lotArea: 420, setback: 0.5, openLot: 0.05, floors: [6, 14], floorHeight: 3.2,
    facades: [{ facade: Facade.Plaster, weight: 0.8, colors: CREAM }, { facade: Facade.BrickFrame, weight: 0.2, colors: BRICK }],
    roofColor: [0.62, 0.6, 0.56], density: 0.9, lights: 1.0, windowsLit: 0.45,
    mosques: 0.04, parks: 0.04, palms: 0.2, rooftop: 0.5, pools: 0,
  },
  resort: {
    id: 'resort', label: 'Red Sea resort',
    block: [170, 130], street: 12, avenue: 26, avenueEvery: 4, warp: 6, warpScale: 600, merge: 0.3,
    layout: 'resort', lotArea: 1500, setback: 10, openLot: 0.1, floors: [2, 4], floorHeight: 3.2,
    facades: [{ facade: Facade.Resort, weight: 1, colors: RESORT }],
    roofColor: [0.8, 0.55, 0.42], density: 0.45, lights: 0.8, windowsLit: 0.5,
    mosques: 0.01, parks: 0.05, palms: 1.0, rooftop: 0, pools: 1.0,
  },
  provincial: {
    id: 'provincial', label: 'Nile Valley town',
    block: [80, 60], street: 8, avenue: 18, avenueEvery: 6, warp: 14, warpScale: 300, merge: 0.35,
    layout: 'subdivide', lotArea: 240, setback: 0.3, openLot: 0.08, floors: [3, 8], floorHeight: 3.0,
    facades: [{ facade: Facade.BrickFrame, weight: 0.75, colors: BRICK }, { facade: Facade.Plaster, weight: 0.25, colors: SAND_PLASTER }],
    roofColor: [0.56, 0.5, 0.44], density: 0.85, lights: 0.8, windowsLit: 0.35,
    mosques: 0.08, parks: 0.02, palms: 0.25, rooftop: 0.7, pools: 0,
  },
};
