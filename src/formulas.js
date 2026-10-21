/*
 * The formula finder's catalog: every formula with what it is for, how to write it and a worked example.
 * `result` is what the example gives on the sample sheet (see test/formulas.test.js, which checks every one).
 * Formulas marked soon:true are not in Tally yet; they are listed so people searching for them get an honest answer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TallyFormulas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [name, group, purpose, syntax, example, result, extra search words, soon]
  const RAW = [
    ['SUM', 'Totals', 'Add up numbers', 'SUM(range)', '=SUM(A1:A5)', '150', 'total add plus together amount sum all'],
    ['AVERAGE', 'Totals', 'Find the average of numbers', 'AVERAGE(range)', '=AVERAGE(A1:A5)', '30', 'mean avg typical'],
    ['COUNT', 'Totals', 'Count how many cells hold numbers', 'COUNT(range)', '=COUNT(A1:A5)', '5', 'how many number of'],
    ['COUNTA', 'Totals', 'Count cells that are not empty', 'COUNTA(range)', '=COUNTA(A1:B5)', '10', 'filled entries items non blank'],
    ['MAX', 'Totals', 'Find the biggest number', 'MAX(range)', '=MAX(A1:A5)', '50', 'highest largest top maximum'],
    ['MIN', 'Totals', 'Find the smallest number', 'MIN(range)', '=MIN(A1:A5)', '10', 'lowest least minimum'],
    ['MEDIAN', 'Totals', 'Find the middle number', 'MEDIAN(range)', '=MEDIAN(A1:A5)', '30', 'middle centre'],
    ['PRODUCT', 'Totals', 'Multiply numbers together', 'PRODUCT(range)', '=PRODUCT(A1:A3)', '6000', 'multiply times'],
    ['SUMIF', 'With a condition', 'Add only the numbers that match a condition', 'SUMIF(range, condition, sum_range)', '=SUMIF(B1:B5,"Tea",A1:A5)', '90', 'total where only matching sales of per item conditional'],
    ['COUNTIF', 'With a condition', 'Count the cells that match a condition', 'COUNTIF(range, condition)', '=COUNTIF(B1:B5,"Tea")', '3', 'how many where matching times appears'],
    ['IF', 'With a condition', 'Show one result or another, depending on a test', 'IF(test, if_true, if_false)', '=IF(A1>15,"High","Low")', 'Low', 'condition yes no paid unpaid pass fail decide choose otherwise'],
    ['IFERROR', 'With a condition', 'Show a friendly value when a formula gives an error', 'IFERROR(formula, value_if_error)', '=IFERROR(1/0,"n/a")', 'n/a', 'hide error div0 fix avoid'],
    ['AND', 'With a condition', 'Check that every test is true', 'AND(test1, test2, ...)', '=AND(A1>5,A2>5)', 'TRUE', 'all both together'],
    ['OR', 'With a condition', 'Check that at least one test is true', 'OR(test1, test2, ...)', '=OR(A1>100,A2>5)', 'TRUE', 'any either'],
    ['NOT', 'With a condition', 'Flip true to false and false to true', 'NOT(test)', '=NOT(A1>100)', 'TRUE', 'opposite reverse'],
    ['ROUND', 'Numbers', 'Round a number to some decimal places', 'ROUND(number, decimals)', '=ROUND(3.14159,2)', '3.14', 'decimals nearest paise cents'],
    ['INT', 'Numbers', 'Cut a number down to a whole number (rounds down)', 'INT(number)', '=INT(7.9)', '7', 'integer whole remove decimals floor'],
    ['ABS', 'Numbers', 'Make a number positive', 'ABS(number)', '=ABS(-5)', '5', 'absolute minus negative sign'],
    ['MOD', 'Numbers', 'Remainder after dividing', 'MOD(number, divisor)', '=MOD(10,3)', '1', 'modulo left over even odd divide'],
    ['POWER', 'Numbers', 'Raise a number to a power', 'POWER(number, power)', '=POWER(2,3)', '8', 'square cube exponent'],
    ['SQRT', 'Numbers', 'Square root of a number', 'SQRT(number)', '=SQRT(16)', '4', 'root'],
    ['PI', 'Numbers', 'The number pi (3.14159...)', 'PI()', '=PI()', '3.141593', 'circle'],
    ['LEFT', 'Text', 'Take letters from the start of text', 'LEFT(text, count)', '=LEFT(B2,2)', 'Ri', 'first characters beginning'],
    ['RIGHT', 'Text', 'Take letters from the end of text', 'RIGHT(text, count)', '=RIGHT(B2,2)', 'ce', 'last characters ending'],
    ['MID', 'Text', 'Take letters from the middle of text', 'MID(text, start, count)', '=MID(B2,2,2)', 'ic', 'middle characters substring part'],
    ['LEN', 'Text', 'Count the characters in text', 'LEN(text)', '=LEN(B2)', '4', 'length how long letters'],
    ['TRIM', 'Text', 'Remove extra spaces from text', 'TRIM(text)', '=TRIM(C1)', 'Hello World', 'clean spaces space blank'],
    ['UPPER', 'Text', 'Make text CAPITAL letters', 'UPPER(text)', '=UPPER(B1)', 'TEA', 'capital uppercase big letters'],
    ['LOWER', 'Text', 'Make text small letters', 'LOWER(text)', '=LOWER("TEA")', 'tea', 'lowercase small letters'],
    ['CONCAT', 'Text', 'Join text together', 'CONCAT(text1, text2, ...)', '=CONCAT(B1," - ",B2)', 'Tea - Rice', 'join combine merge ampersand'],
    ['CONCATENATE', 'Text', 'Join text together (older name of CONCAT)', 'CONCATENATE(text1, text2, ...)', '=CONCATENATE(B1," ",B2)', 'Tea Rice', 'join combine merge'],
    ['TEXT', 'Text', 'Show a number or date in a format you choose', 'TEXT(value, format)', '=TEXT(1234.5,"#,##0.00")', '1,234.50', 'format convert display date as text'],
    ['TODAY', 'Dates', 'Today’s date', 'TODAY()', '=TODAY()', '', 'current now date'],
    ['NOW', 'Dates', 'Today’s date and the current time', 'NOW()', '=NOW()', '', 'current time clock'],
    ['DATE', 'Dates', 'Build a date from a year, month and day', 'DATE(year, month, day)', '=DATE(2026,10,18)', '', 'make create calendar'],
    ['DAY', 'Dates', 'The day of the month from a date', 'DAY(date)', '=DAY(DATE(2026,10,18))', '18', ''],
    ['MONTH', 'Dates', 'The month number from a date', 'MONTH(date)', '=MONTH(DATE(2026,10,18))', '10', ''],
    ['YEAR', 'Dates', 'The year from a date', 'YEAR(date)', '=YEAR(DATE(2026,10,18))', '2026', ''],
    ['WEEKDAY', 'Dates', 'The day of the week as a number (1 = Sunday)', 'WEEKDAY(date)', '=WEEKDAY(DATE(2026,10,18))', '1', 'sunday monday day name'],
    ['ISNUMBER', 'Checks', 'Check whether a cell holds a number', 'ISNUMBER(value)', '=ISNUMBER(A1)', 'TRUE', 'is numeric test'],
    ['ISTEXT', 'Checks', 'Check whether a cell holds text', 'ISTEXT(value)', '=ISTEXT(B1)', 'TRUE', 'is words test'],
    ['ISBLANK', 'Checks', 'Check whether a cell is empty', 'ISBLANK(cell)', '=ISBLANK(E1)', 'TRUE', 'is empty test nothing'],
    ['ISERROR', 'Checks', 'Check whether a formula gave an error', 'ISERROR(value)', '=ISERROR(1/0)', 'TRUE', 'is error test'],

    // not in Tally yet
    ['VLOOKUP', 'Look up', 'Find a value in a table by its first column', 'VLOOKUP(find, table, column, FALSE)', '=VLOOKUP("Tea",A1:C9,2,FALSE)', '', 'search find price from list table match', true],
    ['XLOOKUP', 'Look up', 'Find a value in one column and return from another', 'XLOOKUP(find, look_in, return_from)', '=XLOOKUP("Tea",B:B,A:A)', '', 'search find price from list', true],
    ['INDEX', 'Look up', 'Get the value at a position in a range', 'INDEX(range, row, column)', '=INDEX(A1:A5,3)', '', 'position pick', true],
    ['MATCH', 'Look up', 'Find the position of a value in a list', 'MATCH(find, range, 0)', '=MATCH("Oil",B1:B5,0)', '', 'position where', true],
    ['SUMIFS', 'With a condition', 'Add numbers that match several conditions', 'SUMIFS(sum_range, range1, cond1, range2, cond2)', '=SUMIFS(A1:A5,B1:B5,"Tea",A1:A5,">10")', '', 'total where many multiple', true],
    ['COUNTIFS', 'With a condition', 'Count cells that match several conditions', 'COUNTIFS(range1, cond1, range2, cond2)', '=COUNTIFS(B1:B5,"Tea",A1:A5,">10")', '', 'how many multiple', true],
    ['AVERAGEIF', 'With a condition', 'Average only the numbers that match a condition', 'AVERAGEIF(range, condition, average_range)', '=AVERAGEIF(B1:B5,"Tea",A1:A5)', '', 'mean where', true],
    ['IFS', 'With a condition', 'Test several conditions in order', 'IFS(test1, result1, test2, result2)', '=IFS(A1>40,"A",A1>20,"B",TRUE,"C")', '', 'grade many if', true],
    ['ROUNDUP', 'Numbers', 'Round a number up', 'ROUNDUP(number, decimals)', '=ROUNDUP(3.141,2)', '', 'ceiling bill gst', true],
    ['ROUNDDOWN', 'Numbers', 'Round a number down', 'ROUNDDOWN(number, decimals)', '=ROUNDDOWN(3.999,2)', '', 'floor', true],
    ['CEILING', 'Numbers', 'Round up to a multiple', 'CEILING(number, multiple)', '=CEILING(7,5)', '', 'round up', true],
    ['FLOOR', 'Numbers', 'Round down to a multiple', 'FLOOR(number, multiple)', '=FLOOR(7,5)', '', 'round down', true],
    ['LARGE', 'Totals', 'The nth biggest number', 'LARGE(range, n)', '=LARGE(A1:A5,2)', '', 'second highest top', true],
    ['SMALL', 'Totals', 'The nth smallest number', 'SMALL(range, n)', '=SMALL(A1:A5,2)', '', 'second lowest bottom', true],
    ['RANK', 'Totals', 'The position of a number in a list', 'RANK(number, range)', '=RANK(A2,A1:A5)', '', 'position order rank first', true],
    ['SUBSTITUTE', 'Text', 'Replace some text with other text', 'SUBSTITUTE(text, old, new)', '=SUBSTITUTE(B1,"T","t")', '', 'replace change swap', true],
    ['FIND', 'Text', 'Find where a piece of text starts', 'FIND(find, text)', '=FIND("e",B1)', '', 'position search locate', true],
    ['SEARCH', 'Text', 'Find text, ignoring capital letters', 'SEARCH(find, text)', '=SEARCH("e",B1)', '', 'position locate', true],
    ['TEXTJOIN', 'Text', 'Join many cells with a separator', 'TEXTJOIN(separator, ignore_empty, range)', '=TEXTJOIN(", ",TRUE,B1:B5)', '', 'join combine list', true],
    ['PROPER', 'Text', 'Capitalise The First Letter Of Each Word', 'PROPER(text)', '=PROPER("hello world")', '', 'title case names', true],
    ['DATEDIF', 'Dates', 'Days, months or years between two dates', 'DATEDIF(start, end, "D")', '=DATEDIF(A1,A2,"D")', '', 'age difference between due', true],
    ['EDATE', 'Dates', 'A date some months before or after another', 'EDATE(date, months)', '=EDATE(D1,3)', '', 'add months due date', true],
    ['EOMONTH', 'Dates', 'The last day of a month', 'EOMONTH(date, months)', '=EOMONTH(D1,0)', '', 'month end', true],
    ['NETWORKDAYS', 'Dates', 'Working days between two dates', 'NETWORKDAYS(start, end)', '=NETWORKDAYS(A1,A2)', '', 'business days attendance', true],
    ['UNIQUE', 'Lists', 'List each value only once', 'UNIQUE(range)', '=UNIQUE(B1:B5)', '', 'distinct duplicates remove', true],
    ['SORT', 'Lists', 'Sort a list', 'SORT(range)', '=SORT(A1:A5)', '', 'order ascending descending', true],
    ['FILTER', 'Lists', 'Keep only the rows that match', 'FILTER(range, test)', '=FILTER(A1:A5,A1:A5>20)', '', 'only where show matching', true]
  ];

  const FORMULAS = RAW.map(([name, group, purpose, syntax, example, result, words, soon]) => ({
    name, group, purpose, syntax, example, result, words: words || '', soon: !!soon
  }));

  const GROUP_ORDER = ['Totals', 'With a condition', 'Numbers', 'Text', 'Dates', 'Checks', 'Look up', 'Lists'];

  // Best matches first. Every word typed must appear in the name, purpose or search words.
  function search(query, list) {
    list = list || FORMULAS;
    const q = String(query || '').trim().toLowerCase().replace(/^=/, '');
    const out = [];
    if (!q) {
      return list.slice().sort((a, b) => (a.soon - b.soon) || (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)));
    }
    const words = q.split(/[^a-z0-9]+/).filter(Boolean);
    list.forEach((f, i) => {
      const name = f.name.toLowerCase();
      const has = (text, w) => new RegExp('\\b' + w).test(text.toLowerCase());
      let score = 0;
      if (name === q) score += 100;
      else if (name.startsWith(q)) score += 80;
      else if (name.includes(q)) score += 60;
      let all = true;
      for (const w of words) {
        if (name.includes(w)) score += 5;
        else if (has(f.words, w)) score += 10;
        else if (has(f.purpose, w)) score += 8;
        else if (has(f.group, w)) score += 2;
        else all = false;
      }
      if (!all && score < 60) return;
      if (f.soon) score -= 1000;
      out.push({ f, score, i });
    });
    out.sort((a, b) => b.score - a.score || a.i - b.i);
    return out.map((x) => x.f);
  }

  return { FORMULAS, GROUP_ORDER, search };
});
