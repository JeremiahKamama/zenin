// components/AssetLogo.jsx
// Shared asset identity renderer. Renders a real company/crypto logo via the
// backend resolver (VectorUp primary, Logo.dev fallback), falling back to a
// monochrome lettermark tile when the logo is missing or fails to load.
//
// Monochrome-safe: logos are requested greyscale + dark theme to match the
// Brandv2 spec (no color accents on the dark UI).
//
// This component is the SINGLE rendering layer for asset icons.
// All URL construction is delegated to utils/assetIconResolver.js and the
// backend /api/asset-logo/resolve endpoint.
//
// Docs: https://www.logo.dev/docs/logo-images/introduction
//       https://vectorup.dev/docs/api-reference/logo

import { useState, useEffect, useMemo } from "react";
import {
  resolveAssetIcon,
  resolveAssetIconSync,
  toCanonicalAssetIdentity,
  getFallbackTypeClass,
  getFallbackInitials,
} from "../utils/assetIconResolver";

// Size mapping — deterministic dimensions prevent layout shift.
const SIZE_PX = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 32,
};

function logoClassName(size, typeClass, extra) {
  const classes = ["asset-logo", `asset-logo--${size}`];
  if (typeClass) classes.push(`asset-logo--${typeClass}`);
  if (extra) classes.push(extra);
  return classes.join(" ");
}

// Lettermark fallback — shown when no logo resolves or image fails to load.
// Uses synchronous resolution for immediate render, async resolution for updates.
function Lettermark({ asset, fallbackType, initials, size = "md", className = "" }) {
  const px = SIZE_PX[size] || 28;

  return (
    <span
      className={`market-asset-logo ${fallbackType || "unknown"} ${className}`.trim()}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.35) }}
      title={asset?.symbol || asset?.name || ""}
    >
      {initials || "?"}
    </span>
  );
}

// Shared asset logo renderer.
//
// Accepts either a canonical asset identity object (preferred) or the
// legacy API ({ symbol, type }).
//
// Usage:
//   <AssetLogo asset={canonicalIdentity} size="sm" />
//   <AssetLogo symbol="NVDA" type="stock" size="xs" />   // legacy compat
export function AssetLogo({ asset, symbol, type, size = "md", className = "", alt }) {
  const identity = useMemo(() => {
    if (asset) return toCanonicalAssetIdentity(asset);
    return toCanonicalAssetIdentity({ symbol: symbol || "", type: type || "" });
  }, [asset, symbol, type]);

  // Synchronous initial render (deterministic fallback or client-side logo.dev URL)
  const [resolved, setResolved] = useState(() => {
    const sync = resolveAssetIconSync(identity);
    return {
      type: sync.type,
      url: sync.url,
      fallbackType: sync.fallbackType || getFallbackTypeClass(identity?.kind),
      initials: sync.initials,
      provider: sync.provider,
      cached: false,
    };
  });

  const [failed, setFailed] = useState(false);
  const px = SIZE_PX[size] || 28;

  // Async resolution via backend API (VectorUp primary, Logo.dev fallback)
  useEffect(() => {
    if (!identity || !identity.symbol) {
      setResolved((prev) => ({
        ...prev,
        type: "fallback",
        fallbackType: "unknown",
        initials: "?",
        url: null,
        provider: "fallback",
      }));
      return;
    }

    let cancelled = false;
    resolveAssetIcon(identity)
      .then((result) => {
        if (!cancelled) {
          setResolved(result);
          setFailed(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          // Keep synchronous fallback on backend error
          if (process.env.NODE_ENV !== "production") {
            console.warn("[AssetLogo] Resolution failed:", error?.message || error);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [identity]);

  const fallbackType = resolved.fallbackType || getFallbackTypeClass(identity?.kind);
  const initials = resolved.initials || getFallbackInitials(identity);

  // No URL or image failed → lettermark fallback
  if (!resolved.url || failed || resolved.type !== "remote") {
    return (
      <Lettermark
        asset={identity}
        fallbackType={fallbackType}
        initials={initials}
        size={size}
        className={className}
      />
    );
  }

  return (
    <img
      src={resolved.url}
      alt={alt || `${initials} logo`}
      width={px}
      height={px}
      loading="lazy"
      className={logoClassName(size, fallbackType, className)}
      onError={() => setFailed(true)}
      style={{ objectFit: "contain", borderRadius: "9px" }}
    />
  );
}

export default AssetLogo;
