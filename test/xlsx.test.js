'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const X = require('../src/xlsx.js');

let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; } catch (e) { console.error('FAIL', name, '\n', e); process.exit(1); }
};
const fx = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));
const at = (m, r, c) => m.cells.find((x) => x.r === r && x.c === c);

(async () => {
  await t('reads values, formulas, text and dates', async () => {
    const m = await X.read(fx('sales.xlsx'));
    assert.strictEqual(m.sheetName, 'Sales');
    assert.deepStrictEqual(m.sheetNames, ['Sales', 'Other']);
    assert.strictEqual(at(m, 0, 0).raw, 'Item');
    assert.strictEqual(at(m, 1, 1).raw, '4');
    assert.strictEqual(at(m, 1, 2).raw, '52.5');
    assert.strictEqual(at(m, 1, 3).raw, '=B2*C2');
    assert.strictEqual(at(m, 3, 0).raw, 'Tea, "green"');
    assert.strictEqual(at(m, 4, 0).raw, "'007", '007 must stay text');
    assert.strictEqual(at(m, 6, 3).raw, '=SUM(D2:D5)');
    assert.strictEqual(at(m, 7, 0).raw, 'TRUE');
    assert.strictEqual(at(m, 7, 1).raw, '=A1&" ok"');
    assert.strictEqual(at(m, 0, 5).raw, "'#N/A");
    const d = m.fmts[at(m, 1, 4).xf];
    assert.strictEqual(d.nf, 'dd-mmm-yyyy');
    assert.ok(Number(at(m, 1, 4).raw) > 46000, 'date is a serial number');
  });
  await t('reads formats, merges and sizes', async () => {
    const m = await X.read(fx('sales.xlsx'));
    const h = m.fmts[at(m, 0, 0).xf];
    assert.strictEqual(h.b, true);
    assert.strictEqual(h.bg, '#4b33e8');
    assert.strictEqual(h.color, '#ffffff');
    const tot = m.fmts[at(m, 6, 3).xf];
    assert.ok(tot.b && tot.i && tot.u);
    assert.strictEqual(tot.bd.t.s, 'medium');
    assert.strictEqual(tot.bd.t.c, '#ff0000');
    assert.strictEqual(m.fmts[at(m, 1, 2).xf].nf, '#,##0.00');
    assert.strictEqual(m.fmts[at(m, 1, 5).xf].nf, '0.0%');
    const mg = m.fmts[at(m, 8, 0).xf];
    assert.ok(mg.align === 'center' && mg.wrap && mg.va === 'middle');
    assert.deepStrictEqual(m.merges, [{ r1: 8, c1: 0, r2: 8, c2: 2 }]);
    assert.strictEqual(m.colWidths[0], Math.round(20 * 7 + 5));
    assert.strictEqual(m.rowHeights[2], 40);
  });
  await t('shared formulas and shared strings', async () => {
    const m = await X.read(fx('shared.xlsx'));
    assert.strictEqual(at(m, 0, 0).raw, 'Fish & Chips');
    assert.strictEqual(at(m, 0, 1).raw, 'Rich text');
    assert.strictEqual(at(m, 1, 2).raw, '=C1*2+$A$1');
    assert.strictEqual(at(m, 2, 2).raw, '=C2*2+$A$1');
    assert.strictEqual(at(m, 3, 2).raw, '=C3*2+$A$1');
  });
  await t('shiftFormula leaves strings and functions alone', async () => {
    assert.strictEqual(X.shiftFormula('SUM(A1:B2)+LOG10(C3)&"A1"', 1, 1), 'SUM(B2:C3)+LOG10(D4)&"A1"');
    assert.strictEqual(X.shiftFormula("'My Sheet'!A1+$B$2+C$3", 2, 0), "'My Sheet'!A3+$B$2+C$3");
  });
  await t('write then read gives the same sheet', async () => {
    const bytes = await X.write({
      sheetName: 'Check', defaultColPx: 96, defaultRowPx: 24,
      cells: [{ r: 0, c: 0, v: 'Hello & <you>' }, { r: 0, c: 1, v: 12.5 }, { r: 1, c: 1, v: 25, f: 'B1*2' }, { r: 2, c: 0, v: true }, { r: 2, c: 1, v: 'x', f: 'A1' }, { r: 3, c: 0, v: { error: '#DIV/0!' }, f: '1/0' }],
      fmts: [{ r: 0, c: 1, fmt: { b: true, nf: '0.00', bg: '#ffcc00', color: '#112233', align: 'right', bd: { b: { s: 'thin' } } } }],
      colWidths: { 0: 140, 1: 96 }, rowHeights: { 1: 36 }, merges: [{ r1: 5, c1: 0, r2: 5, c2: 2 }]
    });
    assert.strictEqual(String.fromCharCode(bytes[0], bytes[1]), 'PK');
    const m = await X.read(bytes);
    assert.strictEqual(at(m, 0, 0).raw, 'Hello & <you>');
    assert.strictEqual(at(m, 0, 1).raw, '12.5');
    assert.strictEqual(at(m, 1, 1).raw, '=B1*2');
    assert.strictEqual(at(m, 2, 0).raw, 'TRUE');
    const f = m.fmts[at(m, 0, 1).xf];
    assert.ok(f.b && f.nf === '0.00' && f.bg === '#ffcc00' && f.color === '#112233' && f.align === 'right' && f.bd.b.s === 'thin');
    assert.strictEqual(m.colWidths[0], Math.round(((140 - 5) / 7).toFixed(2) * 7 + 5));
    assert.strictEqual(m.rowHeights[1], 36);
    assert.deepStrictEqual(m.merges, [{ r1: 5, c1: 0, r2: 5, c2: 2 }]);
  });
  await t('rejects files that are not xlsx', async () => {
    await assert.rejects(() => X.read(new Uint8Array([1, 2, 3, 4, 5])), /not an Excel/);
  });
  console.log(passed + ' xlsx tests passed');
})();
