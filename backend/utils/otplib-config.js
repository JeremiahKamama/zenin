const crypto = require('crypto');
const { TOTP } = require('@otplib/totp');

/**
 * A simple Base32 implementation for CommonJS environments
 * to avoid ERR_REQUIRE_ESM issues with @scure/base.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32 = {
  encode(buffer, options = {}) {
    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;

      while (bits >= 5) {
        output += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += ALPHABET[(value << (5 - bits)) & 31];
    }
    
    if (options.padding !== false) {
      while (output.length % 8 !== 0) {
        output += '=';
      }
    }

    return output;
  },

  decode(string) {
    const cleaned = string.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
    const buffer = Buffer.alloc(Math.floor((cleaned.length * 5) / 8));
    let bits = 0;
    let value = 0;
    let index = 0;

    for (let i = 0; i < cleaned.length; i++) {
      const charValue = ALPHABET.indexOf(cleaned[i]);
      if (charValue === -1) continue; // Skip invalid characters like spaces

      value = (value << 5) | charValue;
      bits += 5;

      if (bits >= 8) {
        if (index < buffer.length) {
          buffer[index++] = (value >>> (bits - 8)) & 255;
        }
        bits -= 8;
      }
    }

    return buffer;
  }
};

/**
 * A native Node.js crypto plugin for otplib to avoid ESM issues.
 */
const cryptoPlugin = {
  hmac(algorithm, key, data) {
    return crypto.createHmac(algorithm, key).update(data).digest();
  },
  randomBytes(size) {
    return crypto.randomBytes(size);
  },
  constantTimeEqual(a, b) {
    // Handle both Buffer and string inputs
    const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a);
    const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b);
    
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
};

/**
 * Create a configured TOTP instance that behaves like the default authenticator.
 */
const authenticator = new TOTP({
  crypto: cryptoPlugin,
  base32: base32
});

// Add the keyuri method which is expected by some parts of the app
authenticator.keyuri = function(user, service, secret) {
  return `otpauth://totp/${encodeURIComponent(service)}:${encodeURIComponent(user)}?secret=${secret}&issuer=${encodeURIComponent(service)}`;
};

module.exports = {
  authenticator,
  base32,
  cryptoPlugin
};
