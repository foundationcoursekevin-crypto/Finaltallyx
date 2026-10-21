'use strict';
const assert = require('assert');
const N = require('../src/numfmt.js');
let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL:', name, '\n  ', e.message); process.exitCode = 1; } }
const f = (v, code) => N.format(v, code).text;

t('basic numbers', () => {
  assert.strictEqual(f(3.14159, '0.00'), '3.14');
  assert.strictEqual(f(1234567, '#,##0'), '1,234,567');
  assert.strictEqual(f(-1234.5, '#,##0.00'), '-1,234.50');
  assert.strictEqual(f(5, '000'), '005');
  assert.strictEqual(f(0.5, '#.##'), '.5');
  assert.strictEqual(f(0.5, '0.#'), '0.5');
  assert.strictEqual(f(2, '0.0#'), '2.0');
  assert.strictEqual(f(1.005, '0.00'), '1.01');
  assert.strictEqual(f(999.999, '0.00'), '1000.00');
  assert.strictEqual(f(0, '0.00'), '0.00');
});
t('percent and scale', () => {
  assert.strictEqual(f(0.256, '0%'), '26%');
  assert.strictEqual(f(0.256, '0.0%'), '25.6%');
  assert.strictEqual(f(1234, '0.0,'), '1.2');
  assert.strictEqual(f(1234567, '0.0,,"M"'), '1.2M');
});
t('currency and negatives', () => {
  assert.strictEqual(f(1234.5, '$#,##0.00'), '$1,234.50');
  assert.strictEqual(f(-1234.5, '$#,##0.00'), '-$1,234.50');
  assert.strictEqual(f(-1234.5, '$#,##0.00_);($#,##0.00)'), '($1,234.50)');
  const r = N.format(-5, '0.00;[Red]0.00');
  assert.strictEqual(r.text, '5.00');
  assert.strictEqual(r.color, N.COLORS.red);
  assert.strictEqual(f(0, '0;-0;"zero"'), 'zero');
});
t('accounting fill marker', () => {
  const s = f(1234.5, N.ACCOUNTING('$', 2));
  assert.ok(s.indexOf(N.FILL) > 0 && s.indexOf('1,234.50') > 0, JSON.stringify(s));
  assert.ok(f(0, N.ACCOUNTING('$', 2)).indexOf('-') > 0);
  assert.ok(/\(1,234\.50\)/.test(f(-1234.5, N.ACCOUNTING('$', 2))));
});
t('scientific', () => {
  assert.strictEqual(f(12345, '0.00E+00'), '1.23E+04');
  assert.strictEqual(f(0.00012, '0.0E+00'), '1.2E-04');
  assert.strictEqual(f(0, '0.00E+00'), '0.00E+00');
});
t('fractions', () => {
  assert.strictEqual(f(0.75, '# ?/?'), '3/4');
  assert.strictEqual(f(3.5, '# ?/?'), '3 1/2');
  assert.strictEqual(f(3, '# ?/?'), '3');
  assert.strictEqual(f(0.3333, '# ?/?'), '1/3');
  assert.strictEqual(f(0.5, '# ?/4'), '2/4');
  assert.strictEqual(f(2.25, '# ?/8'), '2 2/8');
});
t('dates', () => {
  const s = N.dateToSerial(2023, 3, 15);
  assert.strictEqual(s, 45000);
  assert.strictEqual(f(45000, 'm/d/yyyy'), '3/15/2023');
  assert.strictEqual(f(45000, 'yyyy-mm-dd'), '2023-03-15');
  assert.strictEqual(f(45000, 'dddd, mmmm d, yyyy'), 'Wednesday, March 15, 2023');
  assert.strictEqual(f(45000, 'd-mmm-yy'), '15-Mar-23');
  assert.strictEqual(f(45000, 'mmm'), 'Mar');
  assert.strictEqual(f(45000, 'mmmmm'), 'M');
});
t('times', () => {
  assert.strictEqual(f(0.75, 'h:mm AM/PM'), '6:00 PM');
  assert.strictEqual(f(0.5, 'h:mm:ss AM/PM'), '12:00:00 PM');
  assert.strictEqual(f(0.25, 'hh:mm'), '06:00');
  assert.strictEqual(f(45000.5, 'm/d/yyyy h:mm'), '3/15/2023 12:00');
  assert.strictEqual(f(1.5, '[h]:mm:ss'), '36:00:00');
  assert.strictEqual(f(0.0007, 'mm:ss'), '01:00');
});
t('text and literals', () => {
  assert.strictEqual(f('abc', '@'), 'abc');
  assert.strictEqual(f('abc', '"Name: "@'), 'Name: abc');
  assert.strictEqual(f('abc', '0.00'), 'abc');
  assert.strictEqual(f(5551234567, '(###) ###-####'), '(555) 123-4567');
  assert.strictEqual(f(5, '0 "units"'), '5 units');
  assert.strictEqual(f(1234.5, 'General'), '1234.5');
  assert.strictEqual(f(5, '[>=5]"big";"small"'), 'big');
  assert.strictEqual(f(4, '[>=5]"big";"small"'), 'small');
});
t('typed values', () => {
  assert.deepStrictEqual(N.parseTyped('50%'), { value: 0.5, nf: '0%' });
  assert.deepStrictEqual(N.parseTyped('12.5%'), { value: 0.125, nf: '0.0%' });
  assert.deepStrictEqual(N.parseTyped('$1,234.50'), { value: 1234.5, nf: '$#,##0.00' });
  assert.deepStrictEqual(N.parseTyped('1,234'), { value: 1234, nf: '#,##0' });
  assert.deepStrictEqual(N.parseTyped('3/15/2023'), { value: 45000, nf: 'm/d/yyyy' });
  assert.deepStrictEqual(N.parseTyped('2023-03-15'), { value: 45000, nf: 'm/d/yyyy' });
  assert.deepStrictEqual(N.parseTyped('15-Mar-2023'), { value: 45000, nf: 'd-mmm-yy' });
  assert.deepStrictEqual(N.parseTyped('6:00 PM'), { value: 0.75, nf: 'h:mm AM/PM' });
  assert.deepStrictEqual(N.parseTyped('13:30'), { value: 13.5 / 24, nf: 'h:mm' });
  assert.strictEqual(N.parseTyped('13/45/2023'), null);
  assert.strictEqual(N.parseTyped('hello'), null);
  assert.strictEqual(N.parseTyped('25:00'), null);
});
t('decimals buttons', () => {
  assert.strictEqual(N.adjustDecimals('General', 1, 3), '0.0');
  assert.strictEqual(N.adjustDecimals('General', 1, 3.14), '0.000');
  assert.strictEqual(N.adjustDecimals('0.00', 1), '0.000');
  assert.strictEqual(N.adjustDecimals('0.00', -1), '0.0');
  assert.strictEqual(N.adjustDecimals('0.0', -1), '0');
  assert.strictEqual(N.adjustDecimals('#,##0', 1), '#,##0.0');
  assert.strictEqual(N.adjustDecimals('$#,##0.00', -2), '$#,##0');
  assert.strictEqual(N.adjustDecimals('0.00%', -1), '0.0%');
  assert.strictEqual(N.adjustDecimals('0.00;[Red]0.00', 1), '0.000;[Red]0.000');
  assert.strictEqual(N.adjustDecimals('m/d/yyyy', 1), 'm/d/yyyy');
});
t('categories round trip', () => {
  for (const [cat, o] of [['Number', { decimals: 2, thousands: true, neg: 0 }], ['Number', { decimals: 0, thousands: false, neg: 3 }], ['Currency', { decimals: 2, symbol: '$', neg: 1 }], ['Currency', { decimals: 0, symbol: '€', neg: 2 }], ['Percentage', { decimals: 1 }], ['Scientific', { decimals: 3 }], ['Date', { type: 'd-mmm-yy' }], ['Time', { type: 'h:mm' }], ['Fraction', { type: '# ?/8' }], ['Accounting', { decimals: 2, symbol: '$' }], ['Text', {}], ['General', {}]]) {
    const code = N.buildCode(cat, o);
    const d = N.detectCategory(code);
    assert.strictEqual(d.cat, cat, cat + ' -> ' + code + ' -> ' + d.cat);
  }
  assert.strictEqual(N.detectCategory('0.0,"K"').cat, 'Custom');
});
console.log(passed + ' numfmt tests passed');
