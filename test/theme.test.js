'use strict';
const assert = require('assert');
const T = require('../src/theme.js');
let passed = 0;
const t = (n, f) => { try { f(); passed++; } catch (e) { console.error('FAIL:', n, e.message); process.exitCode = 1; } };

t('color sets have 10 hex colors', () => {
  for (const s of T.COLOR_SETS) {
    assert.strictEqual(s.c.length, 10, s.name);
    for (const c of s.c) assert.ok(/^#[0-9a-f]{6}$/.test(c), s.name + ' ' + c);
  }
});
t('every theme points at real sets', () => {
  for (const th of T.THEMES) { assert.ok(T.hasColors(th.colors), th.name); assert.ok(T.hasFonts(th.fonts), th.name); }
});
t('resolve theme refs and tints', () => {
  const colors = T.colorSet('Office').c;
  assert.strictEqual(T.resolve('t:4:0', colors), '#4472c4');
  assert.strictEqual(T.resolve(T.ref(5, 0), colors), '#ed7d31');
  assert.strictEqual(T.resolve('#123456', colors), '#123456');
  assert.strictEqual(T.resolve('', colors), '');
  assert.strictEqual(T.resolve('t:1:0.5', colors), '#808080');
  assert.strictEqual(T.resolve('t:0:-0.5', colors), '#808080');
  assert.notStrictEqual(T.resolve('t:4:0.8', colors), '#4472c4');
  const ion = T.colorSet('Ion').c;
  assert.strictEqual(T.resolve('t:4:0', ion), '#b01513', 'same ref follows the theme');
});
t('fonts', () => {
  const f = T.fontSet('Office');
  assert.strictEqual(T.resolveFont('theme:heading', f), 'Calibri Light');
  assert.strictEqual(T.resolveFont('theme:body', f), 'Calibri');
  assert.strictEqual(T.resolveFont('Arial', f), 'Arial');
  assert.strictEqual(T.fontSet('nope').name, 'Tally');
});
t('tint rows', () => {
  assert.strictEqual(T.tintsFor(0).length, 5);
  assert.ok(T.tintsFor(1)[0] > 0 && T.tintsFor(0)[0] < 0);
  assert.deepStrictEqual(T.tintsFor(5), [0.8, 0.6, 0.4, -0.25, -0.5]);
});
console.log(passed + ' theme tests passed');
