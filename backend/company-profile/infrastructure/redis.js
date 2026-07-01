"use strict";

const Redis = require("ioredis");

/**
 * Create a Redis client from env vars.
 *
 * Tries REDIS_URL, then REDIS_HOST/REDIS_PORT/REDIS_PASSWORD.
 * Returns null if no configuration is present.
 */
function createRedisClient() {
  const url = String(process.env.REDIS_URL || "").trim();
  if (url) return new Redis(url, { lazyConnect: true });

  const host = String(process.env.REDIS_HOST || "").trim();
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = String(process.env.REDIS_PASSWORD || "").trim();
  if (!host) return null;

  return new Redis({
    host,
    port,
    password: password || undefined,
    lazyConnect: true
  });
}

module.exports = { createRedisClient };
