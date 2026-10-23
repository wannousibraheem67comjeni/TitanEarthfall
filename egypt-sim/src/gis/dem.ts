/**
 * Baked national DEM (≈1.1 km, from SRTM/GMTED via tools/bake-gis.mjs) plus
 * decoders for the live elevation tile encodings used by the streaming path.
 */

const MAGIC = 'EGDEM1';
const HEADER_BYTES = 56;

export class DemGrid {
  readonly stepLon: number;
  readonly stepLat: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly west: number,
    readonly south: number,
    readonly east: number,
    readonly north: number,
    /** Row-major metres, north row first. */
    readonly data: Int16Array,
  ) {
    this.stepLon = (east - west) / (width - 1);
    this.stepLat = (north - south) / (height - 1);
  }

  /** Decodes the (already decompressed) EGDEM1 container written by the bake tool. */
  static decode(bytes: ArrayBuffer): DemGrid {
    const view = new DataView(bytes);
    const magic = String.fromCharCode(...new Uint8Array(bytes, 0, 6));
    if (magic !== MAGIC) throw new Error(`Not an ${MAGIC} file`);
    const width = view.getUint32(8, true);
    const height = view.getUint32(12, true);
    const west = view.getFloat64(16, true);
    const south = view.getFloat64(24, true);
    const east = view.getFloat64(32, true);
    const north = view.getFloat64(40, true);
    const deltas = new Int16Array(bytes.slice(HEADER_BYTES, HEADER_BYTES + width * height * 2));
    // Undo the per-row delta encoding in place.
    for (let r = 0; r < height; r++) {
      let acc = 0;
      const o = r * width;
      for (let c = 0; c < width; c++) {
        acc += deltas[o + c];
        deltas[o + c] = acc;
      }
    }
    return new DemGrid(width, height, west, south, east, north, deltas);
  }

  /** Fractional column / row of a lon/lat (clamped to the grid). */
  col(lon: number): number {
    const c = (lon - this.west) / this.stepLon;
    return c < 0 ? 0 : c > this.width - 1 ? this.width - 1 : c;
  }

  row(lat: number): number {
    const r = (this.north - lat) / this.stepLat;
    return r < 0 ? 0 : r > this.height - 1 ? this.height - 1 : r;
  }

  at(c: number, r: number): number {
    c = c < 0 ? 0 : c >= this.width ? this.width - 1 : c;
    r = r < 0 ? 0 : r >= this.height ? this.height - 1 : r;
    return this.data[r * this.width + c];
  }

  sampleBilinear(lon: number, lat: number): number {
    const fx = this.col(lon);
    const fy = this.row(lat);
    const ix = Math.min(this.width - 2, Math.floor(fx));
    const iy = Math.min(this.height - 2, Math.floor(fy));
    const tx = fx - ix;
    const ty = fy - iy;
    const d = this.data;
    const o = iy * this.width + ix;
    const top = d[o] + (d[o + 1] - d[o]) * tx;
    const bot = d[o + this.width] + (d[o + this.width + 1] - d[o + this.width]) * tx;
    return top + (bot - top) * ty;
  }

  /**
   * Catmull-Rom bicubic sample: C1-continuous, so close-up terrain built from the
   * 1 km grid has no visible facets at grid lines.
   */
  sampleBicubic(lon: number, lat: number): number {
    const fx = this.col(lon);
    const fy = this.row(lat);
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    let result = 0;
    for (let j = -1; j <= 2; j++) {
      const wy = catmullRom(j, ty);
      if (wy === 0) continue;
      const row =
        this.at(ix - 1, iy + j) * catmullRom(-1, tx) +
        this.at(ix, iy + j) * catmullRom(0, tx) +
        this.at(ix + 1, iy + j) * catmullRom(1, tx) +
        this.at(ix + 2, iy + j) * catmullRom(2, tx);
      result += row * wy;
    }
    return result;
  }
}

/** Catmull-Rom weight of tap `i` (−1..2) at fractional offset t. */
function catmullRom(i: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  switch (i) {
    case -1:
      return (-t3 + 2 * t2 - t) / 2;
    case 0:
      return (3 * t3 - 5 * t2 + 2) / 2;
    case 1:
      return (-3 * t3 + 4 * t2 + t) / 2;
    default:
      return (t3 - t2) / 2;
  }
}

/** Gunzips if the payload starts with the gzip magic (servers may already have inflated it). */
export async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function loadDem(url: string): Promise<DemGrid> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DEM ${url}: HTTP ${res.status}`);
  return DemGrid.decode(await maybeGunzip(await res.arrayBuffer()));
}

/** Mapzen/AWS Terrarium: h = R·256 + G + B/256 − 32768. */
export const decodeTerrarium = (r: number, g: number, b: number): number => r * 256 + g + b / 256 - 32768;

/** Mapbox Terrain-RGB / rio-rgbify: h = −10000 + (R·65536 + G·256 + B)·0.1. */
export const decodeMapboxRgb = (r: number, g: number, b: number): number => -10000 + (r * 65536 + g * 256 + b) * 0.1;
