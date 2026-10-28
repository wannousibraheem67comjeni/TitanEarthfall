import { describe, expect, it } from 'vitest';
import { buildOverpassQuery, buildingHeight, joinRings, parseLength, parseOverpass } from '../src/gis/osm';

describe('Overpass / OpenStreetMap', () => {
  it('builds a bbox query in Overpass (south, west, north, east) order', () => {
    const q = buildOverpassQuery([31.23, 30.03, 31.27, 30.06], { water: false });
    expect(q).toContain('[out:json]');
    expect(q).toContain('(30.030000,31.230000,30.060000,31.270000)');
    expect(q).toContain('way["building"]');
    expect(q).not.toContain('natural');
    expect(q).toContain('out body geom qt;');
  });

  it('parses lengths with units', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12,5 m')).toBe(12.5);
    expect(parseLength('40 ft')).toBeCloseTo(12.19, 2);
    expect(parseLength('tall')).toBeNull();
  });

  it('joins split multipolygon members into closed rings', () => {
    const rings = joinRings([[0, 0, 1, 0, 1, 1], [0, 1, 1, 1], [0, 1, 0, 0]]);
    expect(rings).toHaveLength(1);
    expect(rings[0].length / 2).toBe(4);
  });

  it('parses buildings, multipolygons and roads from an Overpass response', () => {
    const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lon, lat }));
    const json = {
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes', 'building:levels': '5' }, geometry: g([[31.2, 30.0], [31.201, 30.0], [31.201, 30.001], [31.2, 30.0]]) },
        { type: 'way', id: 2, tags: { highway: 'primary', name: 'Corniche' }, geometry: g([[31.2, 30.0], [31.21, 30.01]]) },
        {
          type: 'relation', id: 3, tags: { type: 'multipolygon', building: 'mosque', height: '30' },
          members: [
            { type: 'way', role: 'outer', geometry: g([[31.3, 30.0], [31.301, 30.0], [31.301, 30.001]]) },
            { type: 'way', role: 'outer', geometry: g([[31.301, 30.001], [31.3, 30.001], [31.3, 30.0]]) },
          ],
        },
      ],
    } as Parameters<typeof parseOverpass>[0];
    const ex = parseOverpass(json, [31.1, 29.9, 31.4, 30.1]);
    expect(ex.buildings).toHaveLength(2);
    expect(ex.buildings[0].ring.length / 2).toBe(3);
    expect(buildingHeight(ex.buildings[0], 3, 9)).toBe(16);
    expect(buildingHeight(ex.buildings[1], 3, 9)).toBe(30);
    expect(ex.roads[0].width).toBe(16);
  });
});
