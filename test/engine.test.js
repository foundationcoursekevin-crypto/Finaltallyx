'use strict';
const assert = require('assert');
const E = require('../src/engine.js');
const H = require('../src/helpers.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error('FAIL:', name, '\n  ', e.message);
    process.exitCode = 1;
  }
}

function mk(cells) {
  const s = new E.Sheet({ rows: 50, cols: 26 });
  for (const k of Object.keys(cells)) s.setRaw(k, cells[k]);
  return s;
}
const val = (s, k) => {
  const v = s.getValue(k);
  return v instanceof E.XlError ? v.code : v;
};

test('literals', () => {
  const s = mk({ A1: '12', A2: '-3.5', A3: '50%', A4: 'hello', A5: 'TRUE', A6: "'123" });
  assert.strictEqual(val(s, 'A1'), 12);
  assert.strictEqual(val(s, 'A2'), -3.5);
  assert.strictEqual(val(s, 'A3'), 0.5);
  assert.strictEqual(val(s, 'A4'), 'hello');
  assert.strictEqual(val(s, 'A5'), true);
  assert.strictEqual(val(s, 'A6'), '123');
});

test('arithmetic and precedence', () => {
  const s = mk({ A1: '=1+2*3', A2: '=(1+2)*3', A3: '=-2^2', A4: '=2^3^2', A5: '=10/4', A6: '=50%*200', A7: '=2^-1' });
  assert.strictEqual(val(s, 'A1'), 7);
  assert.strictEqual(val(s, 'A2'), 9);
  assert.strictEqual(val(s, 'A3'), 4); // Excel: unary minus binds tighter than ^
  assert.strictEqual(val(s, 'A4'), 64); // left-assoc, like Excel
  assert.strictEqual(val(s, 'A5'), 2.5);
  assert.strictEqual(val(s, 'A6'), 100);
  assert.strictEqual(val(s, 'A7'), 0.5);
});

test('references and recalculation', () => {
  const s = mk({ A1: '1', A2: '2', A3: '=A1+A2', A4: '=A3*10' });
  assert.strictEqual(val(s, 'A4'), 30);
  s.setRaw('A1', '5');
  assert.strictEqual(val(s, 'A3'), 7);
  assert.strictEqual(val(s, 'A4'), 70);
  s.setRaw('A3', '100'); // formula replaced by constant
  assert.strictEqual(val(s, 'A4'), 1000);
  s.setRaw('A1', '9');
  assert.strictEqual(val(s, 'A3'), 100);
});

test('forward reference to empty cell updates when filled', () => {
  const s = mk({ A1: '=B1+1' });
  assert.strictEqual(val(s, 'A1'), 1);
  s.setRaw('B1', '4');
  assert.strictEqual(val(s, 'A1'), 5);
});

