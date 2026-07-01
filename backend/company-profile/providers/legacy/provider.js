"use strict";

const { spawn } = require("child_process");
const path = require("path");
const { BaseProvider } = require("../base");
const { mapLegacyToCanonical } = require("./mapper");
const { CircuitBreaker } = require("../../infrastructure/resilience");

/**
 * Legacy provider that wraps the existing Python pipeline.
 *
 * Spawns fetch_company_profile.py for Yahoo + Finviz + SEC enrichment.
 * Used as a fallback while Node.js providers mature.
 */
class LegacyProvider extends BaseProvider {
  constructor({ pythonBinary = "python3", scriptPath } = {}) {
    super("legacy", 50);
    this.pythonBinary = pythonBinary;
    this.scriptPath = scriptPath || path.join(__dirname, "..", "..", "..", "fetch_company_profile.py");
    this.breaker = new CircuitBreaker({
      name: "legacy",
      failureThreshold: Number(process.env.LEGACY_BREAKER_FAILURE_THRESHOLD || 5),
      cooldownMs: Number(process.env.LEGACY_BREAKER_COOLDOWN_MS || 30_000)
    });
  }

  async getProfile(symbol, { timeoutMs = 1200, theme, category } = {}) {
    return this.breaker.execute(() => this._getProfile(symbol, { timeoutMs, theme, category }));
  }

  async _getProfile(symbol, { timeoutMs = 1200, theme, category } = {}) {
    const s = String(symbol).toUpperCase();
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonBinary, [this.scriptPath], { cwd: path.dirname(this.scriptPath) });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill("SIGKILL");
          reject(new Error("Legacy provider timed out"));
        }
      }, timeoutMs);

      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (code !== 0) {
          return reject(new Error(`Legacy provider exited ${code}: ${stderr || stdout}`));
        }

        try {
          const result = JSON.parse(stdout || "{}");
          if (result.error) {
            return reject(new Error(result.error));
          }
          resolve(mapLegacyToCanonical(result));
        } catch (err) {
          reject(new Error(`Legacy provider parse error: ${err.message}`));
        }
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      child.stdin.write(JSON.stringify({ symbol: s, theme, category }));
      child.stdin.end();
    });
  }
}

module.exports = { LegacyProvider };
