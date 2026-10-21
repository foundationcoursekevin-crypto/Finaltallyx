/*
 * Password protection for .tally files.
 * PBKDF2-SHA256 (600,000 iterations) derives a key, AES-256-GCM encrypts and authenticates the data.
 * Uses only the standard Web Crypto API, so it works in the desktop app, in the browser and in Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis.crypto || require('crypto').webcrypto);
  else root.TallyCrypto = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';

  const ITER = 600000;
  const MIN_LENGTH = 6;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const AAD = enc.encode('tally-file-v1');

  const b64 = (buf) => {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));

  async function deriveKey(password, salt, iter) {
    const base = await webcrypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return webcrypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function isEncrypted(obj) {
    return !!obj && typeof obj === 'object' && obj.app === 'tally' && obj.encrypted === true;
  }

  async function encrypt(text, password) {
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const data = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, enc.encode(text));
    return JSON.stringify({ app: 'tally', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(data) });
  }

  async function decrypt(obj, password) {
    if (!isEncrypted(obj) || obj.v !== 1 || obj.kdf !== 'PBKDF2-SHA256' || obj.cipher !== 'AES-256-GCM' ||
        typeof obj.salt !== 'string' || typeof obj.iv !== 'string' || typeof obj.data !== 'string' ||
        !Number.isInteger(obj.iter) || obj.iter < 100000 || obj.iter > 5000000) {
      throw new Error('Unsupported or damaged encrypted file');
    }
    try {
      const key = await deriveKey(password, unb64(obj.salt), obj.iter);
      const buf = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv), additionalData: AAD }, key, unb64(obj.data));
      return dec.decode(buf);
    } catch (e) {
      throw new Error('Wrong password, or the file is damaged');
    }
  }

  return { encrypt, decrypt, isEncrypted, MIN_LENGTH };
});
