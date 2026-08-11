// services/providers/AssetLogoProvider/routes.js
// Express routes for asset icon resolution.
//
// Endpoints:
//   GET /api/asset-logo/resolve?symbol=NVDA&type=stock&exchange=NASDAQ&isin=...
//   GET /api/asset-logo/status
//
// The frontend calls this API instead of constructing provider URLs directly.
// All provider-specific logic (VectorUp URL construction, Logo.dev URL construction,
// token handling) lives in this backend module.
//
// Spec: §5 Server-Side VectorUp Access, §6 Public vs Private Credentials,
//      §8 Environment Variables, §71 Direct Provider URL Search

const express = require('express');
const { resolveAssetIcon, toCanonicalAssetIdentity, buildCacheKey, getProviderStatus, ASSET_TYPES } = require('./Provider');

function router() {
  const r = express.Router();

  // ── POST /api/asset-logo/resolve ────────────────────────────────────
  // Accepts a JSON body with asset identity fields.
  // Accepts both single-asset and batch (array) requests.
  //
  // Single asset body:
  //   { symbol, name, type, exchange, isin, cusip, figi, domain,
  //     chain, contractAddress, coinId, underlyingSymbol }
  //
  // Batch body:
  //   [ { ... }, { ... } ]
  //
  r.post('/resolve', express.json(), async (req, res) => {
    try {
      const body = req.body;

      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Request body must be a JSON object or array' });
      }

      // Batch mode
      if (Array.isArray(body)) {
        const results = await Promise.all(
          body.map(async (asset) => {
            try {
              const resolved = await resolveAssetIcon(asset);
              return { ok: true, result: resolved };
            } catch (error) {
              return { ok: false, error: error?.message || 'Resolution failed' };
            }
          })
        );
        return res.json({ results });
      }

      // Single-asset mode
      const asset = body;
      const resolved = await resolveAssetIcon(asset);

      return res.json({
        ok: true,
        result: resolved,
        cacheKey: buildCacheKey(toCanonicalAssetIdentity(asset)),
      });
    } catch (error) {
      console.error('[AssetLogoProvider] Route error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Icon resolution failed',
      });
    }
  });

  // ── GET /api/asset-logo/resolve ─────────────────────────────────────
  // Query-parameter convenience endpoint for single-asset resolution.
  // Usage: GET /api/asset-logo/resolve?symbol=NVDA&type=stock
  r.get('/resolve', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || req.query.ticker || '').trim();
      const type = String(req.query.type || '').trim();
      const exchange = String(req.query.exchange || '').trim();
      const isin = String(req.query.isin || '').trim();
      const domain = String(req.query.domain || '').trim();
      const coinId = String(req.query.coinId || '').trim();
      const chain = String(req.query.chain || '').trim();
      const contractAddress = String(req.query.contractAddress || '').trim();
      const name = String(req.query.name || '').trim();

      if (!symbol && !isin && !domain && !contractAddress) {
        return res.status(400).json({
          ok: false,
          error: 'At least one identifier is required: symbol, isin, domain, or contractAddress',
        });
      }

      const asset = {
        symbol,
        name: name || undefined,
        type: type || undefined,
        exchange: exchange || undefined,
        isin: isin || undefined,
        domain: domain || undefined,
        coinId: coinId || undefined,
        chain: chain || undefined,
        contractAddress: contractAddress || undefined,
      };

      const resolved = await resolveAssetIcon(asset);

      return res.json({
        ok: true,
        result: resolved,
        cacheKey: buildCacheKey(toCanonicalAssetIdentity(asset)),
      });
    } catch (error) {
      console.error('[AssetLogoProvider] GET route error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Icon resolution failed',
      });
    }
  });

  // ── GET /api/asset-logo/status ──────────────────────────────────────
  // Returns provider configuration status (for admin/debug).
  r.get('/status', (_req, res) => {
    const status = getProviderStatus();
    return res.json({
      ok: true,
      providers: status,
    });
  });

  return r;
}

function registerAssetLogoRoutes(app) {
  app.use('/api/asset-logo', router());
}

module.exports = { router, registerAssetLogoRoutes, resolveAssetIcon, buildCacheKey, ASSET_TYPES };