test('ranges and aggregates', () => {
  const s = mk({ A1: '1', A2: '2', A3: '3', A4: 'x', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A3)', B3: '=MIN(A1:A4)', B4: '=MAX(A1:A4)', B5: '=COUNT(A1:A4)', B6: '=COUNTA(A1:A4)', B7: '=SUM(A1:A3, 10)', B8: '=MEDIAN(A1:A3)' });
  assert.strictEqual(val(s, 'B1'), 6);
  assert.strictEqual(val(s, 'B2'), 2);
  assert.strictEqual(val(s, 'B3'), 1);
  assert.strictEqual(val(s, 'B4'), 3);
  assert.strictEqual(val(s, 'B5'), 3);
  assert.strictEqual(val(s, 'B6'), 4);
  assert.strictEqual(val(s, 'B7'), 16);
  assert.strictEqual(val(s, 'B8'), 2);
  s.setRaw('A2', '20');
  assert.strictEqual(val(s, 'B1'), 24);
});

test('SUM over a text cell reference ignores it, literal text errors', () => {
  const s = mk({ A1: 'abc', A2: '4', B1: '=SUM(A1,A2)', B2: '=SUM("abc",1)' });
  assert.strictEqual(val(s, 'B1'), 4);
  assert.strictEqual(val(s, 'B2'), '#VALUE!');
});

test('errors', () => {
  const s = mk({ A1: '=1/0', A2: '=A1+1', A3: '=FOO(1)', A4: '=1+', A5: '=IFERROR(1/0,"n/a")', A6: '=SQRT(-1)', A7: '=Z999', A8: '=ISERROR(A1)' });
  assert.strictEqual(val(s, 'A1'), '#DIV/0!');
  assert.strictEqual(val(s, 'A2'), '#DIV/0!');
  assert.strictEqual(val(s, 'A3'), '#NAME?');
  assert.strictEqual(val(s, 'A4'), '#ERROR!');
  assert.strictEqual(val(s, 'A5'), 'n/a');
  assert.strictEqual(val(s, 'A6'), '#NUM!');
  assert.strictEqual(val(s, 'A7'), '#REF!');
  assert.strictEqual(val(s, 'A8'), true);
});

test('circular references', () => {
  const s = mk({ A1: '=B1', B1: '=A1', C1: '=C1+1' });
  assert.strictEqual(val(s, 'A1'), '#CIRC!');
  assert.strictEqual(val(s, 'B1'), '#CIRC!');
  assert.strictEqual(val(s, 'C1'), '#CIRC!');
  s.setRaw('B1', '7'); // break the cycle
  assert.strictEqual(val(s, 'A1'), 7);
});

test('IF is lazy', () => {
  const s = mk({ A1: '=IF(1>0,"yes",1/0)', A2: '=IF(1<0,1/0,"no")', A3: '=IF(FALSE,1)', A4: '=IF(AND(1<2,2<3),1,0)', A5: '=IF(OR(1>2,2>3),1,0)' });
  assert.strictEqual(val(s, 'A1'), 'yes');
  assert.strictEqual(val(s, 'A2'), 'no');
  assert.strictEqual(val(s, 'A3'), false);
  assert.strictEqual(val(s, 'A4'), 1);
  assert.strictEqual(val(s, 'A5'), 0);
});

test('comparison and text', () => {
  const s = mk({ A1: '="a"="A"', A2: '="b">"a"', A3: '="x"&"y"&1', A4: '=UPPER("abc")', A5: '=LEFT("hello",2)', A6: '=RIGHT("hello",3)', A7: '=MID("hello",2,3)', A8: '=LEN(" a ")', A9: '=TRIM("  a   b ")', A10: '=1<>2' });
  assert.strictEqual(val(s, 'A1'), true);
  assert.strictEqual(val(s, 'A2'), true);
  assert.strictEqual(val(s, 'A3'), 'xy1');
  assert.strictEqual(val(s, 'A4'), 'ABC');
  assert.strictEqual(val(s, 'A5'), 'he');
  assert.strictEqual(val(s, 'A6'), 'llo');
  assert.strictEqual(val(s, 'A7'), 'ell');
  assert.strictEqual(val(s, 'A8'), 3);
  assert.strictEqual(val(s, 'A9'), 'a b');
  assert.strictEqual(val(s, 'A10'), true);
});

test('math functions', () => {
  const s = mk({ A1: '=ROUND(2.5,0)', A2: '=ROUND(-2.5,0)', A3: '=ROUND(1.005,2)', A4: '=ROUND(1234,-2)', A5: '=MOD(-3,2)', A6: '=INT(-1.5)', A7: '=ABS(-4)', A8: '=POWER(2,10)', A9: '=PRODUCT(2,3,4)', A10: '=PI()' });
  assert.strictEqual(val(s, 'A1'), 3);
  assert.strictEqual(val(s, 'A2'), -3);
  assert.strictEqual(val(s, 'A3'), 1.01);
  assert.strictEqual(val(s, 'A4'), 1200);
  assert.strictEqual(val(s, 'A5'), 1);
  assert.strictEqual(val(s, 'A6'), -2);
  assert.strictEqual(val(s, 'A7'), 4);
  assert.strictEqual(val(s, 'A8'), 1024);
  assert.strictEqual(val(s, 'A9'), 24);
  assert.strictEqual(val(s, 'A10'), Math.PI);
});

test('SUMIF / COUNTIF', () => {
  const s = mk({ A1: 'apple', A2: 'banana', A3: 'apple', A4: 'cherry', B1: '1', B2: '2', B3: '3', B4: '4', C1: '=SUMIF(A1:A4,"apple",B1:B4)', C2: '=COUNTIF(A1:A4,"a*")', C3: '=COUNTIF(B1:B4,">2")', C4: '=SUMIF(B1:B4,"<=2")', C5: '=COUNTIF(A1:A4,"<>apple")' });
  assert.strictEqual(val(s, 'C1'), 4);
  assert.strictEqual(val(s, 'C2'), 2);
  assert.strictEqual(val(s, 'C3'), 2);
  assert.strictEqual(val(s, 'C4'), 3);
  assert.strictEqual(val(s, 'C5'), 2);
});

test('function name that looks like a cell (LOG10-style) parses as function', () => {
  const toks = E.tokenize('ATAN2(1,2)+A1');
  assert.strictEqual(toks[0].t, 'func');
});

test('shiftFormula keeps absolute refs and strings', () => {
  assert.strictEqual(E.shiftFormula('=A1+B2', 1, 1), '=B2+C3');
  assert.strictEqual(E.shiftFormula('=$A$1+B2', 2, 3), '=$A$1+E4');
  assert.strictEqual(E.shiftFormula('=$A1+B$2', 2, 3), '=$A3+E$2');
  assert.strictEqual(E.shiftFormula('=SUM(A1:A3)', 0, 1), '=SUM(B1:B3)');
  assert.strictEqual(E.shiftFormula('="A1"&A1', 1, 0), '="A1"&A2');
  assert.strictEqual(E.shiftFormula('=A1', -1, 0), '=#REF!');
  assert.strictEqual(E.shiftFormula('plain', 1, 1), 'plain');
  const s = mk({ A1: '=A2', A2: '5' });
  s.setRaw('B1', E.shiftFormula(s.getRaw('A1'), 0, 1));
  assert.strictEqual(s.getRaw('B1'), '=B2');
});

test('#REF! in a pasted formula evaluates to #REF!', () => {
  const s = mk({ A1: '=#REF!+1' });
  assert.strictEqual(val(s, 'A1'), '#REF!');
});

test('addresses', () => {
  assert.strictEqual(E.colToName(0), 'A');
  assert.strictEqual(E.colToName(25), 'Z');
  assert.strictEqual(E.colToName(26), 'AA');
  assert.strictEqual(E.nameToCol('AA'), 26);
  assert.deepStrictEqual(E.parseKey('B3'), { r: 2, c: 1 });
});

test('wide range dependency invalidation', () => {
  const s = mk({ A1: '1', A2: '1', A3: '=SUM(A1:A2)', B1: '=A3*2' });
  assert.strictEqual(val(s, 'B1'), 4);
  s.setRaw('A2', '9');
  assert.strictEqual(val(s, 'B1'), 20);
});

test('formatValue', () => {
  assert.strictEqual(H.formatValue(1234.5, 'number').text, '1,234.50');
  assert.strictEqual(H.formatValue(1234.5, 'currency').text, '$1,234.50');
  assert.strictEqual(H.formatValue(0.256, 'percent').text, '25.60%');
  assert.strictEqual(H.formatValue(0.256, '0.0%').text, '25.6%');
  assert.strictEqual(H.formatValue(45000, 'm/d/yyyy').text, '3/15/2023');
  assert.strictEqual(H.formatValue(0.1 + 0.2).text, '0.3');
  assert.strictEqual(H.formatValue(true).text, 'TRUE');
  assert.strictEqual(H.formatValue(new E.XlError('#N/A')).kind, 'error');
  assert.strictEqual(H.formatValue(null).kind, 'empty');
  assert.strictEqual(H.formatValue(1 / 3).text, '0.3333333333');
});

test('csv round trip', () => {
  const rows = [['a', 'b,c', 'd"e'], ['1', '', 'line\nbreak']];
  const text = H.toCSV(rows);
  assert.deepStrictEqual(H.parseCSV(text), rows);
  assert.deepStrictEqual(H.parseCSV('x;y\n1;2\n'), [['x', 'y'], ['1', '2']]);
  assert.deepStrictEqual(H.parseCSV('\uFEFFa,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('tsv', () => {
  assert.deepStrictEqual(H.parseTSV('a\tb\r\n1\t2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.strictEqual(H.toTSV([['a', 'b'], ['1', '2']]), 'a\tb\n1\t2');
});

test('chartData: header + labels', () => {
  const s = mk({ A1: 'Month', B1: 'Sales', C1: 'Cost', A2: 'Jan', B2: '10', C2: '4', A3: 'Feb', B3: '20', C3: '5' });
  const d = H.chartData(s, { r1: 0, c1: 0, r2: 2, c2: 2 });
  assert.deepStrictEqual(d.cats, ['Jan', 'Feb']);
  assert.strictEqual(d.series.length, 2);
  assert.strictEqual(d.series[0].name, 'Sales');
  assert.deepStrictEqual(d.series[1].values, [4, 5]);
});

test('chartData: numbers only', () => {
  const s = mk({ A1: '3', A2: '4', A3: '5' });
  const d = H.chartData(s, { r1: 0, c1: 0, r2: 2, c2: 0 });
  assert.deepStrictEqual(d.cats, ['1', '2', '3']);
  assert.strictEqual(d.series[0].name, 'Series 1');
});

test('currentRegion', () => {
  const s = mk({ B2: 'a', C2: 'b', B3: 'c', C3: 'd', F9: 'z' });
  assert.deepStrictEqual(H.currentRegion(s, 1, 1), { r1: 1, c1: 1, r2: 2, c2: 2 });
  assert.deepStrictEqual(H.currentRegion(s, 8, 5), { r1: 8, c1: 5, r2: 8, c2: 5 });
});

console.log(passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));

// ---- dates, TEXT and typed values ----
const eq = assert.strictEqual;
test('typed dates parse to serials', () => {
  const s = mk({ A1: '3/15/2023', A2: '=A1+1', A3: '6:00 PM', A4: '$1,234.50', A5: '1,234', A6: '=YEAR(A1)', A7: '=MONTH(A1)', A8: '=DAY(A1)', A9: '=WEEKDAY(A1)', A10: '=DATE(2023,3,15)', A11: '=DATE(2023,14,1)' });
  eq(val(s, 'A1'), 45000);
  eq(val(s, 'A2'), 45001);
  eq(val(s, 'A3'), 0.75);
  eq(val(s, 'A4'), 1234.5);
  eq(val(s, 'A5'), 1234);
  eq(val(s, 'A6'), 2023);
  eq(val(s, 'A7'), 3);
  eq(val(s, 'A8'), 15);
  eq(val(s, 'A9'), 4);
  eq(val(s, 'A10'), 45000);
  eq(val(s, 'A11'), 45323); // month 14 rolls into Feb of the next year
});
test('TEXT and auto format inference', () => {
  const s = mk({ A1: '=TEXT(1234.5,"#,##0.00")', A2: '=TEXT(45000,"yyyy-mm-dd")', A3: '=TEXT(0.256,"0.0%")', A4: '=TEXT("7","000")' });
  eq(val(s, 'A1'), '1,234.50');
  eq(val(s, 'A2'), '2023-03-15');
  eq(val(s, 'A3'), '25.6%');
  eq(val(s, 'A4'), '007');
  eq(E.inferFormat('3/15/2023'), 'm/d/yyyy');
  eq(E.inferFormat('50%'), '0%');
  eq(E.inferFormat('hello'), null);
  eq(E.inferFormat('12'), null);
  eq(E.inferFormat("'3/15/2023"), null);
});
console.log('engine tests done: ' + passed);
