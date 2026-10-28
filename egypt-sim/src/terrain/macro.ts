/**
 * Macro surface texture: fertility / urban light / rock / water on the national
 * lattice (at half resolution, ≈2.2 km per texel). Coarse terrain nodes have
 * vertices tens of km apart, so per-vertex attributes would miss the 10 km-wide
 * green Nile valley and every city's lights; the shader reads this texture instead
 * and blends to the per-vertex data as nodes get finer.
 */
import type { World } from '../gis/world';

export const MACRO_DECIMATION = 2;

export function macroSize(world: World): { width: number; height: number } {
  return {
    width: Math.ceil(world.rasters.width / MACRO_DECIMATION),
    height: Math.ceil(world.rasters.height / MACRO_DECIMATION),
  };
}

/** RGBA8 rows [r0, r1) of the macro texture (row 0 = north). */
export function buildMacroRows(world: World, r0: number, r1: number): Uint8Array {
  const { width } = macroSize(world);
  const out = new Uint8Array((r1 - r0) * width * 4);
  for (let r = r0; r < r1; r++) {
    for (let c = 0; c < width; c++) {
      const { lon, lat } = world.rasters.cell(c * MACRO_DECIMATION, r * MACRO_DECIMATION);
      const [x, z] = world.proj.forward(lon, lat);
      const m = world.terrain.macroAt(lon, lat, x, z);
      const o = ((r - r0) * width + c) * 4;
      out[o] = m.fertility * 255;
      out[o + 1] = m.urban * 255;
      out[o + 2] = m.rock * 255;
      out[o + 3] = m.water * 255;
    }
  }
  return out;
}
