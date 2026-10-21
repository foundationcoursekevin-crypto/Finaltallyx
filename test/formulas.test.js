'use strict';
const assert = require('assert');
const E = require('../src/engine.js');
const F = require('../src/formulas.js');

const sample = () => {
  const s = new E.Sheet({ rows: 50, cols: 26 });
  ['10', '20', '30', '40', '50'].forEach((v, i) => s.setRaw('A' + (i + 1), v));
  ['Tea', 'Rice', 'Tea', 'Oil', 'Tea'].forEach((v, i) => s.setRaw('B' + (i + 1), v));
  s.setRaw('C1', '  Hello   World  ');
  return s;
};
const show = (v) => {
  if (v instanceof E.XlError) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6);
  return v === null ? '' : String(v);
};

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exit(1); } };

t('every working formula example gives the documented result', () => {
  for (const f of F.FORMULAS.filter((x) => !x.soon)) {
    const s = sample();
    s.setRaw('Z1', f.example);
    const got = show(s.getValue('Z1'));
    if (f.result !== '') assert.strictEqual(got, f.result, f.name + ' ' + f.example);
    else assert.ok(!/^#/.test(got), f.name + ' gave ' + got);
  }
});
t('formulas marked soon really are missing (flip the flag when you add one)', () => {
  for (const f of F.FORMULAS.filter((x) => x.soon)) {
    const s = sample();
    s.setRaw('Z1', f.example);
    assert.strictEqual(show(s.getValue('Z1')), '#NAME?', f.name + ' now works: set soon:false and add its result');
  }
});
t('every function Tally has is in the catalog', () => {
  const have = new Set(F.FORMULAS.map((x) => x.name));
  for (const n of [...Object.keys(E.FUNCS), 'IF', 'IFERROR', 'ISERROR', 'ISNUMBER', 'ISTEXT', 'ISBLANK']) assert.ok(have.has(n), n + ' missing from the formula finder');
});
t('search finds formulas by purpose in plain words', () => {
  const top = (q) => F.search(q)[0].name;
  assert.strictEqual(top('total'), 'SUM');
  assert.strictEqual(top('sum'), 'SUM');
  assert.strictEqual(top('how many'), 'COUNT');
  assert.strictEqual(top('biggest'), 'MAX');
  assert.strictEqual(top('=if'), 'IF');
  assert.ok(F.search('paid unpaid').some((f) => f.name === 'IF'));
  assert.ok(F.search('join').slice(0, 2).every((f) => /CONCAT/.test(f.name)));
  assert.ok(F.search('remove spaces').some((f) => f.name === 'TRIM'));
  assert.strictEqual(F.search('lookup')[0].name, 'VLOOKUP');
  assert.ok(F.search('lookup')[0].soon);
  assert.deepStrictEqual(F.search('zzzzqq'), []);
});
t('working formulas rank above coming-soon ones', () => {
  const r = F.search('total');
  const firstSoon = r.findIndex((f) => f.soon);
  assert.ok(firstSoon === -1 || r.slice(0, firstSoon).every((f) => !f.soon));
  assert.ok(F.search('').slice(0, 43).every((f) => !f.soon));
});
console.log(passed + ' formula finder tests passed');
