"use strict";

/**
 * Base interface for company profile providers.
 *
 * Every provider must implement:
 *   - name: string
 *   - priority: number (lower = higher priority)
 *   - getProfile(symbol, options): Promise<CanonicalProfile>
 *   - health(): { ok: boolean, reason?: string }
 */
class BaseProvider {
  constructor(name, priority = 100) {
    this.name = name;
    this.priority = priority;
  }

  async getProfile(/* symbol, options */) {
    throw new Error("getProfile must be implemented by subclass");
  }

  health() {
    return { ok: true };
  }
}

module.exports = { BaseProvider };
