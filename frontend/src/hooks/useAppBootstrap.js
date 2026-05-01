import { useEffect, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";

export function useAppBootstrap({ enabled = true, tradeLimit = 1000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
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
        setData(payload);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err?.message || "Failed to load workspace bootstrap.");
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setLoading(false);
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
    bootstrapError: error,
    refreshBootstrap: () => setRefreshKey((value) => value + 1)
  };
}
