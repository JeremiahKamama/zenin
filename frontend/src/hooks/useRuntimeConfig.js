import { useEffect, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";
import {
  getAppRuntimeConfig,
  getPublicRuntimeConfig,
  setRuntimeConfigs
} from "../config/runtimeConfigStore";

export function useRuntimeConfig({ enabled = true } = {}) {
  const [publicConfig, setPublicConfig] = useState(() => getPublicRuntimeConfig());
  const [appConfig, setAppConfig] = useState(() => getAppRuntimeConfig());
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(Boolean(enabled));
  const [runtimeConfigError, setRuntimeConfigError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setRuntimeConfigLoading(false);
      setRuntimeConfigError("");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setRuntimeConfigLoading(true);
      setRuntimeConfigError("");
      try {
        const res = await zeninFetch("/public/config", { signal: controller.signal });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
        if (cancelled || controller.signal.aborted) return;
        setRuntimeConfigs({
          publicConfig: payload?.publicConfig,
          appConfig: payload?.appConfig
        });
        setPublicConfig(getPublicRuntimeConfig());
        setAppConfig(getAppRuntimeConfig());
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setRuntimeConfigError(error?.message || "Failed to load runtime config.");
        setPublicConfig(getPublicRuntimeConfig());
        setAppConfig(getAppRuntimeConfig());
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setRuntimeConfigLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled]);

  return {
    publicConfig,
    appConfig,
    runtimeConfigLoading,
    runtimeConfigError
  };
}
