/*
 * Tally formula engine.
 * Pure logic, no DOM. Works in the renderer (window.TallyEngine) and in Node (tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./numfmt.js'));
  else root.TallyEngine = factory(root.TallyNumFmt);
})(typeof self !== 'undefined' ? self : this, function (NumFmt) {
  'use strict';

  /* ---------- addresses ---------- */

  function colToName(c) {
    let s = '';
    c += 1;
    while (c > 0) {
      const m = (c - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }

  function nameToCol(name) {
    let c = 0;
    for (const ch of name.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return c - 1;
  }

  function key(r, c) {
    return colToName(c) + (r + 1);
  }

  function parseKey(k) {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(k);
    if (!m) return null;
    return { r: parseInt(m[2], 10) - 1, c: nameToCol(m[1]) };
  }

  /* ---------- errors & values ---------- */

  const ERR = {
    DIV0: '#DIV/0!',
    VALUE: '#VALUE!',
    REF: '#REF!',
    NAME: '#NAME?',
    NUM: '#NUM!',
    NA: '#N/A',
    CIRC: '#CIRC!',
    PARSE: '#ERROR!'
  };

  class XlError {
    constructor(code) {
      this.code = code;
    }
    toString() {
      return this.code;
    }
  }

  const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  const PCT_RE = /^[-+]?(\d+\.?\d*|\.\d+)%$/;

  // What a typed value means when it is not a formula.
  function parseLiteral(raw) {
    if (raw.length > 0 && raw[0] === "'") return raw.slice(1); // 'text forces text
    const t = raw.trim();
    if (t === '') return raw;
    if (NUM_RE.test(t)) return Number(t);
    const u = t.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    const typed = NumFmt.parseTyped(t);
    if (typed) return typed.value;
    return raw;
  }

  // The number format Excel would apply automatically for what was typed (or null).
  function inferFormat(raw) {
    if (typeof raw !== 'string' || raw === '' || raw[0] === '=' || raw[0] === "'") return null;
    const typed = NumFmt.parseTyped(raw);
    return typed ? typed.nf : null;
  }

  function numToStr(n, digits) {
    digits = digits || 15;
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e15 || a < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, 'e');
    return String(parseFloat(n.toPrecision(digits)));
  }

  function toNum(v) {
    if (v instanceof XlError) throw v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const t = v.trim();
      if (NUM_RE.test(t)) return Number(t);
      if (PCT_RE.test(t)) return Number(t.slice(0, -1)) / 100;
    }
    throw new XlError(ERR.VALUE);
  }

  function toText(v) {
    if (v instanceof XlError) throw v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return numToStr(v);
    return String(v);
  }

  function toBool(v) {
    if (v instanceof XlError) throw v;
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const u = v.trim().toUpperCase();
      if (u === 'TRUE') return true;
      if (u === 'FALSE') return false;
    }
    throw new XlError(ERR.VALUE);
  }

  function rank(v) {
    return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2;
  }

  function compare(a, b) {
    if (a instanceof XlError) throw a;
    if (b instanceof XlError) throw b;
    if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 1) {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* ---------- tokenizer ---------- */

  const CELL_RE = /^\$?[A-Za-z]{1,3}\$?\d+$/;

  function tokenize(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }
      const start = i;
      if (ch === '"') {
        let j = i + 1;
        let s = '';
        let closed = false;
        while (j < n) {
          if (src[j] === '"') {
            if (src[j + 1] === '"') {
              s += '"';
              j += 2;
              continue;
            }
            closed = true;
            break;
          }
          s += src[j++];
        }
        if (!closed) throw new XlError(ERR.PARSE);
        toks.push({ t: 'str', v: s, s: start, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (ch === '#') {
        const m = /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|ERROR!|CIRC!)/.exec(src.slice(i));
        if (!m) throw new XlError(ERR.PARSE);
        toks.push({ t: 'err', v: m[0], s: start, e: start + m[0].length });
        i += m[0].length;
        continue;
      }
      if ((ch >= '0' && ch <= '9') || ch === '.') {
        const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
        if (!m) throw new XlError(ERR.PARSE);
        toks.push({ t: 'num', v: parseFloat(m[0]), s: start, e: start + m[0].length });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const m = /^[$A-Za-z_][$A-Za-z0-9_.]*/.exec(src.slice(i));
        const word = m[0];
        let j = i + word.length;
        let k = j;
        while (k < n && src[k] === ' ') k++;
        if (src[k] === '(') {
          toks.push({ t: 'func', v: word, s: start, e: j });
        } else if (CELL_RE.test(word)) {
          toks.push({ t: 'ref', v: word, s: start, e: j });
        } else if (word.toUpperCase() === 'TRUE' || word.toUpperCase() === 'FALSE') {
          toks.push({ t: 'bool', v: word.toUpperCase() === 'TRUE', s: start, e: j });
        } else {
          toks.push({ t: 'name', v: word, s: start, e: j });
        }
        i = j;
        continue;
      }
      const two = src.substr(i, 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        toks.push({ t: 'op', v: two, s: start, e: start + 2 });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>(),%:'.indexOf(ch) !== -1) {
        toks.push({ t: 'op', v: ch, s: start, e: start + 1 });
        i++;
        continue;
      }
      throw new XlError(ERR.PARSE);
    }
    return toks;
  }

  function parseRefStr(s) {
    const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(s);
    return { c: nameToCol(m[2]), r: parseInt(m[4], 10) - 1, ac: !!m[1], ar: !!m[3] };
  }

  /* ---------- parser (precedence climbing) ---------- */

  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => p < toks.length && toks[p].t === 'op' && toks[p].v === v;
    const fail = () => {
      throw new XlError(ERR.PARSE);
    };

    function parseCompare() {
      let l = parseConcat();
      while (p < toks.length && toks[p].t === 'op' && ['=', '<>', '<', '>', '<=', '>='].indexOf(toks[p].v) !== -1) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: parseConcat() };
      }
      return l;
    }
    function parseConcat() {
      let l = parseAdd();
      while (isOp('&')) {
        p++;
        l = { k: 'bin', op: '&', l, r: parseAdd() };
      }
      return l;
    }
    function parseAdd() {
      let l = parseMul();
      while (isOp('+') || isOp('-')) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: parseMul() };
      }
      return l;
    }
    function parseMul() {
      let l = parsePow();
      while (isOp('*') || isOp('/')) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: parsePow() };
      }
      return l;
    }
    function parsePow() {
      let l = parseUnary();
      while (isOp('^')) {
        p++;
        l = { k: 'bin', op: '^', l, r: parseUnary() };
      }
      return l;
    }
    function parseUnary() {
      if (isOp('-')) {
        p++;
        return { k: 'neg', e: parseUnary() };
      }
      if (isOp('+')) {
        p++;
        return parseUnary();
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parsePrimary();
      while (isOp('%')) {
        p++;
        e = { k: 'pct', e };
      }
      return e;
    }
    function parsePrimary() {
      const t = toks[p++];
      if (!t) fail();
      switch (t.t) {
        case 'num':
          return { k: 'num', v: t.v };
        case 'str':
          return { k: 'str', v: t.v };
        case 'bool':
          return { k: 'bool', v: t.v };
        case 'err':
          return { k: 'err', code: t.v };
        case 'name':
          throw new XlError(ERR.NAME);
        case 'ref': {
          if (isOp(':')) {
            p++;
            const t2 = toks[p++];
            if (!t2 || t2.t !== 'ref') fail();
            return { k: 'range', a: parseRefStr(t.v), b: parseRefStr(t2.v) };
          }
          return { k: 'ref', a: parseRefStr(t.v) };
        }
        case 'func': {
          if (!isOp('(')) fail();
          p++;
          const args = [];
          if (isOp(')')) {
            p++;
          } else {
            for (;;) {
              args.push(parseCompare());
              if (isOp(',')) {
                p++;
                continue;
              }
              if (isOp(')')) {
                p++;
                break;
              }
              fail();
            }
          }
          return { k: 'call', name: t.v.toUpperCase(), args };
        }
        case 'op':
          if (t.v === '(') {
            const e = parseCompare();
            if (!isOp(')')) fail();
            p++;
            return e;
          }
          fail();
          break;
        default:
          fail();
      }
      return null;
    }

    const ast = parseCompare();
    if (p < toks.length) fail();
    return ast;
  }

  /* ---------- reference shifting (copy / paste / fill) ---------- */

  function shiftRef(ref, dr, dc) {
    const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(ref);
    let c = nameToCol(m[2]);
    let r = parseInt(m[4], 10) - 1;
    if (!m[1]) c += dc;
    if (!m[3]) r += dr;
    if (c < 0 || r < 0) return '#REF!';
    return m[1] + colToName(c) + m[3] + (r + 1);
  }

  function shiftFormula(raw, dr, dc) {
    if (typeof raw !== 'string' || raw[0] !== '=') return raw;
    const body = raw.slice(1);
    let toks;
    try {
      toks = tokenize(body);
    } catch (e) {
      return raw;
    }
    let out = '';
    let last = 0;
    for (const t of toks) {
      if (t.t === 'ref') {
        out += body.slice(last, t.s) + shiftRef(t.v, dr, dc);
        last = t.e;
      }
    }
    return '=' + out + body.slice(last);
  }

  /* ---------- criteria (SUMIF / COUNTIF) ---------- */

  function makeCriteria(c) {
    if (c instanceof XlError) throw c;
    if (typeof c === 'number') return (v) => typeof v === 'number' && v === c;
    if (typeof c === 'boolean') return (v) => v === c;
    let s = c === null || c === undefined ? '' : String(c);
    let op = '=';
    const m = /^(<=|>=|<>|<|>|=)([\s\S]*)$/.exec(s);
    if (m) {
      op = m[1];
      s = m[2];
    }
    const num = s.trim() !== '' && !isNaN(Number(s)) ? Number(s) : null;
    const cmpNum = (a, b) => {
      switch (op) {
        case '=': return a === b;
        case '<>': return a !== b;
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        default: return a >= b;
      }
    };
    if (num !== null) {
      return (v) => (typeof v === 'number' ? cmpNum(v, num) : op === '<>');
    }
    const lower = s.toLowerCase();
    let re = null;
    if (/[*?]/.test(lower) && (op === '=' || op === '<>')) {
      re = new RegExp('^' + lower.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    }
    return (v) => {
      if (v instanceof XlError) return false;
      const vs = v === null || v === undefined ? '' : typeof v === 'string' ? v.toLowerCase() : toText(v).toLowerCase();
      if (re) return op === '=' ? re.test(vs) : !re.test(vs);
      if (typeof v === 'number' && op !== '=' && op !== '<>') return false;
      switch (op) {
        case '=': return vs === lower;
        case '<>': return vs !== lower;
        case '<': return vs < lower;
        case '>': return vs > lower;
        case '<=': return vs <= lower;
        default: return vs >= lower;
      }
    };
  }

  /* ---------- functions ---------- */

  const isRange = (a) => a !== null && typeof a === 'object' && a.range === true;

  function flat(args) {
    const out = [];
    for (const a of args) {
      if (isRange(a)) for (const row of a.rows) for (const v of row) out.push(v);
      else out.push(a);
    }
    return out;
  }

  // Numbers for SUM-like functions: in ranges only real numbers count, direct args are coerced.
  function nums(args) {
    const out = [];
    for (const a of args) {
      if (isRange(a)) {
        for (const row of a.rows) {
          for (const v of row) {
            if (v instanceof XlError) throw v;
            if (typeof v === 'number') out.push(v);
          }
        }
      } else {
        out.push(toNum(a));
      }
    }
    return out;
  }

  function scalar(a) {
    if (isRange(a)) {
      if (a.rows.length === 1 && a.rows[0].length === 1) return a.rows[0][0];
      throw new XlError(ERR.VALUE);
    }
    return a;
  }

  function need(args, min, max) {
    if (args.length < min || args.length > max) throw new XlError(ERR.VALUE);
  }

  function roundTo(x, d) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    let r;
    if (d >= 0) {
      r = Number(Math.round(Number(x + 'e' + d)) + 'e-' + d);
      if (isNaN(r)) r = Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
    } else {
      const f = Math.pow(10, -d);
      r = Math.round(x / f) * f;
    }
    return s * r;
  }

  const FUNCS = {
    SUM: (a) => nums(a).reduce((x, y) => x + y, 0),
    AVERAGE: (a) => {
      const n = nums(a);
      if (!n.length) throw new XlError(ERR.DIV0);
      return n.reduce((x, y) => x + y, 0) / n.length;
    },
    MIN: (a) => {
      const n = nums(a);
      return n.length ? Math.min.apply(null, n) : 0;
    },
    MAX: (a) => {
      const n = nums(a);
      return n.length ? Math.max.apply(null, n) : 0;
    },
    PRODUCT: (a) => nums(a).reduce((x, y) => x * y, 1),
    MEDIAN: (a) => {
      const n = nums(a).sort((x, y) => x - y);
      if (!n.length) throw new XlError(ERR.NUM);
      const m = n.length >> 1;
      return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
    },
    COUNT: (a) => {
      let c = 0;
      for (const x of a) {
        if (isRange(x)) {
          for (const row of x.rows) for (const v of row) if (typeof v === 'number') c++;
        } else if (typeof x === 'number' || typeof x === 'boolean') {
          c++;
        } else if (typeof x === 'string' && NUM_RE.test(x.trim())) {
          c++;
        }
      }
      return c;
    },
    COUNTA: (a) => flat(a).filter((v) => v !== null && v !== undefined && v !== '').length,
    ABS: (a) => (need(a, 1, 1), Math.abs(toNum(scalar(a[0])))),
    SQRT: (a) => {
      need(a, 1, 1);
      const x = toNum(scalar(a[0]));
      if (x < 0) throw new XlError(ERR.NUM);
      return Math.sqrt(x);
    },
    POWER: (a) => {
      need(a, 2, 2);
      const r = Math.pow(toNum(scalar(a[0])), toNum(scalar(a[1])));
      if (!isFinite(r)) throw new XlError(ERR.NUM);
      return r;
    },
    MOD: (a) => {
      need(a, 2, 2);
      const x = toNum(scalar(a[0]));
      const y = toNum(scalar(a[1]));
      if (y === 0) throw new XlError(ERR.DIV0);
      return x - y * Math.floor(x / y);
    },
    INT: (a) => (need(a, 1, 1), Math.floor(toNum(scalar(a[0])))),
    ROUND: (a) => {
      need(a, 1, 2);
      return roundTo(toNum(scalar(a[0])), a.length > 1 ? Math.trunc(toNum(scalar(a[1]))) : 0);
    },
    PI: (a) => (need(a, 0, 0), Math.PI),
    AND: (a) => {
      const v = flat(a).filter((x) => x !== null && x !== undefined);
      if (!v.length) throw new XlError(ERR.VALUE);
      return v.every((x) => toBool(x));
    },
    OR: (a) => {
      const v = flat(a).filter((x) => x !== null && x !== undefined);
      if (!v.length) throw new XlError(ERR.VALUE);
      return v.some((x) => toBool(x));
    },
    NOT: (a) => (need(a, 1, 1), !toBool(scalar(a[0]))),
    CONCAT: (a) => flat(a).map(toText).join(''),
    CONCATENATE: (a) => flat(a).map(toText).join(''),
    UPPER: (a) => (need(a, 1, 1), toText(scalar(a[0])).toUpperCase()),
    LOWER: (a) => (need(a, 1, 1), toText(scalar(a[0])).toLowerCase()),
    LEN: (a) => (need(a, 1, 1), toText(scalar(a[0])).length),
    TRIM: (a) => (need(a, 1, 1), toText(scalar(a[0])).trim().replace(/\s+/g, ' ')),
    LEFT: (a) => {
      need(a, 1, 2);
      const n = a.length > 1 ? Math.trunc(toNum(scalar(a[1]))) : 1;
      if (n < 0) throw new XlError(ERR.VALUE);
      return toText(scalar(a[0])).slice(0, n);
    },
    RIGHT: (a) => {
      need(a, 1, 2);
      const n = a.length > 1 ? Math.trunc(toNum(scalar(a[1]))) : 1;
      if (n < 0) throw new XlError(ERR.VALUE);
      const s = toText(scalar(a[0]));
      return n === 0 ? '' : s.slice(-n);
    },
    MID: (a) => {
      need(a, 3, 3);
      const s = toText(scalar(a[0]));
      const start = Math.trunc(toNum(scalar(a[1])));
      const n = Math.trunc(toNum(scalar(a[2])));
      if (start < 1 || n < 0) throw new XlError(ERR.VALUE);
      return s.substr(start - 1, n);
    },
    TODAY: (a) => {
      need(a, 0, 0);
      const d = new Date();
      return NumFmt.dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate());
    },
    NOW: (a) => {
      need(a, 0, 0);
      const d = new Date();
      return NumFmt.dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
    },
    DATE: (a) => {
      need(a, 3, 3);
      const y = Math.trunc(toNum(scalar(a[0])));
      const m = Math.trunc(toNum(scalar(a[1])));
      const d = Math.trunc(toNum(scalar(a[2])));
      if (y < 0 || y > 9999) throw new XlError(ERR.NUM);
      const yy = y < 1900 ? y + 1900 : y;
      const s = Math.round((Date.UTC(yy, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
      if (s < 0) throw new XlError(ERR.NUM);
      return s;
    },
    YEAR: (a) => (need(a, 1, 1), NumFmt.serialToDate(toNum(scalar(a[0]))).y),
    MONTH: (a) => (need(a, 1, 1), NumFmt.serialToDate(toNum(scalar(a[0]))).m),
    DAY: (a) => (need(a, 1, 1), NumFmt.serialToDate(toNum(scalar(a[0]))).d),
    WEEKDAY: (a) => {
      need(a, 1, 2);
      const wd = NumFmt.serialToDate(toNum(scalar(a[0]))).wd;
      const type = a.length > 1 ? toNum(scalar(a[1])) : 1;
      if (type === 2) return wd === 0 ? 7 : wd;
      if (type === 3) return wd === 0 ? 6 : wd - 1;
      return wd + 1;
    },
    TEXT: (a) => {
      need(a, 2, 2);
      const v = scalar(a[0]);
      if (v instanceof XlError) throw v;
      const code = toText(scalar(a[1]));
      const value = typeof v === 'string' && NUM_RE.test(v.trim()) ? Number(v) : v === null || v === undefined ? 0 : v;
      return NumFmt.format(value, code).text.replace(NumFmt.FILL, '');
    },
    COUNTIF: (a) => {
      need(a, 2, 2);
      if (!isRange(a[0])) throw new XlError(ERR.VALUE);
      const test = makeCriteria(scalar(a[1]));
      let c = 0;
      for (const row of a[0].rows) for (const v of row) if (test(v)) c++;
      return c;
    },
    SUMIF: (a) => {
      need(a, 2, 3);
      if (!isRange(a[0])) throw new XlError(ERR.VALUE);
      const test = makeCriteria(scalar(a[1]));
      const target = a.length > 2 ? a[2] : a[0];
      if (!isRange(target)) throw new XlError(ERR.VALUE);
      let sum = 0;
      a[0].rows.forEach((row, i) =>
        row.forEach((v, j) => {
          if (!test(v)) return;
          const t = target.rows[i] ? target.rows[i][j] : null;
          if (t instanceof XlError) throw t;
          if (typeof t === 'number') sum += t;
        })
      );
      return sum;
    }
  };

  /* ---------- sheet ---------- */

  class Sheet {
    constructor(opts) {
      opts = opts || {};
      this.rows = opts.rows || 200;
      this.cols = opts.cols || 26;
      this.cells = new Map(); // key -> raw text
      this.ast = new Map(); // key -> parsed formula (or {k:'err'})
      this.cache = new Map(); // key -> computed value
      this.prec = new Map(); // key -> Set of keys it reads
      this.deps = new Map(); // key -> Set of keys that read it
      this.visiting = new Set();
    }

    getRaw(k) {
      const v = this.cells.get(k);
      return v === undefined ? '' : v;
    }

    setRaw(k, raw) {
      raw = raw === null || raw === undefined ? '' : String(raw);
      if (raw === '') this.cells.delete(k);
      else this.cells.set(k, raw);
      this._rewire(k);
      this._invalidate(k);
    }

    clear() {
      this.cells.clear();
      this.ast.clear();
      this.cache.clear();
      this.prec.clear();
      this.deps.clear();
    }

    inBounds(r, c) {
      return r >= 0 && c >= 0 && r < this.rows && c < this.cols;
    }

    _rewire(k) {
      const old = this.prec.get(k);
      if (old) {
        for (const p of old) {
          const d = this.deps.get(p);
          if (d) {
            d.delete(k);
            if (!d.size) this.deps.delete(p);
          }
        }
        this.prec.delete(k);
      }
      this.ast.delete(k);
      const raw = this.cells.get(k);
      if (raw === undefined || raw[0] !== '=') return;
      let ast;
      try {
        ast = parse(raw.slice(1));
      } catch (e) {
        ast = { k: 'err', code: e instanceof XlError ? e.code : ERR.PARSE };
      }
      this.ast.set(k, ast);
      const set = new Set();
      this._collect(ast, set);
      if (set.size) {
        this.prec.set(k, set);
        for (const p of set) {
          let d = this.deps.get(p);
          if (!d) this.deps.set(p, (d = new Set()));
          d.add(k);
        }
      }
    }

    _collect(n, set) {
      if (!n) return;
      switch (n.k) {
        case 'ref':
          if (this.inBounds(n.a.r, n.a.c)) set.add(key(n.a.r, n.a.c));
          break;
        case 'range': {
          const r1 = Math.max(0, Math.min(n.a.r, n.b.r));
          const r2 = Math.min(this.rows - 1, Math.max(n.a.r, n.b.r));
          const c1 = Math.max(0, Math.min(n.a.c, n.b.c));
          const c2 = Math.min(this.cols - 1, Math.max(n.a.c, n.b.c));
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) set.add(key(r, c));
          break;
        }
        case 'bin':
          this._collect(n.l, set);
          this._collect(n.r, set);
          break;
        case 'neg':
        case 'pct':
          this._collect(n.e, set);
          break;
        case 'call':
          n.args.forEach((x) => this._collect(x, set));
          break;
        default:
      }
    }

    _invalidate(k) {
      const stack = [k];
      const seen = new Set();
      while (stack.length) {
        const x = stack.pop();
        if (seen.has(x)) continue;
        seen.add(x);
        this.cache.delete(x);
        const d = this.deps.get(x);
        if (d) for (const y of d) stack.push(y);
      }
    }

    getValue(k) {
      const raw = this.cells.get(k);
      if (raw === undefined) return null;
      if (raw[0] !== '=') return parseLiteral(raw);
      if (this.cache.has(k)) return this.cache.get(k);
      if (this.visiting.has(k)) return new XlError(ERR.CIRC);
      this.visiting.add(k);
      let v;
      try {
        v = this._eval(this.ast.get(k));
        if (isRange(v)) v = v.rows[0][0];
        if (v === undefined) v = null;
        if (typeof v === 'number' && !isFinite(v)) v = new XlError(ERR.NUM);
      } catch (e) {
        if (e instanceof XlError) v = e;
        else {
          if (typeof console !== 'undefined') console.error(e);
          v = new XlError(ERR.VALUE);
        }
      } finally {
        this.visiting.delete(k);
      }
      this.cache.set(k, v);
      return v;
    }

    _refValue(a) {
      if (!this.inBounds(a.r, a.c)) throw new XlError(ERR.REF);
      return this.getValue(key(a.r, a.c));
    }

    _range(a, b) {
      const r1 = Math.min(a.r, b.r);
      const r2 = Math.max(a.r, b.r);
      const c1 = Math.min(a.c, b.c);
      const c2 = Math.max(a.c, b.c);
      if (!this.inBounds(r1, c1) || !this.inBounds(r2, c2)) throw new XlError(ERR.REF);
      const rows = [];
      for (let r = r1; r <= r2; r++) {
        const row = [];
        for (let c = c1; c <= c2; c++) row.push(this.getValue(key(r, c)));
        rows.push(row);
      }
      return { range: true, rows };
    }

    // Evaluate to a plain value; errors are returned, not thrown.
    _safe(n) {
      try {
        const v = this._eval(n);
        return isRange(v) ? scalar(v) : v;
      } catch (e) {
        if (e instanceof XlError) return e;
        throw e;
      }
    }

    _sv(n) {
      const v = this._eval(n);
      return scalar(v);
    }

    _eval(n) {
      switch (n.k) {
        case 'num':
        case 'str':
        case 'bool':
          return n.v;
        case 'err':
          throw new XlError(n.code);
        case 'ref': {
          const v = this._refValue(n.a);
          if (v instanceof XlError) throw v;
          return v;
        }
        case 'range':
          return this._range(n.a, n.b);
        case 'neg':
          return -toNum(this._sv(n.e));
        case 'pct':
          return toNum(this._sv(n.e)) / 100;
        case 'bin': {
          const a = this._sv(n.l);
          const b = this._sv(n.r);
          switch (n.op) {
            case '+': return toNum(a) + toNum(b);
            case '-': return toNum(a) - toNum(b);
            case '*': return toNum(a) * toNum(b);
            case '/': {
              const d = toNum(b);
              if (d === 0) throw new XlError(ERR.DIV0);
              return toNum(a) / d;
            }
            case '^': {
              const r = Math.pow(toNum(a), toNum(b));
              if (!isFinite(r)) throw new XlError(ERR.NUM);
              return r;
            }
            case '&': return toText(a) + toText(b);
            case '=': return compare(a, b) === 0;
            case '<>': return compare(a, b) !== 0;
            case '<': return compare(a, b) < 0;
            case '>': return compare(a, b) > 0;
            case '<=': return compare(a, b) <= 0;
            case '>=': return compare(a, b) >= 0;
            default: throw new XlError(ERR.PARSE);
          }
        }
        case 'call':
          return this._call(n);
        default:
          throw new XlError(ERR.PARSE);
      }
    }

    _call(n) {
      const name = n.name;
      switch (name) {
        case 'IF': {
          need(n.args, 2, 3);
          const cond = toBool(this._sv(n.args[0]));
          if (cond) return this._sv(n.args[1]);
          return n.args.length > 2 ? this._sv(n.args[2]) : false;
        }
        case 'IFERROR': {
          need(n.args, 2, 2);
          const v = this._safe(n.args[0]);
          return v instanceof XlError ? this._sv(n.args[1]) : v;
        }
        case 'ISERROR':
          need(n.args, 1, 1);
          return this._safe(n.args[0]) instanceof XlError;
        case 'ISNUMBER':
          need(n.args, 1, 1);
          return typeof this._safe(n.args[0]) === 'number';
        case 'ISTEXT':
          need(n.args, 1, 1);
          return typeof this._safe(n.args[0]) === 'string';
        case 'ISBLANK': {
          need(n.args, 1, 1);
          const v = this._safe(n.args[0]);
          return v === null || v === undefined;
        }
        default:
      }
      const fn = FUNCS[name];
      if (!fn) throw new XlError(ERR.NAME);
      const args = n.args.map((a) => {
        if (a.k === 'ref') {
          const v = this._refValue(a.a);
          return { range: true, rows: [[v]] };
        }
        return this._eval(a);
      });
      return fn(args);
    }

    toJSON() {
      const out = {};
      for (const [k, v] of this.cells) out[k] = v;
      return out;
    }
  }

  return {
    Sheet,
    XlError,
    ERR,
    colToName,
    nameToCol,
    key,
    parseKey,
    parse,
    tokenize,
    shiftFormula,
    parseLiteral,
    inferFormat,
    numToStr,
    FUNCS
  };
});
