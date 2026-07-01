"use strict";

const { serviceSnapshots } = require("../../database");
const { createRedisClient } = require("./redis");

const REDIS_TTL_MS = 60 * 60 * 1000;
const PERSISTENT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MEMORY_TTL_MS = 5 * 60 * 1000;

/**
 * Layered cache:
 *   L1 in-memory Map (fastest)
 *   L2 Redis (shared across processes)
 *   L3 PostgreSQL service_snapshots (persistent)
 *
 * Redis is optional; if unavailable, the cache degrades to memory + Postgres.
 */
class LayeredCache {
  constructor({
    scope = "company-profile",
    memoryTtlMs = DEFAULT_MEMORY_TTL_MS,
    redisTtlMs = REDIS_TTL_MS,
    persistentTtlMs = PERSISTENT_TTL_MS,
    redisClient = null,
    onRedisError = null
  } = {}) {
    this.scope = scope;
    this.memoryTtlMs = memoryTtlMs;
    this.redisTtlMs = redisTtlMs;
    this.persistentTtlMs = persistentTtlMs;
    this._memory = new Map();
    this._inflight = new Map();
    this._redis = redisClient;
    this._redisAvailable = false;
    this._onRedisError = onRedisError || (() => {});

    if (this._redis) {
      this._redis.on("connect", () => { this._redisAvailable = true; });
      this._redis.on("error", (err) => {
        this._redisAvailable = false;
        this._onRedisError(err);
      });
      this._redis.connect().catch((err) => {
        this._redisAvailable = false;
        this._onRedisError(err);
      });
    }
  }

  _key(params) {
    const parts = Object.entries(params || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v == null ? "" : v}`);
    return `${this.scope}:${parts.join(":")}`;
  }

  async get(params, ttlMs) {
    const key = this._key(params);

    // L1 memory
    const mem = this._memory.get(key);
    if (mem && Date.now() - mem.updatedAtMs < this.memoryTtlMs) {
      return mem.payload;
    }

    // L2 Redis
    if (this._redisAvailable) {
      try {
        const raw = await this._redis.get(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          this._memory.set(key, { payload: parsed, updatedAtMs: Date.now() });
          return parsed;
        }
      } catch (err) {
        this._onRedisError(err);
        this._redisAvailable = false;
      }
    }

    // L3 persistent
    const persisted = await serviceSnapshots.get(key);
    if (persisted?.payload && this._isFresh(persisted.updatedAt, ttlMs || this.persistentTtlMs)) {
      this._memory.set(key, { payload: persisted.payload, updatedAtMs: Date.now() });
      return persisted.payload;
    }

    return null;
  }

  async set(params, payload) {
    const key = this._key(params);
    this._memory.set(key, { payload, updatedAtMs: Date.now() });

    if (this._redisAvailable) {
      try {
        await this._redis.setex(key, Math.ceil(this.redisTtlMs / 1000), JSON.stringify(payload));
      } catch (err) {
        this._onRedisError(err);
        this._redisAvailable = false;
      }
    }

    await serviceSnapshots.set(key, payload);
  }

  async getOrCompute(params, ttlMs, factory) {
    const cached = await this.get(params, ttlMs);
    if (cached) return { payload: cached, fromCache: true };

    const key = this._key(params);

    // Request collapsing.
    if (this._inflight.has(key)) {
      return { payload: await this._inflight.get(key), fromCache: false };
    }

    const promise = Promise.resolve()
      .then(factory)
      .then(async (payload) => {
        await this.set(params, payload);
        return payload;
      })
      .finally(() => {
        this._inflight.delete(key);
      });

    this._inflight.set(key, promise);
    return { payload: await promise, fromCache: false };
  }

  async invalidate(params) {
    const key = this._key(params);
    this._memory.delete(key);
    if (this._redisAvailable) {
      try {
        await this._redis.del(key);
      } catch (err) {
        this._onRedisError(err);
      }
    }
    await serviceSnapshots.delete(key);
  }

  _isFresh(updatedAt, ttlMs) {
    if (!ttlMs || !updatedAt) return false;
    const updated = new Date(updatedAt).getTime();
    return Date.now() - updated < ttlMs;
  }

  stats() {
    return {
      memorySize: this._memory.size,
      inflightSize: this._inflight.size,
      redisAvailable: this._redisAvailable
    };
  }
}

module.exports = { LayeredCache, REDIS_TTL_MS, PERSISTENT_TTL_MS };
