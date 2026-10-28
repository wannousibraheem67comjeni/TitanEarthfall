/** Message contracts between the main thread and geo workers. */
import type { WorldTransfer } from '../gis/world';
import type { TerrainNodeData } from '../terrain/buildNode';
import type { CityTileData, CityTileRequest } from '../city/cityGenerator';

export interface LiveDemConfig {
  url: string;
  encoding: 'terrarium' | 'mapbox';
  maxZoom: number;
}

export type WorkerRequest =
  | { type: 'init'; id: number; world: WorldTransfer; liveDem: LiveDemConfig }
  | { type: 'terrain'; id: number; cx: number; cz: number; size: number; segments: number; skirt: number; live: boolean }
  | { type: 'macro'; id: number; r0: number; r1: number }
  | ({ type: 'city'; id: number } & CityTileRequest);

export type WorkerResponse =
  | { type: 'init'; id: number }
  | ({ type: 'terrain'; id: number; live: boolean } & TerrainNodeData)
  | { type: 'macro'; id: number; r0: number; r1: number; data: Uint8Array }
  | ({ type: 'city'; id: number } & CityTileData)
  | { type: 'error'; id: number; message: string };

/** All the ArrayBuffers in a response, for zero-copy transfer. */
export function transferables(res: WorkerResponse): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const v of Object.values(res)) {
    if (ArrayBuffer.isView(v)) out.push(v.buffer as ArrayBuffer);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const w of Object.values(v)) if (ArrayBuffer.isView(w)) out.push(w.buffer as ArrayBuffer);
    }
  }
  return out;
}
