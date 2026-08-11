// components/AssetLogo.jsx
// Shared asset identity renderer. Renders a real company/crypto logo via
// logo.dev, falling back to a monochrome lettermark tile when the logo
// is missing or fails to load. Monochrome-safe: logos are requested
// greyscale + dark theme to match the Brandv2 spec (no color accents
// on the dark UI).
//
// This component is the SINGLE rendering layer for asset icons.
// All URL construction is delegated to utils/assetIconResolver.js.
//
// Docs: https://www.logo.dev/docs/logo-images/introduction

import { useState, useMemo } from "react";
import { resolveAssetIcon } from "../utils/assetIconResolver";

// Size mapping — deterministic dimensions prevent layout shift.
const SIZE_PX = {
  xs: 20,
  sm: 24,
  md: 28,
  lg: 32,
};

// CSS class for the logo image wrapper (for sizing + border-radius).
function logoClassName(size, typeClass, extra) {
  const classes = ["asset-logo", `asset-logo--${size}`];
  if (typeClass) classes.push(`asset-logo--${typeClass}`);
  if (extra) classes.push(extra);
  return classes.join(" ");
}

// Lettermark fallback — shown when no logo resolves or image fails to load.
function Lettermark({ asset, type, size = "md", className = "" }) {
  const resolved = useMemo(() => resolveAssetIcon(asset || { symbol: "", type }), [asset, type]);
  const label = resolved.initials || "?";
  const tone = resolved.fallbackType || "unknown";
  const px = SIZE_PX[size] || 28;

  return (
    <span
      className={`market-asset-logo ${tone} ${className}`.trim()}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.35) }}
      title={asset?.symbol || asset?.name || ""}
    >
      {label}
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
//
export function AssetLogo({ asset, symbol, type, size = "md", className = "", alt }) {
  const resolved = useMemo(() => {
    if (asset) return resolveAssetIcon(asset);
    return resolveAssetIcon({ symbol: symbol || "", type: type || "" });
  }, [asset, symbol, type]);

  const [failed, setFailed] = useState(false);
  const px = SIZE_PX[size] || 28;

  // No symbol / identity → lettermark fallback only
  if (!resolved.url || failed) {
    const fallbackType = resolved.fallbackType || (typeof asset === "object" ? "" : type) || "";
    return <Lettermark asset={asset} type={type || fallbackType} size={size} className={className} />;
  }

  return (
    <img
      src={resolved.url}
      alt={alt || `${resolved.initials} logo`}
      width={px}
      height={px}
      loading="lazy"
      className={logoClassName(size, resolved.fallbackType, className)}
      onError={() => setFailed(true)}
      style={{ objectFit: "contain", borderRadius: "9px" }}
    />
  );
}

export default AssetLogo;
