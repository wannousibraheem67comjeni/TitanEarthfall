import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { GeoProjection, latToTileY, lonToTileX, tileXToLon, tileYToLat } from '../src/gis/projection';
import { DemGrid, decodeMapboxRgb, decodeTerrarium } from '../src/gis/dem';
import { tileUrl } from '../src/gis/imagery';
import { WORLD } from '../src/config';

const proj = new GeoProjection(WORLD.origin, WORLD.earthRadius);

describe('projection', () => {
  it('round-trips lon/lat across Egypt to sub-micrometre precision', () => {
    for (const [lon, lat] of [[24.5, 21.8], [36.9, 31.9], [31.2357, 30.0444], [30.8, 26.8], [45, 40]]) {
      const [x, z] = proj.forward(lon, lat);
      const [lon2, lat2] = proj.inverse(x, z);
      expect(lon2).toBeCloseTo(lon, 10);
      expect(lat2).toBeCloseTo(lat, 10);
    }
  });

  it('is north-up with true metric scale (Transverse Mercator)', () => {
    const [x0, z0] = proj.forward(30.8, 26.8);
    const [, zN] = proj.forward(30.8, 27.8);
    expect(x0).toBeCloseTo(0, 6);
    expect(z0).toBeCloseTo(0, 6);
    expect(z0 - zN).toBeCloseTo(111_195, -2); // 1° of latitude, north is −z
    const [xE] = proj.forward(36.8, 26.8);
    expect(proj.scaleFactor(xE)).toBeLessThan(1.005); // < 0.5 % at Egypt's eastern edge
  });

  it('converts XYZ tile coordinates both ways', () => {
    expect(tileUrl('https://t/{z}/{y}/{x}.png', 12, 2455, 1714)).toBe('https://t/12/1714/2455.png');
    expect(tileXToLon(lonToTileX(31.2, 12), 12)).toBeCloseTo(31.2, 9);
    expect(tileYToLat(latToTileY(30.04, 12), 12)).toBeCloseTo(30.04, 9);
  });
});

describe('DEM decoding', () => {
  it('decodes the EGDEM1 row-delta container', () => {
    const w = 4;
    const h = 3;
    const values = [10, 12, 15, 9, -5, -3, 0, 2, 100, 90, 95, 120];
    const header = Buffer.alloc(56);
    header.write('EGDEM1\0\0', 0, 'latin1');
    header.writeUInt32LE(w, 8);
    header.writeUInt32LE(h, 12);
    [30, 20, 33, 22].forEach((v, i) => header.writeDoubleLE(v, 16 + i * 8));
    const deltas = new Int16Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) deltas[r * w + c] = values[r * w + c] - (c ? values[r * w + c - 1] : 0);
    const raw = zlib.gunzipSync(zlib.gzipSync(Buffer.concat([header, Buffer.from(deltas.buffer)])));
    const dem = DemGrid.decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
    expect(Array.from(dem.data)).toEqual(values);
    // Bilinear and bicubic both interpolate exactly at lattice points.
    expect(dem.sampleBilinear(31, 22)).toBeCloseTo(12);
    expect(dem.sampleBicubic(31, 21)).toBeCloseTo(-3);
  });

  it('decodes Terrarium and Mapbox Terrain-RGB pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBeCloseTo(100.5);
    expect(decodeMapboxRgb(1, 134, 160)).toBeCloseTo(0);
  });
});
