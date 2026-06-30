/**
 * Brokerage Credential Helpers
 * ============================
 *
 * Encrypts/decrypts opaque provider credentials stored in connection.providerMeta.
 * Secrets never leave this layer in plaintext toward API responses.
 */

"use strict";

const SECRET_FIELD = "userSecretEncrypted";

/**
 * @typedef {Object} SecretProvider
 * @property {(value: string) => string} encryptSecret
 * @property {(value: string) => string} decryptSecret
 */

/**
 * @param {Object} [providerMeta]
 * @param {SecretProvider} secretProvider
 * @returns {{ userSecret?: string }}
 */
function extractCredentials(providerMeta, secretProvider) {
  const meta = providerMeta && typeof providerMeta === "object" ? providerMeta : {};
  const encrypted = meta[SECRET_FIELD] || meta.userSecret;
  if (!encrypted) return {};
  try {
    const userSecret = secretProvider.decryptSecret(String(encrypted));
    return userSecret ? { userSecret: String(userSecret) } : {};
  } catch {
    return {};
  }
}

/**
 * Merges encrypted credentials into providerMeta and strips plaintext secrets.
 *
 * @param {Object} providerMeta
 * @param {{ userSecret?: string }} credentials
 * @param {SecretProvider} secretProvider
 */
function sealProviderMeta(providerMeta, credentials, secretProvider) {
  const meta = { ...(providerMeta || {}) };
  delete meta.userSecret;

  if (credentials?.userSecret) {
    meta[SECRET_FIELD] = secretProvider.encryptSecret(String(credentials.userSecret));
  }

  return meta;
}

/**
 * Removes secret material from a connection record before API exposure.
 *
 * @param {Object|null} connection
 */
function sanitizeConnection(connection) {
  if (!connection) return null;
  const meta = { ...(connection.providerMeta || {}) };
  delete meta.userSecret;
  delete meta[SECRET_FIELD];
  return { ...connection, providerMeta: meta };
}

/**
 * Builds a stable provider-side user reference for a workspace member.
 *
 * @param {number|string} workspaceId
 * @param {number|string} userId
 */
function buildProviderUserRef(workspaceId, userId) {
  return `w${Number(workspaceId)}-u${Number(userId)}`;
}

module.exports = {
  SECRET_FIELD,
  extractCredentials,
  sealProviderMeta,
  sanitizeConnection,
  buildProviderUserRef
};
