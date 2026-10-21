'use strict';
const assert = require('assert');
const C = require('../src/crypto.js');

(async () => {
  const text = JSON.stringify({ app: 'tally', cells: { A1: { v: 'héllo ✓' } } });
  const packed = await C.encrypt(text, 'correct horse');
  const obj = JSON.parse(packed);
  assert.ok(C.isEncrypted(obj));
  assert.ok(!packed.includes('héllo') && !packed.includes('cells'), 'plaintext must not appear in the file');
  assert.strictEqual(await C.decrypt(obj, 'correct horse'), text);
  await assert.rejects(() => C.decrypt(obj, 'wrong password'), /Wrong password/);
  const tampered = Object.assign({}, obj, { data: obj.data.slice(0, -4) + 'AAAA' });
  await assert.rejects(() => C.decrypt(tampered, 'correct horse'), /Wrong password/);
  await assert.rejects(() => C.decrypt(Object.assign({}, obj, { iter: 1 }), 'correct horse'), /Unsupported/);
  const again = JSON.parse(await C.encrypt(text, 'correct horse'));
  assert.notStrictEqual(again.salt, obj.salt, 'fresh salt every save');
  assert.notStrictEqual(again.data, obj.data);
  console.log('5 crypto tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
