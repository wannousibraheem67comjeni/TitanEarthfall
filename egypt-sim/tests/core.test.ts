import { describe, expect, it } from 'vitest';
import { Rng, hash01, hashString } from '../src/core/rng';
import { createNoise2D, fbm, ridged } from '../src/core/noise';
import { angleDelta, smoothstep } from '../src/core/math';
import { insetPolygon, pointInPoly, polyArea, polyCentroid, splitPolygon, ensureCCW } from '../src/core/geometry2d';
import { RingIndex, SegmentGrid } from '../src/core/spatialIndex';
import { distToSegment } from '../src/core/geometry2d';

describe('rng & hashing', () => {
  it('is deterministic and in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
    expect(hash01(3, 4, 5)).not.toBe(hash01(4, 3, 5));
    expect(hashString('cairo')).not.toBe(hashString('giza'));
  });

  it('weighted picks follow the weights', () => {
    const r = new Rng(7);
    let heavy = 0;
    for (let i = 0; i < 4000; i++) if (r.weighted(['a', 'b'], [9, 1]) === 'a') heavy++;
    expect(heavy / 4000).toBeGreaterThan(0.85);
  });
});

describe('noise', () => {
  it('stays bounded and repeatable', () => {
    const n = createNoise2D(1);
    const m = createNoise2D(1);
    for (let i = 0; i < 2000; i++) {
      const x = i * 0.37;
      const y = i * -0.21;
      const v = n(x, y);
      expect(v).toBe(m(x, y));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(fbm(n, x, y, 5))).toBeLessThanOrEqual(1.0001);
      const r = ridged(n, x, y, 4);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('math', () => {
  it('handles reversed smoothstep edges and angle wrapping', () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(1, 0, 0.25)).toBeCloseTo(smoothstep(0, 1, 0.75));
    expect(angleDelta(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
  });
});

describe('geometry2d', () => {
  const square = [0, 0, 10, 0, 10, 10, 0, 10];

  it('computes area, centroid and orientation', () => {
    expect(polyArea(square)).toBe(100);
    expect(polyCentroid(square)).toEqual([5, 5]);
    expect(polyArea(ensureCCW([0, 10, 10, 10, 10, 0, 0, 0]))).toBe(100);
  });

  it('insets per edge and rejects collapse', () => {
    const inner = insetPolygon(square, 1)!;
    expect(polyArea(inner)).toBeCloseTo(64);
    const uneven = insetPolygon(square, [1, 2, 3, 4])!;
    expect(polyArea(uneven)).toBeCloseTo((10 - 4 - 2) * (10 - 1 - 3));
    expect(insetPolygon(square, 6)).toBeNull();
  });

  it('splits conserving area', () => {
    const [a, b] = splitPolygon(square, 3, 0, 1, 0);
    expect(polyArea(a) + polyArea(b)).toBeCloseTo(100);
    expect(polyArea(b)).toBeCloseTo(30);
    expect(pointInPoly(square, 5, 5)).toBe(true);
    expect(pointInPoly(square, 15, 5)).toBe(false);
  });
});

describe('spatial indices', () => {
  const rng = new Rng(9);
  const segs: number[][] = [];
  for (let i = 0; i < 300; i++) {
    const x = rng.range(0, 100000);
    const y = rng.range(0, 100000);
    segs.push([x, y, x + rng.range(-3000, 3000), y + rng.range(-3000, 3000)]);
  }

  it('SegmentGrid matches brute force within its radius', () => {
    const grid = new SegmentGrid({ minX: -5000, minY: -5000, maxX: 105000, maxY: 105000 }, 4000, 6000);
    for (const s of segs) grid.add(s[0], s[1], s[2], s[3]);
    grid.build();
    const hit = { dist: 0, segment: 0, t: 0 };
    for (let i = 0; i < 500; i++) {
      const x = rng.range(0, 100000);
      const y = rng.range(0, 100000);
      const brute = Math.min(...segs.map((s) => distToSegment(x, y, s[0], s[1], s[2], s[3])));
      const r = grid.nearest(x, y, hit);
      if (brute < 6000) expect(r?.dist).toBeCloseTo(brute, 6);
      else expect(r).toBeNull();
    }
  });

  it('RingIndex agrees with plain point-in-polygon', () => {
    const ring: number[] = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const r = 1000 + 400 * Math.sin(a * 5);
      ring.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    const index = new RingIndex([ring], 97);
    for (let i = 0; i < 2000; i++) {
      const x = rng.range(-1600, 1600);
      const y = rng.range(-1600, 1600);
      expect(index.contains(x, y)).toBe(pointInPoly(ring, x, y));
    }
  });
});
