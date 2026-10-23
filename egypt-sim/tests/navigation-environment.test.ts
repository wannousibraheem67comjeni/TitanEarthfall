import { describe, expect, it } from 'vitest';
import { flightDuration, zoomPanPath } from '../src/navigation/flightPath';
import { egyptUtcOffset, egyptLocalHours, fromEgyptLocal, sunPosition } from '../src/environment/solar';
import { airMass } from '../src/environment/atmosphere';

const DEG = 180 / Math.PI;

describe('van Wijk–Nuij zoom-and-pan path', () => {
  it('starts and ends exactly at the requested views', () => {
    const a = { x: 0, z: 0, w: 1_500_000 };
    const b = { x: 120_000, z: -340_000, w: 300 };
    const p = zoomPanPath(a, b);
    const s0 = p.at(0);
    const s1 = p.at(p.S);
    expect(s0.x).toBeCloseTo(a.x, 3);
    expect(s0.w).toBeCloseTo(a.w, 3);
    expect(s1.x).toBeCloseTo(b.x, 3);
    expect(s1.z).toBeCloseTo(b.z, 3);
    expect(s1.w).toBeCloseTo(b.w, 3);
    expect(flightDuration(p.S)).toBeGreaterThan(1);
    expect(flightDuration(p.S)).toBeLessThanOrEqual(9);
  });

  it('zooms out mid-flight on long hops between two close-ups', () => {
    const p = zoomPanPath({ x: 0, z: 0, w: 500 }, { x: 600_000, z: 0, w: 500 });
    expect(p.at(p.S / 2).w).toBeGreaterThan(50_000);
  });

  it('handles a pure zoom without panning', () => {
    const p = zoomPanPath({ x: 5, z: 5, w: 1000 }, { x: 5, z: 5, w: 10 });
    expect(p.at(p.S).w).toBeCloseTo(10, 6);
    expect(p.at(p.S / 2).x).toBe(5);
  });
});

describe('solar position (NOAA)', () => {
  it('matches known sun elevations over Cairo', () => {
    // Solar noon at Cairo (31.24°E) ≈ 09:55 UTC; declination ±23.44°.
    const june = sunPosition(new Date(Date.UTC(2026, 5, 21, 9, 55)), 30.04, 31.24);
    expect(june.elevation * DEG).toBeCloseTo(90 - 30.04 + 23.44, 0);
    const dec = sunPosition(new Date(Date.UTC(2026, 11, 21, 9, 50)), 30.04, 31.24);
    expect(dec.elevation * DEG).toBeCloseTo(90 - 30.04 - 23.44, 0);
    const morning = sunPosition(new Date(Date.UTC(2026, 2, 20, 5, 0)), 30.04, 31.24);
    expect(morning.azimuth * DEG).toBeGreaterThan(80);
    expect(morning.azimuth * DEG).toBeLessThan(100); // equinox sunrise ≈ due east
  });

  it("applies Egypt's daylight-saving rule (last Fri of April → last Thu of October)", () => {
    expect(egyptUtcOffset(new Date(Date.UTC(2026, 0, 15)))).toBe(2);
    expect(egyptUtcOffset(new Date(Date.UTC(2026, 6, 15)))).toBe(3);
    // 2026: DST starts Fri 24 April 00:00 local, ends after Thu 29 October.
    expect(egyptUtcOffset(new Date(Date.UTC(2026, 3, 23, 21, 59)))).toBe(2);
    expect(egyptUtcOffset(new Date(Date.UTC(2026, 3, 23, 22, 1)))).toBe(3);
    expect(egyptUtcOffset(new Date(Date.UTC(2026, 9, 29, 20, 59)))).toBe(3);
    expect(egyptUtcOffset(new Date(Date.UTC(2026, 9, 29, 21, 1)))).toBe(2);
  });

  it('converts local Cairo time both ways', () => {
    const t = fromEgyptLocal(2026, 6, 1, 15.5);
    expect(egyptLocalHours(t)).toBeCloseTo(15.5, 6);
    expect(t.getUTCHours()).toBe(12);
  });

  it('computes air mass from the zenith to the horizon', () => {
    expect(airMass(0)).toBeCloseTo(1, 2);
    expect(airMass(Math.PI / 3)).toBeCloseTo(2, 1);
    expect(airMass(Math.PI / 2)).toBeGreaterThan(30);
  });
});
