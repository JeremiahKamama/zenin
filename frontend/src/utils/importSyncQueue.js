import { zeninFetch } from "./zeninFetch";

const SYNC_QUEUE_KEY = "zenin_watchlist_import_sync_queue";

function getQueue() {
  try {
    const raw = window.localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setQueue(queue) {
  try {
    window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

/**
 * Enqueue a batch of normalized import assets that failed to sync to the backend.
 * Called from the import catch block when /db/watchlist/bulk fails.
 */
export function enqueueImportSync(assets = []) {
  const queue = getQueue();
  const batch = {
    id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    assets,
    queuedAt: new Date().toISOString()
  };
  queue.push(batch);
  setQueue(queue);
  return batch;
}

/**
 * Flush all queued imports to the backend.
 * Returns { syncedBatches: number, failedBatches: number, totalAssets: number }
 */
export async function flushImportSyncQueue() {
  const queue = getQueue();
  if (queue.length === 0) return { syncedBatches: 0, failedBatches: 0, totalAssets: 0 };

  let syncedBatches = 0;
  let failedBatches = 0;
  let totalAssets = 0;
  const remaining = [];

  for (const batch of queue) {
    if (!Array.isArray(batch?.assets) || batch.assets.length === 0) continue;
    totalAssets += batch.assets.length;
    try {
      const res = await zeninFetch("/db/watchlist/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assets: batch.assets })
      });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      syncedBatches++;
    } catch {
      failedBatches++;
      remaining.push(batch);
    }
  }

  setQueue(remaining);
  return { syncedBatches, failedBatches, totalAssets };
}

/**
 * Check whether there are any pending sync batches.
 */
export function hasPendingImportSync() {
  return getQueue().length > 0;
}
