/// <reference lib="webworker" />
/**
 * Geo worker: rebuilds the world model from transferred buffers, then serves terrain
 * node meshes, macro-texture rows and city tiles. Everything here is deterministic,
 * so any worker can build any job.
 */
import { fromTransfer, type World } from '../gis/world';
import { buildTerrainNode } from '../terrain/buildNode';
import { buildMacroRows } from '../terrain/macro';
import { CityGenerator } from '../city/cityGenerator';
import { LiveDemProvider } from '../gis/liveDem';
import { transferables, type WorkerRequest, type WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let world: World | null = null;
let cities: CityGenerator | null = null;
let liveDem: LiveDemProvider | null = null;

const reply = (res: WorkerResponse) => self.postMessage(res, transferables(res));

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case 'init': {
        world = fromTransfer(req.world);
        cities = new CityGenerator(world);
        liveDem = new LiveDemProvider(req.liveDem.url, req.liveDem.encoding, req.liveDem.maxZoom);
        reply({ type: 'init', id: req.id });
        break;
      }
      case 'terrain': {
        const w = need(world);
        let elevation = null;
        if (req.live && liveDem) {
          const h = req.size / 2;
          const [w0, s0] = w.proj.inverse(req.cx - h, req.cz + h);
          const [e0, n0] = w.proj.inverse(req.cx + h, req.cz - h);
          const [w1] = w.proj.inverse(req.cx - h, req.cz - h);
          const [e1] = w.proj.inverse(req.cx + h, req.cz + h);
          elevation = await liveDem.sampler([Math.min(w0, w1), s0, Math.max(e0, e1), n0], req.size / req.segments);
        }
        const data = buildTerrainNode(w.terrain, req.cx, req.cz, req.size, req.segments, req.skirt, elevation);
        reply({ type: 'terrain', id: req.id, live: !!elevation, ...data });
        break;
      }
      case 'macro': {
        reply({ type: 'macro', id: req.id, r0: req.r0, r1: req.r1, data: buildMacroRows(need(world), req.r0, req.r1) });
        break;
      }
      case 'city': {
        const { id, type: _t, ...tile } = req;
        reply({ type: 'city', id, ...need(cities).generate(tile) });
        break;
      }
    }
  } catch (err) {
    reply({ type: 'error', id: req.id, message: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
};

function need<T>(v: T | null): T {
  if (!v) throw new Error('geo worker used before init');
  return v;
}
