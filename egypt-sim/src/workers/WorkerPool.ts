/**
 * Main-thread pool of geo workers. Callers ask for capacity each frame and submit
 * their most urgent jobs first, so prioritisation stays with the LOD managers (which
 * know the camera) and the pool never builds a backlog of stale requests.
 */
import type { WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; worker: number };
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type Job = DistributiveOmit<WorkerRequest, 'id'>;

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly load: number[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(
    count: number,
    private readonly perWorker = 3,
  ) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./geo.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      w.onerror = (e) => console.error('geo worker error', e.message);
      this.workers.push(w);
      this.load.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Free job slots right now. */
  get capacity(): number {
    return this.load.reduce((acc, l) => acc + Math.max(0, this.perWorker - l), 0);
  }

  get inFlight(): number {
    return this.pending.size;
  }

  /** Sends a message to every worker (e.g. init) and resolves when all have replied. */
  broadcast(make: (i: number) => { job: Job; transfer?: Transferable[] }): Promise<WorkerResponse[]> {
    return Promise.all(this.workers.map((_, i) => {
      const { job, transfer } = make(i);
      return this.post(i, job, transfer);
    }));
  }

  /** Runs a job on the least-loaded worker. */
  run(job: Job, transfer: Transferable[] = []): Promise<WorkerResponse> {
    let best = 0;
    for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[best]) best = i;
    return this.post(best, job, transfer);
  }

  private post(worker: number, job: Job, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const id = this.nextId++;
    this.load[worker]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker });
      this.workers[worker].postMessage({ ...job, id } as WorkerRequest, transfer);
    });
  }

  private onMessage(res: WorkerResponse): void {
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    this.load[p.worker]--;
    if (res.type === 'error') p.reject(new Error(res.message));
    else p.resolve(res);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}
