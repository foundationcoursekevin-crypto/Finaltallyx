/*
 * Tally number formats: Excel-style format codes (0 # ? , . % E+ dates, fractions,
 * [Red] colors, sections), plus parsing of typed dates, times, percents and currency.
 * Pure logic, no DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TallyNumFmt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const COLORS = { black: '#000000', blue: '#1c7ed6', cyan: '#1098ad', green: '#2f9e44', magenta: '#ae3ec9', red: '#e03131', white: '#ffffff', yellow: '#f08c00' };

  const FILL = '\u0001'; // marks where an Excel "*" fill sits; the grid pads it with space

  /* ---------- small helpers ---------- */

  function general(n, digits) {
    digits = digits || 10;
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, 'e');
    return String(parseFloat(n.toPrecision(digits)));
  }

  function roundHalfAway(x, d) {
    let r = Number(Math.round(Number(x + 'e' + d)) + 'e-' + d);
    if (isNaN(r)) r = Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
    return r;
  }

  const pad2 = (n) => (n < 10 ? '0' + n : String(n));

  /* ---------- dates ---------- */

  const EPOCH = Date.UTC(1899, 11, 30);

  function dateToSerial(y, m, d) {
    return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
  }

  function serialToDate(n) {
    let days = Math.floor(n);
    let secs = Math.round((n - days) * 86400);
    if (secs >= 86400) {
      secs -= 86400;
      days += 1;
    }
    const dt = new Date(EPOCH + days * 86400000);
    return {
      y: dt.getUTCFullYear(),
      m: dt.getUTCMonth() + 1,
      d: dt.getUTCDate(),
      wd: dt.getUTCDay(),
      h: Math.floor(secs / 3600),
      mi: Math.floor((secs % 3600) / 60),
      s: secs % 60
    };
  }

  /* ---------- format code compiler ---------- */

  function splitSections(code) {
    const out = [];
    let cur = '';
    let q = false;
    let br = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '\\' && !q) {
        cur += ch + (code[i + 1] || '');
        i++;
        continue;
      }
      if (ch === '"') q = !q;
      else if (!q && ch === '[') br = true;
      else if (!q && ch === ']') br = false;
      if (ch === ';' && !q && !br) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function tokenizeSection(src, meta) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (ch === '"') {
        let j = src.indexOf('"', i + 1);
        if (j < 0) j = n;
        toks.push({ t: 'lit', v: src.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
      if (ch === '\\') {
        toks.push({ t: 'lit', v: src[i + 1] || '' });
        i += 2;
        continue;
      }
      if (ch === '_') {
        toks.push({ t: 'lit', v: ' ' });
        i += 2;
        continue;
      }
      if (ch === '*') {
        toks.push({ t: 'fill' });
        i += 2;
        continue;
      }
      if (ch === '[') {
        const j = src.indexOf(']', i);
        if (j < 0) {
          i++;
          continue;
        }
        const body = src.slice(i + 1, j);
        i = j + 1;
        const lc = body.toLowerCase();
        if (COLORS[lc]) {
          meta.color = COLORS[lc];
          continue;
        }
        const m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(body);
        if (m) {
          meta.cond = { op: m[1], v: parseFloat(m[2]) };
          continue;
        }
        if (body[0] === '$') {
          toks.push({ t: 'lit', v: body.slice(1).split('-')[0] });
          continue;
        }
        if (/^(h+|m+|s+)$/i.test(body)) toks.push({ t: 'elapsed', v: lc[0], n: body.length });
        continue;
      }
      if (ch === '0' || ch === '#' || ch === '?') {
        toks.push({ t: 'digit', v: ch });
        i++;
        continue;
      }
      if (ch === '.') {
        toks.push({ t: 'dot' });
        i++;
        continue;
      }
      if (ch === ',') {
        toks.push({ t: 'comma' });
        i++;
        continue;
      }
      if (ch === '%') {
        toks.push({ t: 'pct' });
        i++;
        continue;
      }
      if (ch === '@') {
        toks.push({ t: 'text' });
        i++;
        continue;
      }
      if (ch === '/') {
        toks.push({ t: 'lit', v: '/', slash: true });
        i++;
        continue;
      }
      if ((ch === 'E' || ch === 'e') && (src[i + 1] === '+' || src[i + 1] === '-')) {
        toks.push({ t: 'exp', sign: src[i + 1] });
        i += 2;
        continue;
      }
      const rest = src.slice(i);
      let m = /^(AM\/PM|am\/pm|A\/P|a\/p)/.exec(rest);
      if (m) {
        toks.push({ t: 'ampm', v: m[0] });
        i += m[0].length;
        continue;
      }
      if (/^General/i.test(rest)) {
        toks.push({ t: 'general' });
        i += 7;
        continue;
      }
      m = /^(y+|m+|d+|h+|s+)/i.exec(rest);
      if (m) {
        toks.push({ t: 'date', v: m[0].toLowerCase() });
        i += m[0].length;
        continue;
      }
      toks.push({ t: 'lit', v: ch });
      i++;
    }
    return toks;
  }

  const cache = new Map();

  function compile(code) {
    let c = cache.get(code);
    if (c) return c;
    const secs = splitSections(code).map((src) => {
      const meta = { color: null, cond: null };
      const toks = tokenizeSection(src, meta);
      return {
        toks,
        color: meta.color,
        cond: meta.cond,
        isDate: toks.some((t) => t.t === 'date' || t.t === 'ampm' || t.t === 'elapsed'),
        hasText: toks.some((t) => t.t === 'text'),
        hasGeneral: toks.some((t) => t.t === 'general')
      };
    });
    c = { secs };
    if (cache.size > 500) cache.clear();
    cache.set(code, c);
    return c;
  }

  /* ---------- renderers ---------- */

  function renderText(toks, text) {
    let out = '';
    for (const t of toks) {
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'text') out += text;
      else if (t.t === 'fill') out += FILL;
    }
    return out;
  }

  function renderDate(toks, serial) {
    if (!(serial >= 0) || serial > 2958465) return '########';
    const p = serialToDate(serial);
    const ampm = toks.some((t) => t.t === 'ampm');
    // m / mm means minutes right after hours or right before seconds, otherwise month
    const isMinute = (idx) => {
      for (let k = idx - 1; k >= 0; k--) {
        const t = toks[k];
        if (t.t === 'lit' || t.t === 'fill') continue;
        return (t.t === 'date' && t.v[0] === 'h') || (t.t === 'elapsed' && t.v === 'h');
      }
      for (let k = idx + 1; k < toks.length; k++) {
        const t = toks[k];
        if (t.t === 'lit' || t.t === 'fill') continue;
        return t.t === 'date' && t.v[0] === 's';
      }
      return false;
    };
    let out = '';
    toks.forEach((t, idx) => {
      switch (t.t) {
        case 'lit':
          out += t.v;
          break;
        case 'comma':
          out += ',';
          break;
        case 'dot':
          out += '.';
          break;
        case 'fill':
          out += FILL;
          break;
        case 'date': {
          const v = t.v;
          const len = v.length;
          switch (v[0]) {
            case 'y':
              out += len <= 2 ? pad2(p.y % 100) : String(p.y).padStart(4, '0');
              break;
            case 'm':
              if (isMinute(idx)) out += len >= 2 ? pad2(p.mi) : String(p.mi);
              else if (len === 1) out += p.m;
              else if (len === 2) out += pad2(p.m);
              else if (len === 3) out += MONTHS[p.m - 1].slice(0, 3);
              else if (len === 4) out += MONTHS[p.m - 1];
              else out += MONTHS[p.m - 1][0];
              break;
            case 'd':
              if (len === 1) out += p.d;
              else if (len === 2) out += pad2(p.d);
              else if (len === 3) out += DAYS[p.wd].slice(0, 3);
              else out += DAYS[p.wd];
              break;
            case 'h': {
              const h = ampm ? p.h % 12 || 12 : p.h;
              out += len >= 2 ? pad2(h) : String(h);
              break;
            }
            case 's':
              out += len >= 2 ? pad2(p.s) : String(p.s);
              break;
            default:
          }
          break;
        }
        case 'ampm': {
          const pm = p.h >= 12;
          const v = t.v;
          if (v.toLowerCase() === 'a/p') out += v === 'a/p' ? (pm ? 'p' : 'a') : pm ? 'P' : 'A';
          else out += v === 'am/pm' ? (pm ? 'pm' : 'am') : pm ? 'PM' : 'AM';
          break;
        }
        case 'elapsed': {
          const mult = t.v === 'h' ? 24 : t.v === 'm' ? 1440 : 86400;
          out += String(Math.floor(serial * mult + 1e-9)).padStart(t.n, '0');
          break;
        }
        default:
      }
    });
    return out;
  }

  function approxFraction(x, maxDen) {
    if (x === 0) return [0, 1];
    let h1 = 1;
    let h0 = 0;
    let k1 = 0;
    let k0 = 1;
    let b = x;
    for (let i = 0; i < 30; i++) {
      const a = Math.floor(b);
      const h2 = a * h1 + h0;
      const k2 = a * k1 + k0;
      if (k2 > maxDen) break;
      h0 = h1;
      h1 = h2;
      k0 = k1;
      k1 = k2;
      const f = b - a;
      if (f < 1e-10) break;
      b = 1 / f;
    }
    return k1 === 0 ? [Math.round(x), 1] : [h1, k1];
  }

  function renderFraction(toks, x, neg) {
    const si = toks.findIndex((t) => t.t === 'lit' && t.slash);
    const left = toks.slice(0, si);
    const right = toks.slice(si + 1);
    let li = left.length - 1;
    const numTok = [];
    while (li >= 0 && left[li].t === 'digit') numTok.unshift(left[li--]);
    let mid = li;
    while (mid >= 0 && left[mid].t === 'lit' && left[mid].v === ' ') mid--;
    const intTok = [];
    let k = mid;
    while (k >= 0 && left[k].t === 'digit') intTok.unshift(left[k--]);
    const lits = (arr) => arr.filter((t) => t.t === 'lit').map((t) => t.v).join('');
    const prefix = lits(left.slice(0, k + 1));
    let denStr = '';
    let ri = 0;
    while (ri < right.length && (right[ri].t === 'digit' || (right[ri].t === 'lit' && /^\d$/.test(right[ri].v)))) {
      denStr += right[ri].t === 'digit' ? right[ri].v : right[ri].v;
      ri++;
    }
    const suffix = lits(right.slice(ri));
    const fixed = /^\d+$/.test(denStr) ? parseInt(denStr, 10) : null;
    const maxDen = fixed || Math.pow(10, denStr.length) - 1;
    const hasInt = intTok.length > 0;
    let whole = Math.floor(x);
    let num;
    let den;
    if (!hasInt) {
      if (fixed) {
        den = fixed;
        num = Math.round(x * den);
      } else [num, den] = approxFraction(x, maxDen);
      whole = 0;
    } else {
      const frac = x - whole;
      if (fixed) {
        den = fixed;
        num = Math.round(frac * den);
      } else [num, den] = approxFraction(frac, maxDen);
      if (num === den) {
        whole++;
        num = 0;
      }
    }
    const numPad = numTok.some((t) => t.v === '?');
    const denPad = /\?/.test(denStr);
    let numStr = String(num);
    let dStr = String(den);
    if (numPad) numStr = numStr.padStart(numTok.length, ' ');
    if (denPad) dStr = dStr.padEnd(denStr.length, ' ');
    let out;
    if (hasInt) out = num === 0 ? String(whole) : (whole > 0 ? whole + ' ' : '') + numStr + '/' + dStr;
    else out = numStr + '/' + dStr;
    return (neg ? '-' : '') + prefix + out + suffix;
  }

  function renderScientific(toks, x, neg) {
    const ei = toks.findIndex((t) => t.t === 'exp');
    const mant = toks.slice(0, ei);
    const expToks = toks.slice(ei + 1);
    const dIdx = mant.findIndex((t) => t.t === 'dot');
    const intTok = mant.filter((t, i) => t.t === 'digit' && (dIdx < 0 || i < dIdx));
    const decTok = mant.filter((t, i) => t.t === 'digit' && dIdx >= 0 && i > dIdx);
    const nInt = Math.max(1, intTok.length);
    const nDec = decTok.length;
    const expDigits = Math.max(1, expToks.filter((t) => t.t === 'digit').length);
    let exp = 0;
    let m = 0;
    if (x !== 0) {
      exp = Math.floor(Math.log10(x)) - (nInt - 1);
      m = roundHalfAway(x / Math.pow(10, exp), nDec);
      if (m >= Math.pow(10, nInt)) {
        exp += 1;
        m = roundHalfAway(x / Math.pow(10, exp), nDec);
      }
    }
    const parts = m.toFixed(nDec).split('.');
    const zerosInt = intTok.filter((t) => t.v === '0').length;
    const ip = parts[0].padStart(zerosInt, '0');
    const fp = parts[1] || '';
    let lastNZ = -1;
    for (let k = 0; k < fp.length; k++) if (fp[k] !== '0') lastNZ = k;
    let fpOut = '';
    decTok.forEach((t, k) => {
      if (k <= lastNZ || t.v === '0') fpOut += fp[k];
      else if (t.v === '?') fpOut += ' ';
    });
    const firstDigit = toks.findIndex((t) => t.t === 'digit');
    const prefix = toks.slice(0, Math.max(0, firstDigit)).filter((t) => t.t === 'lit').map((t) => t.v).join('');
    const lastExpDigit = expToks.map((t) => t.t).lastIndexOf('digit');
    const suffix = expToks.slice(lastExpDigit + 1).filter((t) => t.t === 'lit').map((t) => t.v).join('');
    const sign = toks[ei].sign;
    return (neg ? '-' : '') + prefix + ip + (dIdx >= 0 ? '.' + fpOut : '') + 'E' + (exp < 0 ? '-' : sign === '+' ? '+' : '') + String(Math.abs(exp)).padStart(expDigits, '0') + suffix;
  }

  function renderStandard(toks, x, neg) {
    const kinds = toks.map((t, i) => {
      if (t.t !== 'comma') return null;
      let a = i - 1;
      while (a >= 0 && toks[a].t === 'comma') a--;
      let b = i + 1;
      while (b < toks.length && toks[b].t === 'comma') b++;
      const p = toks[a];
      const nx = toks[b];
      if (p && p.t === 'digit' && nx && nx.t === 'digit') return 'thousands';
      if (p && p.t === 'digit') return 'scale';
      return 'lit';
    });
    const thousands = kinds.indexOf('thousands') !== -1;
    const scale = kinds.filter((k) => k === 'scale').length;
    const pct = toks.filter((t) => t.t === 'pct').length;
    x = (x * Math.pow(100, pct)) / Math.pow(1000, scale);

    const dot = toks.findIndex((t) => t.t === 'dot');
    let nPh = 0;
    let nDec = 0;
    toks.forEach((t, i) => {
      if (t.t !== 'digit') return;
      if (dot >= 0 && i > dot) nDec++;
      else nPh++;
    });
    const s = roundHalfAway(x, nDec).toFixed(Math.min(nDec, 100));
    const parts = s.split('.');
    const digits = parts[0] === '0' ? [] : parts[0].split('');
    const fp = parts[1] || '';
    let lastNZ = -1;
    for (let k = 0; k < fp.length; k++) if (fp[k] !== '0') lastNZ = k;
    const L = digits.length;
    let out = '';
    const emit = (from, to) => {
      for (let j = from; j <= to; j++) {
        out += digits[j];
        const rem = L - 1 - j;
        if (thousands && rem > 0 && rem % 3 === 0) out += ',';
      }
    };
    let ii = 0;
    let di = 0;
    toks.forEach((t, i) => {
      switch (t.t) {
        case 'digit':
          if (dot >= 0 && i > dot) {
            const k = di++;
            if (k <= lastNZ || t.v === '0') out += fp[k];
            else if (t.v === '?') out += ' ';
          } else {
            const extra = L - nPh;
            if (ii === 0 && extra > 0) emit(0, extra);
            else {
              const j = L - 1 - (nPh - 1 - ii);
              if (j >= 0) emit(j, j);
              else out += t.v === '0' ? '0' : t.v === '?' ? ' ' : '';
            }
            ii++;
          }
          break;
        case 'dot':
          if (nPh === 0 && L > 0) emit(0, L - 1);
          out += '.';
          break;
        case 'comma':
          if (kinds[i] === 'lit') out += ',';
          break;
        case 'pct':
          out += '%';
          break;
        case 'lit':
          out += t.v;
          break;
        case 'fill':
          out += FILL;
          break;
        default:
      }
    });
    return (neg ? '-' : '') + out;
  }

  function renderNumber(sec, x, neg) {
    const toks = sec.toks;
    if (sec.hasGeneral) {
      let out = '';
      for (const t of toks) {
        if (t.t === 'general') out += general(x);
        else if (t.t === 'lit') out += t.v;
      }
      return (neg ? '-' : '') + out;
    }
    if (toks.some((t) => t.t === 'exp')) return renderScientific(toks, x, neg);
    const si = toks.findIndex((t) => t.t === 'lit' && t.slash);
    if (si > 0 && toks[si - 1].t === 'digit' && si + 1 < toks.length && (toks[si + 1].t === 'digit' || (toks[si + 1].t === 'lit' && /^\d$/.test(toks[si + 1].v)))) {
      return renderFraction(toks, x, neg);
    }
    return renderStandard(toks, x, neg);
  }

  function condTest(cond, v) {
    switch (cond.op) {
      case '<': return v < cond.v;
      case '>': return v > cond.v;
      case '<=': return v <= cond.v;
      case '>=': return v >= cond.v;
      case '=': return v === cond.v;
      default: return v !== cond.v;
    }
  }

  // format(value, code) -> { text, color }
  function format(value, code) {
    if (code === undefined || code === null || code === '') code = 'General';
    const c = compile(code);
    const secs = c.secs;
    if (typeof value === 'string') {
      const sec = secs.length >= 4 ? secs[3] : secs.find((s) => s.hasText);
      if (!sec) return { text: value, color: null };
      return { text: renderText(sec.toks, value), color: sec.color };
    }
    if (typeof value !== 'number' || !isFinite(value)) return { text: String(value), color: null };

    let idx = 0;
    let useAbs = false;
    const numeric = secs.slice(0, 3);
    if (numeric.some((s) => s.cond)) {
      idx = numeric.findIndex((s) => s.cond && condTest(s.cond, value));
      if (idx < 0) {
        idx = numeric.findIndex((s) => !s.cond);
        if (idx < 0) idx = numeric.length - 1;
      }
    } else if (secs.length === 2) {
      idx = value < 0 ? 1 : 0;
      useAbs = value < 0;
    } else if (secs.length >= 3) {
      idx = value > 0 ? 0 : value < 0 ? 1 : 2;
      useAbs = value < 0;
    }
    const sec = secs[idx];
    if (sec.isDate) return { text: renderDate(sec.toks, value), color: sec.color };
    const neg = value < 0 && !useAbs;
    return { text: renderNumber(sec, Math.abs(value), neg), color: sec.color };
  }

  /* ---------- typed values ---------- */

  const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  const MON3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function fullYear(s) {
    const y = parseInt(s, 10);
    if (s.length === 4) return y;
    return y < 30 ? 2000 + y : 1900 + y;
  }

  // Interprets what was typed into a cell. Returns null (not a number-like entry)
  // or { value, nf } where nf is the format Excel would apply automatically (or null).
  function parseTyped(raw) {
    const t = raw.trim();
    if (!t) return null;
    let m;
    if (NUM_RE.test(t)) return { value: Number(t), nf: null };

    if ((m = /^([-+]?)(\d+\.?\d*|\.\d+)%$/.exec(t))) {
      const dec = (m[2].split('.')[1] || '').length;
      return { value: Number(m[1] + m[2]) / 100, nf: dec ? '0.' + '0'.repeat(dec) + '%' : '0%' };
    }
    if ((m = /^(-?)\$\s?(-?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(t))) {
      const num = Number(m[3].replace(/,/g, '') + (m[4] || ''));
      return { value: m[1] || m[2] ? -num : num, nf: m[4] ? '$#,##0.00' : '$#,##0' };
    }
    if ((m = /^(-?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/.exec(t))) {
      const num = Number(m[2].replace(/,/g, '') + (m[3] || ''));
      return { value: m[1] ? -num : num, nf: m[3] ? '#,##0.00' : '#,##0' };
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t))) {
      const y = fullYear(m[3]);
      if (validDate(y, +m[1], +m[2])) return { value: dateToSerial(y, +m[1], +m[2]), nf: 'm/d/yyyy' };
    }
    if ((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(t))) {
      if (validDate(+m[3], +m[1], +m[2])) return { value: dateToSerial(+m[3], +m[1], +m[2]), nf: 'm/d/yyyy' };
    }
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) {
      if (validDate(+m[1], +m[2], +m[3])) return { value: dateToSerial(+m[1], +m[2], +m[3]), nf: 'm/d/yyyy' };
    }
    if ((m = /^(\d{1,2})[- ]([A-Za-z]{3,9})\.?[- ,]+(\d{2}|\d{4})$/.exec(t))) {
      const mon = MON3.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
      const y = fullYear(m[3]);
      if (mon && validDate(y, mon, +m[1])) return { value: dateToSerial(y, mon, +m[1]), nf: 'd-mmm-yy' };
    }
    if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(t))) {
      const mon = MON3.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      if (mon && validDate(+m[3], mon, +m[2])) return { value: dateToSerial(+m[3], mon, +m[2]), nf: 'd-mmm-yy' };
    }
    if ((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(t))) {
      let h = +m[1];
      const mi = +m[2];
      const s = m[3] ? +m[3] : 0;
      const ap = m[4] ? m[4].toUpperCase() : null;
      if (mi < 60 && s < 60 && (ap ? h >= 1 && h <= 12 : h < 24)) {
        if (ap === 'PM' && h < 12) h += 12;
        if (ap === 'AM' && h === 12) h = 0;
        const nf = (ap ? 'h:mm' : 'h:mm') + (m[3] ? ':ss' : '') + (ap ? ' AM/PM' : '');
        return { value: (h * 3600 + mi * 60 + s) / 86400, nf };
      }
    }
    return null;
  }

  /* ---------- categories & presets (Format Cells dialog) ---------- */

  const DATE_TYPES = ['m/d/yyyy', 'dddd, mmmm d, yyyy', 'm/d/yy', 'mm/dd/yyyy', 'yyyy-mm-dd', 'd-mmm-yy', 'd-mmm', 'mmm-yy', 'mmmm d, yyyy', 'mmmm yyyy', 'dddd'];
  const TIME_TYPES = ['h:mm AM/PM', 'h:mm:ss AM/PM', 'h:mm', 'h:mm:ss', '[h]:mm:ss', 'm/d/yyyy h:mm', 'mm:ss'];
  const FRACTION_TYPES = ['# ?/?', '# ??/??', '# ???/???', '# ?/2', '# ?/4', '# ?/8', '# ?/16', '# ?/10', '# ??/100'];
  const SYMBOLS = ['$', '€', '£', '¥', '₹', ''];

  const ACCOUNTING = (sym, d) => {
    const dec = d > 0 ? '.' + '0'.repeat(d) : '';
    const q = sym ? sym : '';
    return '_(' + q + '* #,##0' + dec + '_);_(' + q + '* (#,##0' + dec + ');_(' + q + '* "-"' + '?'.repeat(d) + '_);_(@_)';
  };
  const COMMA_STYLE = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)';

  const QUICK = [
    ['General', 'General'],
    ['Number', '0.00'],
    ['Currency', '$#,##0.00'],
    ['Accounting', ACCOUNTING('$', 2)],
    ['Short Date', 'm/d/yyyy'],
    ['Long Date', 'dddd, mmmm d, yyyy'],
    ['Time', 'h:mm:ss AM/PM'],
    ['Percentage', '0.00%'],
    ['Fraction', '# ?/?'],
    ['Scientific', '0.00E+00'],
    ['Text', '@']
  ];

  function withNegative(base, style) {
    switch (style) {
      case 1: return base + ';[Red]' + base;
      case 2: return base + '_);(' + base + ')';
      case 3: return base + '_);[Red](' + base + ')';
      default: return base;
    }
  }

  // Build a format code from the dialog's category controls.
  function buildCode(cat, o) {
    o = o || {};
    const d = o.decimals === undefined ? 2 : o.decimals;
    const dec = d > 0 ? '.' + '0'.repeat(d) : '';
    const sym = o.symbol === undefined ? '$' : o.symbol;
    const q = sym && !/^[$€£¥₹]$/.test(sym) ? '"' + sym + '"' : sym;
    switch (cat) {
      case 'General': return 'General';
      case 'Number': return withNegative((o.thousands ? '#,##0' : '0') + dec, o.neg || 0);
      case 'Currency': return withNegative(q + '#,##0' + dec, o.neg || 0);
      case 'Accounting': return ACCOUNTING(q, d);
      case 'Percentage': return '0' + dec + '%';
      case 'Scientific': return '0' + dec + 'E+00';
      case 'Text': return '@';
      case 'Date': return o.type || DATE_TYPES[0];
      case 'Time': return o.type || TIME_TYPES[0];
      case 'Fraction': return o.type || FRACTION_TYPES[0];
      default: return o.code || 'General';
    }
  }

  // Best-effort reverse of buildCode so the dialog opens on the right category.
  function detectCategory(code) {
    code = code || 'General';
    if (code === 'General') return { cat: 'General', o: {} };
    if (code === '@') return { cat: 'Text', o: {} };
    const secs = compile(code).secs;
    const first = secs[0];
    if (first.isDate) {
      if (DATE_TYPES.indexOf(code) !== -1) return { cat: 'Date', o: { type: code } };
      if (TIME_TYPES.indexOf(code) !== -1) return { cat: 'Time', o: { type: code } };
      return { cat: 'Custom', o: { code } };
    }
    if (FRACTION_TYPES.indexOf(code) !== -1) return { cat: 'Fraction', o: { type: code } };
    const base = splitSections(code)[0];
    const decimals = (/\.([0#?]+)/.exec(base) || [])[1];
    const d = decimals ? decimals.length : 0;
    if (/^0(\.0+)?E\+00$/.test(base) && secs.length === 1) return { cat: 'Scientific', o: { decimals: d } };
    if (/^0(\.0+)?%$/.test(base) && secs.length === 1) return { cat: 'Percentage', o: { decimals: d } };
    if (code.indexOf('_(') === 0 && code.indexOf('* ') !== -1 && secs.length === 4) {
      const m = /^_\((.*?)\* /.exec(code);
      const s = m ? m[1].replace(/"/g, '') : '';
      if (code === ACCOUNTING(m ? m[1] : '', d)) return { cat: 'Accounting', o: { decimals: d, symbol: s } };
    }
    for (let neg = 0; neg < 4; neg++) {
      for (const th of [true, false]) {
        if (code === buildCode('Number', { decimals: d, thousands: th, neg })) return { cat: 'Number', o: { decimals: d, thousands: th, neg } };
      }
      for (const s of SYMBOLS.concat(['CHF', 'kr'])) {
        if (s !== '' && code === buildCode('Currency', { decimals: d, symbol: s, neg })) return { cat: 'Currency', o: { decimals: d, symbol: s, neg } };
      }
    }
    return { cat: 'Custom', o: { code } };
  }

  // Increase or decrease decimal places on a code (toolbar buttons).
  function adjustDecimals(code, delta, sample) {
    if (!code || code === 'General') {
      let d = 0;
      if (typeof sample === 'number' && isFinite(sample)) {
        const str = general(sample, 10);
        const dp = /^-?\d*\.(\d+)$/.exec(str);
        d = dp ? dp[1].length : 0;
      }
      const nd = d + delta;
      if (nd < 0) return 'General';
      return nd === 0 ? '0' : '0.' + '0'.repeat(nd);
    }
    const secs = splitSections(code);
    const out = secs.map((s, idx) => {
      if (idx > 2 || compile(s).secs[0].isDate || compile(s).secs[0].hasText) return s;
      // find protected ranges
      const prot = new Array(s.length).fill(false);
      let q = false;
      let br = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '\\' || ch === '_' || ch === '*') {
          prot[i] = prot[i + 1] = true;
          i++;
          continue;
        }
        if (ch === '"') {
          prot[i] = true;
          q = !q;
          continue;
        }
        if (!q && ch === '[') br = true;
        if (q || br) prot[i] = true;
        if (!q && ch === ']') br = false;
      }
      let start = -1;
      for (let i = 0; i < s.length; i++) {
        if (!prot[i] && /[0#?]/.test(s[i])) {
          start = i;
          break;
        }
      }
      if (start < 0) return s;
      let i = start;
      while (i < s.length && !prot[i] && /[0#?,]/.test(s[i])) i++;
      const intEnd = i;
      if (s[i] === '.' && !prot[i]) {
        let j = i + 1;
        while (j < s.length && !prot[j] && /[0#?]/.test(s[j])) j++;
        const run = j - (i + 1);
        if (delta > 0) return s.slice(0, j) + '0'.repeat(delta) + s.slice(j);
        const keep = Math.max(0, run + delta);
        return s.slice(0, i) + (keep ? '.' + s.slice(i + 1, i + 1 + keep) : '') + s.slice(j);
      }
      if (delta > 0) return s.slice(0, intEnd) + '.' + '0'.repeat(delta) + s.slice(intEnd);
      return s;
    });
    return out.join(';');
  }

  return {
    format,
    parseTyped,
    buildCode,
    detectCategory,
    adjustDecimals,
    serialToDate,
    dateToSerial,
    general,
    FILL,
    COLORS,
    MONTHS,
    DAYS,
    DATE_TYPES,
    TIME_TYPES,
    FRACTION_TYPES,
    SYMBOLS,
    QUICK,
    ACCOUNTING,
    COMMA_STYLE
  };
});
