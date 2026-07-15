import { startTransition, useEffect, useRef, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";
import { hydrateProviderHealth } from "../utils/DataCoverageRegistry";

export function useAppBootstrap({ enabled = true, tradeLimit = 1000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const hasDataRef = useRef(false);

  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      setError("");
      inFlightRef.current = false;
      return;
    }
    // StrictMode (dev) double-invokes effects; guarantee a single in-flight
    // bootstrap GET regardless of how many times this effect re-runs.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    let cancelled = false;
    const controller = new AbortController();
    // Hard timeout: never trap the user on the splash. If bootstrap is slow or
    // rate-limited, launch the workspace anyway and let data fill in behind it.
    const hardTimeout = setTimeout(() => {
      if (cancelled) return;
      setError((prev) => prev || "Workspace is taking longer than expected.");
      setLoading(false);
      setRefreshing(false);
    }, 5000);

    const load = async () => {
      console.count("bootstrapWorkspace");
      const shouldBlockRender = !hasDataRef.current;
      setLoading(shouldBlockRender);
      setRefreshing(!shouldBlockRender);
      setError("");
      try {
        const params = new URLSearchParams({ tradeLimit: String(tradeLimit) });
        const res = await zeninFetch(`/app/bootstrap?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await res.json().catch(() => ({}));
        if (cancelled || controller.signal.aborted) return;
        if (!res.ok) {
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
        startTransition(() => {
          setData(payload);
        });
        hasDataRef.current = true;
        console.log("[lifecycle] Bootstrap Completed");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err?.message || "Failed to load workspace bootstrap.");
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    load();

    // Hydrate live provider health (MyStocks wired flag) from the backend.
    // Fire-and-forget: never blocks the splash; failures keep static defaults.
    hydrateProviderHealth().catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(hardTimeout);
    };
  }, [enabled, tradeLimit, refreshKey]);

  return {
    bootstrapData: data,
    bootstrapLoading: loading,
    bootstrapRefreshing: refreshing,
    bootstrapError: error,
    refreshBootstrap: () => setRefreshKey((value) => value + 1)
  };
}
