import { startTransition, useEffect, useRef, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";

export function useAppBootstrap({ enabled = true, tradeLimit = 1000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const hasDataRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      setError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
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

    return () => {
      cancelled = true;
      controller.abort();
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
