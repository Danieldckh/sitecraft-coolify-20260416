import PQueue from 'p-queue';

// Per-site in-process mutex. Any regen pipeline for a single site (theme, page,
// element) must run one-at-a-time to prevent races. Concurrency 1 per key.
const queues = new Map<string, PQueue>();

function queueFor(siteId: string): PQueue {
  let q = queues.get(siteId);
  if (!q) {
    q = new PQueue({ concurrency: 1 });
    queues.set(siteId, q);
  }
  return q;
}

export function withSiteLock<T>(siteId: string, fn: () => Promise<T>): Promise<T> {
  return queueFor(siteId).add(fn) as Promise<T>;
}

export function siteQueueSize(siteId: string): number {
  return queueFor(siteId).size + queueFor(siteId).pending;
}
