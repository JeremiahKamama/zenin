// frontend/src/utils/webauthnOptions.js
//
// Bridge the server's JSON WebAuthn options to what the browser library needs.
//
// WHY THIS EXISTS
// ---------------
// The backend uses @simplewebauthn/server v13, whose `generateAuthentication-
// Options` / `generateRegistrationOptions` return a JSON-safe object with
// base64url STRINGS:
//
//   { challenge: "mrQVUViAPOvWrfGq8BqJ6K2BOInJHkD__02lHgcR2Nk",
//     user: { id: "42", name: "a@b.com" },
//     allowCredentials: [{ id: "AbC...", type: "public-key" }] }
//
// The browser package's `startAuthentication` / `startRegistration` v13 expect
// the binary fields as Uint8Array. Passing the raw JSON produces the runtime
// warning:
//
//   "startAuthentication() was not called correctly. It will try to continue
//    with the provided options, but this call should be refactored to use the
//    expected call structure instead."
//
// and then fails in inconsistent, browser-dependent ways — on some platforms
// with NotSupportedError, on others by sending a challenge the server cannot
// match. Every call site in this app passed the raw JSON, so this is the
// shared root cause of the passkey breakage across all surfaces.
//
// The conversion is explicit and one-way (server shape -> browser shape). The
// response the authenticator returns is already the browser shape and is sent
// back to the server, which does its own conversion.

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

/** base64url -> Uint8Array, tolerating a value that is already binary. */
function toBinary(value) {
  if (value == null) return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value !== "string") return value;
  // Buffer is not available in the browser bundle; TextDecoder-free manual
  // decode keeps this dependency-free and avoids atob quirks with padding.
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** True when the string looks like base64url (so we do not corrupt buffers). */
function looksBase64Url(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}

/**
 * Convert a server descriptor (`{ id, type, transports }`) into the browser
 * shape, where `id` is binary.
 */
function toBrowserDescriptor(descriptor) {
  if (!descriptor) return descriptor;
  return {
    ...descriptor,
    id: looksBase64Url(descriptor.id) ? toBinary(descriptor.id) : descriptor.id
  };
}

/**
 * Prepare `generateAuthenticationOptions` output for `startAuthentication`.
 *
 * @param {object} serverOptions the JSON payload exactly as the server sent it
 * @returns {object} options with `challenge` and credential ids as binary
 */
export function toBrowserAuthenticationOptions(serverOptions) {
  const options = serverOptions || {};
  return {
    ...options,
    challenge: toBinary(options.challenge),
    allowCredentials: Array.isArray(options.allowCredentials)
      ? options.allowCredentials.map(toBrowserDescriptor)
      : options.allowCredentials
  };
}

/**
 * Prepare `generateRegistrationOptions` output for `startRegistration`.
 *
 * `user.id` is base64url in the server payload and MUST be converted, or the
 * authenticator stores the raw string as the user handle and the credential
 * cannot be matched back to the account.
 */
export function toBrowserRegistrationOptions(serverOptions) {
  const options = serverOptions || {};
  return {
    ...options,
    challenge: toBinary(options.challenge),
    user: options.user
      ? { ...options.user, id: toBinary(options.user.id) }
      : options.user,
    excludeCredentials: Array.isArray(options.excludeCredentials)
      ? options.excludeCredentials.map(toBrowserDescriptor)
      : options.excludeCredentials
  };
}

/** WebAuthn exceptions carry the interesting detail in `name`, not `message`. */
const FRIENDLY_MESSAGES = {
  NotAllowedError: "Passkey request was dismissed or timed out. Try again, and approve the prompt on your device.",
  AbortError: "Passkey request was cancelled. Try again.",
  NotSupportedError: "This device or browser does not support passkeys. Use a password or Google sign-in instead.",
  InvalidStateError: "That passkey is already registered on this device.",
  SecurityError: "Passkeys require a secure connection (HTTPS) and a matching domain.",
  ConstraintError: "Your device could not satisfy the passkey requirements.",
  UnknownError: "Your device rejected the passkey request."
};

/**
 * Turn a WebAuthn failure into something a person can act on.
 *
 * The raw messages are things like "The operation either timed out or was not
 * allowed." which do not tell the user what to do next.
 */
export function describePasskeyError(error) {
  if (!error) return "Passkey sign-in failed.";
  const name = error.name || "";
  if (FRIENDLY_MESSAGES[name]) return FRIENDLY_MESSAGES[name];
  const message = String(error.message || "");
  if (/not supported in this browser/i.test(message)) {
    return FRIENDLY_MESSAGES.NotSupportedError;
  }
  if (/not called correctly/i.test(message)) {
    return "Passkey setup is misconfigured. Please contact support.";
  }
  return message || "Passkey sign-in failed.";
}

/** True when this browser can do WebAuthn at all, so we can hide the button. */
export function browserSupportsPasskeys() {
  if (typeof window === "undefined") return false;
  return Boolean(window.PublicKeyCredential) && Boolean(navigator?.credentials?.get);
}

export { startAuthentication, startRegistration, toBinary };
