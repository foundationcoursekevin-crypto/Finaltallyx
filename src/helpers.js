/*
 * Tally helpers: display formatting, CSV/TSV, chart data. No DOM access.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./numfmt.js'));
  else root.TallyHelpers = factory(root.TallyEngine, root.TallyNumFmt);
})(typeof self !== 'undefined' ? self : this, function (E, NumFmt) {
  'use strict';

  const { XlError, key, numToStr } = E;

  /* ---------- display ---------- */

  // Formats saved by the first version used these names.
  const LEGACY = { number: '#,##0.00', currency: '$#,##0.00', percent: '0.00%' };

  // Returns { text, kind, color } where kind is 'num' | 'text' | 'bool' | 'error' | 'empty'.
  function formatValue(v, nf) {
    if (v === null || v === undefined) return { text: '', kind: 'empty', color: null };
    if (v instanceof XlError) return { text: v.code, kind: 'error', color: null };
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'bool', color: null };
    const code = LEGACY[nf] || nf || 'General';
    if (typeof v === 'number') {
      if (!isFinite(v)) return { text: '#NUM!', kind: 'error', color: null };
      const r = NumFmt.format(v, code);
      return { text: r.text, kind: 'num', color: r.color };
    }
    const r = NumFmt.format(String(v), code);
    return { text: r.text, kind: 'text', color: r.color };
  }

  // Plain value for CSV export: no display formatting.
  function plainValue(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof XlError) return v.code;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return numToStr(v, 15);
    return String(v);
  }

  /* ---------- CSV / TSV ---------- */

  function detectDelimiter(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    let best = ',';
    let bestN = -1;
    for (const d of [',', ';', '\t']) {
      let n = 0;
      let q = false;
      for (const ch of first) {
        if (ch === '"') q = !q;
        else if (ch === d && !q) n++;
      }
      if (n > bestN) {
        best = d;
        bestN = n;
      }
    }
    return best;
  }

  function parseCSV(text, delim) {
    text = text.replace(/^\uFEFF/, '');
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += ch;
      } else if (ch === '"' && cur === '') {
        q = true;
      } else if (ch === delim) {
        row.push(cur);
        cur = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        cur = '';
        rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  function toCSV(rows) {
    return rows
      .map((row) =>
        row
          .map((v) => {
            const s = String(v);
            return /[",\r\n]/.test(s) || s !== s.trim() ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(',')
      )
      .join('\r\n');
  }

  function toTSV(rows) {
    return rows.map((row) => row.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  function parseTSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines.map((l) => l.split('\t'));
  }

  /* ---------- regions & charts ---------- */

  // Like Excel's "current region": the block of filled cells touching (r, c).
  function currentRegion(sheet, r, c) {
    const filled = (rr, cc) => sheet.inBounds(rr, cc) && sheet.getRaw(key(rr, cc)) !== '';
    if (!filled(r, c)) return { r1: r, c1: c, r2: r, c2: c };
    let r1 = r;
    let r2 = r;
    let c1 = c;
    let c2 = c;
    let grew = true;
    const rowHas = (rr) => {
      for (let cc = c1 - 1; cc <= c2 + 1; cc++) if (filled(rr, cc)) return true;
      return false;
    };
    const colHas = (cc) => {
      for (let rr = r1 - 1; rr <= r2 + 1; rr++) if (filled(rr, cc)) return true;
      return false;
    };
    while (grew) {
      grew = false;
      if (r1 > 0 && rowHas(r1 - 1)) { r1--; grew = true; }
      if (r2 < sheet.rows - 1 && rowHas(r2 + 1)) { r2++; grew = true; }
      if (c1 > 0 && colHas(c1 - 1)) { c1--; grew = true; }
      if (c2 < sheet.cols - 1 && colHas(c2 + 1)) { c2++; grew = true; }
    }
    return { r1, c1, r2, c2 };
  }

  // Turn a cell range into { cats, series: [{ name, values }] }.
  // A text-only first row is a header; a text-only first column holds category labels.
  function chartData(sheet, rg) {
    const rows = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      const row = [];
      for (let c = rg.c1; c <= rg.c2; c++) row.push(sheet.getValue(key(r, c)));
      rows.push(row);
    }
    const isNum = (v) => typeof v === 'number';
    const isText = (v) => typeof v === 'string' && v.trim() !== '';
    const width = rows.length ? rows[0].length : 0;
    const hasHeader = rows.length > 1 && rows[0].some(isText) && !rows[0].some(isNum);
    const data = hasHeader ? rows.slice(1) : rows;
    const first = data.map((row) => row[0]);
    const hasLabels = width > 1 && first.some(isText) && !first.some(isNum);
    const startCol = hasLabels ? 1 : 0;
    const cats = data.map((row, i) => (hasLabels ? String(row[0] === null ? '' : row[0]) : String(i + 1)));
    const series = [];
    for (let c = startCol; c < width; c++) {
      const values = data.map((row) => (isNum(row[c]) ? row[c] : null));
      if (values.every((v) => v === null)) continue;
      const h = hasHeader ? rows[0][c] : null;
      series.push({ name: isText(h) ? String(h) : 'Series ' + (series.length + 1), values });
    }
    return { cats, series };
  }

  function rangeLabel(rg) {
    const a = key(rg.r1, rg.c1);
    const b = key(rg.r2, rg.c2);
    return a === b ? a : a + ':' + b;
  }

  return {
    formatValue,
    plainValue,
    parseCSV,
    toCSV,
    toTSV,
    parseTSV,
    currentRegion,
    chartData,
    rangeLabel
  };
});
