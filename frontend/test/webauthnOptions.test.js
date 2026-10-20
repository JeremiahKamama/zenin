// frontend/test/webauthnOptions.test.js
//
// Passkey sign-in and registration were broken on EVERY surface because the
// server's JSON WebAuthn options were handed straight to
// @simplewebauthn/browser v13.
//
// The server (v13 server package) emits JSON-safe base64url STRINGS:
//   { challenge: "mrQV...", user: { id: "42" }, allowCredentials: [{ id: "AbC..." }] }
//
// The browser package's startAuthentication/startRegistration v13 expect those
// binary fields as Uint8Array, and warn at runtime:
//   "startAuthentication() was not called correctly. It will try to continue
//    with the provided options, but this call should be refactored to use the
//    expected call structure instead."
//
// These tests pin the conversion, because the failure is browser-dependent
// (NotSupportedError on some platforms, an unmatched challenge on others) and
// therefore easy to "fix" by accident.

import test from "node:test";
import assert from "node:assert/strict";

// The module imports the browser package, which touches a few DOM globals at
// import time for feature detection. Provide the minimum, defensively: Node 22
// exposes `navigator` as a getter-only property, so it cannot be assigned.
if (typeof globalThis.window === "undefined") {
  globalThis.window = { PublicKeyCredential: function PublicKeyCredential() {} };
}
if (typeof globalThis.atob === "undefined") {
  globalThis.atob = (b64) => Buffer.from(b64, "base64").toString("binary");
}
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
    writable: true
  });
}

const {
  toBrowserAuthenticationOptions,
  toBrowserRegistrationOptions,
  toBinary,
  describePasskeyError,
  browserSupportsPasskeys
} = await import("../src/utils/webauthnOptions.js");

test("the authentication challenge becomes binary", () => {
  const serverOptions = {
    challenge: "mrQVUViAPOvWrfGq8BqJ6K2BOInJHkD__02lHgcR2Nk",
    rpId: "www.zenin.capital",
    timeout: 60000,
    userVerification: "preferred"
  };

  const browserOptions = toBrowserAuthenticationOptions(serverOptions);

  assert.ok(browserOptions.challenge instanceof Uint8Array, "challenge must be Uint8Array");
  assert.equal(browserOptions.challenge.length, 32, "a 43-char base64url challenge is 32 bytes");
  // Non-binary fields must pass through untouched.
  assert.equal(browserOptions.rpId, "www.zenin.capital");
  assert.equal(browserOptions.timeout, 60000);
  assert.equal(browserOptions.userVerification, "preferred");
});

test("challenge bytes round-trip back to the same base64url", () => {
  const original = "mrQVUViAPOvWrfGq8BqJ6K2BOInJHkD__02lHgcR2Nk";
  const bytes = toBinary(original);
  const back = Buffer.from(bytes).toString("base64url");
  assert.equal(back, original, "conversion must be lossless or the server cannot match it");
});

test("credential descriptor ids become binary", () => {
  const serverOptions = {
    challenge: "AAAA",
    allowCredentials: [
      { id: "mrQVUViAPOvWrfGq8BqJ6K2BOInJHkD__02lHgcR2Nk", type: "public-key", transports: ["internal"] }
    ]
  };

  const browserOptions = toBrowserAuthenticationOptions(serverOptions);
  const [credential] = browserOptions.allowCredentials;

  assert.ok(credential.id instanceof Uint8Array, "credential id must be binary");
  assert.equal(credential.type, "public-key");
  assert.deepEqual(credential.transports, ["internal"], "other fields preserved");
});

test("an options payload without allowCredentials survives", () => {
  // Discoverable-credential flows omit allowCredentials entirely; the mapping
  // must not turn undefined into [] and change the WebAuthn semantics.
  const browserOptions = toBrowserAuthenticationOptions({ challenge: "AAAA" });
  assert.equal(browserOptions.allowCredentials, undefined);
});

test("registration converts BOTH the challenge and user.id", () => {
  // user.id is the user handle the authenticator stores. Left as a string, the
  // credential is created but can never be matched back to the account.
  const serverOptions = {
    challenge: "mrQVUViAPOvWrfGq8BqJ6K2BOInJHkD__02lHgcR2Nk",
    rp: { id: "www.zenin.capital", name: "Zenin Capital" },
    user: { id: "42", name: "trader@example.com", displayName: "Trader" },
    excludeCredentials: []
  };

  const browserOptions = toBrowserRegistrationOptions(serverOptions);

  assert.ok(browserOptions.challenge instanceof Uint8Array);
  assert.ok(browserOptions.user.id instanceof Uint8Array, "user.id must be binary");
  assert.equal(browserOptions.user.name, "trader@example.com", "other user fields intact");
  assert.deepEqual(browserOptions.excludeCredentials, []);
});

test("excludeCredentials ids become binary (prevents duplicate registration)", () => {
  // A string id here means the authenticator does not recognise the credential
  // as already registered and happily creates a duplicate.
  const serverOptions = {
    challenge: "AAAA",
    user: { id: "42", name: "a@b.c" },
    excludeCredentials: [{ id: "qpZ6BhE1HmSotqV1tSSqO_RlQwTcYqO0GxwbSylI9lM", type: "public-key" }]
  };

  const browserOptions = toBrowserRegistrationOptions(serverOptions);
  assert.ok(browserOptions.excludeCredentials[0].id instanceof Uint8Array);
});

test("already-binary input is not double-converted", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = toBinary(bytes);
  assert.equal(result, bytes, "a Uint8Array must pass through unchanged");
});

test("nullish values pass through rather than throwing", () => {
  assert.equal(toBinary(null), null);
  assert.equal(toBinary(undefined), undefined);
  const options = toBrowserRegistrationOptions({ challenge: "AAAA", user: null });
  assert.equal(options.user, null);
});

test("padding-free and padded base64url both decode", () => {
  // The server emits unpadded base64url; a value that arrives padded (or as
  // standard base64 with + and /) must still decode rather than corrupt.
  const unpadded = "mrQVUViAPOvWrfGq8BqJ6K2BOInJHkD__02lHgcR2Nk";
  const standard = Buffer.from(unpadded, "base64url").toString("base64");
  assert.equal(toBinary(unpadded).length, toBinary(standard).length);
});

test("WebAuthn errors become actionable text", () => {
  // Raw messages read like "The operation either timed out or was not allowed."
  // which does not tell the user what to do next.
  const cases = [
    ["NotAllowedError", /dismissed|timed out/i],
    ["NotSupportedError", /does not support passkeys/i],
    ["InvalidStateError", /already registered/i],
    ["SecurityError", /secure connection/i]
  ];
  for (const [name, pattern] of cases) {
    const message = describePasskeyError(Object.assign(new Error("raw"), { name }));
    assert.match(message, pattern, `${name} should map to guidance`);
  }
});

test("a misconfiguration message is reported as such, not as a user error", () => {
  // The v13 deprecation warning appearing in production means the call site is
  // wrong; telling the user to "try again" would be misleading.
  const message = describePasskeyError(
    Object.assign(new Error("startAuthentication() was not called correctly."), {
      name: "Error"
    })
  );
  assert.match(message, /misconfigured|support/i);
});

test("an unknown error still yields a non-empty message", () => {
  assert.equal(typeof describePasskeyError(new Error("boom")), "string");
  assert.ok(describePasskeyError(null).length > 0);
});

test("browser support detection is safe without DOM globals", () => {
  // Must not throw during SSR or in a plain node test run.
  assert.equal(typeof browserSupportsPasskeys(), "boolean");
});
