/*
 * Tally Excel support: reads and writes .xlsx files (a zip of XML) with no libraries.
 * read(bytes)  -> sheet model in Tally terms (raw cell text, formats, merges, widths)
 * write(model) -> bytes of a .xlsx file
 * Uses the standard DecompressionStream / CompressionStream, so it works in the browser,
 * in the desktop app and in Node tests. No DOM needed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TallyXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- zip ---------- */

  const td = new TextDecoder('utf-8');
  const te = new TextEncoder();

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function deflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = td.decode(bytes.subarray(p + 46, p + 46 + nlen));
      files.set(name, { method, csize, off });
      p += 46 + nlen + xlen + clen;
    }
    return {
      has: (n) => files.has(n),
      async read(n) {
        const f = files.get(n);
        if (!f) return null;
        const lh = f.off;
        const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
        const data = bytes.subarray(start, start + f.csize);
        if (f.method === 0) return data;
        if (f.method === 8) return inflateRaw(data);
        throw new Error('Unsupported compression in the Excel file');
      },
      async text(n) {
        const d = await this.read(n);
        return d ? td.decode(d) : null;
      }
    };
  }

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function zip(entries) {
    const chunks = [];
    const central = [];
    let off = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, text] of entries) {
      const raw = te.encode(text);
      let data = raw;
      let method = 0;
      if (typeof CompressionStream !== 'undefined' && raw.length > 64) {
        data = await deflateRaw(raw);
        method = 8;
      }
      const nm = te.encode(name);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, method, true);
      lh.setUint16(10, dosTime, true);
      lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc32(raw), true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, raw.length, true);
      lh.setUint16(26, nm.length, true);
      chunks.push(new Uint8Array(lh.buffer), nm, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, method, true);
      ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc32(raw), true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, raw.length, true);
      ch.setUint16(28, nm.length, true);
      ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    let csize = 0;
    for (const c of central) csize += c.length;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, off, true);
    const all = [...chunks, ...central, new Uint8Array(end.buffer)];
    let total = 0;
    for (const c of all) total += c.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of all) { out.set(c, o); o += c.length; }
    return out;
  }

  /* ---------- tiny XML reader ---------- */

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unesc = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] !== undefined ? ENT[e] : m;
  }));

  // Returns a tree of { n: name, a: attributes, c: children, t: text }. Namespace prefixes are dropped.
  function parseXml(src) {
    const root = { n: '#', a: {}, c: [], t: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.t += m[1];
      else if (m[6] !== undefined) top.t += unesc(m[6]);
      else if (m[3]) {
        const name = m[3].replace(/^[\w.-]+:/, '');
        if (m[2]) {
          if (stack.length > 1) stack.pop();
        } else {
          const node = { n: name, a: {}, c: [], t: '' };
          let am;
          attrRe.lastIndex = 0;
          while ((am = attrRe.exec(m[4]))) node.a[am[1].replace(/^[\w.-]+:/, '')] = unesc(am[2] !== undefined ? am[2] : am[3]);
          top.c.push(node);
          if (!m[5]) stack.push(node);
        }
      }
    }
    return root;
  }
  const kids = (n, name) => (n ? n.c.filter((x) => x.n === name) : []);
  const kid = (n, name) => (n ? n.c.find((x) => x.n === name) : undefined);
  const textOf = (n) => (n ? n.t + n.c.map(textOf).join('') : '');

  /* ---------- cell references ---------- */

  const colNum = (s) => {
    let n = 0;
    for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };
  const colName = (c) => {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  function parseRef(ref) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(ref);
    return m ? { r: +m[2] - 1, c: colNum(m[1]) } : null;
  }
  function parseRange(ref) {
    const [a, b] = ref.split(':');
    const p = parseRef(a);
    const q = parseRef(b || a);
    return p && q ? { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) } : null;
  }

  // Moves the relative references of a shared formula to a new cell.
  function shiftFormula(f, dr, dc) {
    return f.replace(/("(?:[^"]|"")*")|('(?:[^']|'')*'!)|(?<![\w.])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])/g, (m, str, sheet, d1, col, d2, row) => {
      if (str || sheet) return m;
      const c = d1 ? col : colName(colNum(col) + dc);
      const r = d2 ? +row : +row + dr;
      if (r < 1 || colNum(c) < 0) return '#REF!';
      return d1 + c + d2 + r;
    });
  }

  /* ---------- reading ---------- */

  const BUILTIN_NF = {
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
    14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss',
    22: 'm/d/yyyy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
    45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@'
  };
  const INDEXED = [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff,
    0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xc0c0c0, 0x808080, 0x9999ff, 0x993366, 0xffffcc, 0xccffff, 0x660066, 0xff8080, 0x0066cc, 0xccccff,
    0x000080, 0xff00ff, 0xffff00, 0x00ffff, 0x800080, 0x800000, 0x008080, 0x0000ff, 0x00ccff, 0xccffff, 0xccffcc, 0xffff99, 0x99ccff, 0xff99cc, 0xcc99ff, 0xffcc99,
    0x3366ff, 0x33ccff, 0x99cc00, 0xffcc00, 0xff9900, 0xff6600, 0x666699, 0x969696, 0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333];
  const hex6 = (n) => '#' + n.toString(16).padStart(6, '0');
  const BORDER_STYLE = { thin: 'thin', hair: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', mediumDashed: 'dashed', dashDot: 'dashed', mediumDashDot: 'dashed', dashDotDot: 'dashed', mediumDashDotDot: 'dashed', slantDashDot: 'dashed', dotted: 'dotted', double: 'double' };

  // An Excel color element -> a Tally color: a hex string or a theme reference like "t:4:0.4".
  function colorOf(n) {
    if (!n) return '';
    if (n.a.rgb) return '#' + n.a.rgb.slice(-6).toLowerCase();
    if (n.a.theme !== undefined && +n.a.theme <= 9) {
      const idx = +n.a.theme;
      return 't:' + idx + ':' + (parseFloat(n.a.tint) || 0);
    }
    if (n.a.indexed !== undefined && INDEXED[+n.a.indexed] !== undefined) return hex6(INDEXED[+n.a.indexed]);
    return '';
  }

  function parseStyles(doc) {
    const out = { xfs: [] };
    if (!doc) return out;
    const ss = kid(doc, 'styleSheet');
    const nfCodes = {};
    for (const n of kids(kid(ss, 'numFmts'), 'numFmt')) nfCodes[n.a.numFmtId] = n.a.formatCode;
    const fonts = kids(kid(ss, 'fonts'), 'font').map((f) => {
      const o = {};
      if (kid(f, 'b') && kid(f, 'b').a.val !== '0') o.b = true;
      if (kid(f, 'i') && kid(f, 'i').a.val !== '0') o.i = true;
      if (kid(f, 'strike') && kid(f, 'strike').a.val !== '0') o.s = true;
      const u = kid(f, 'u');
      if (u && u.a.val !== 'none') o.u = u.a.val === 'double' || u.a.val === 'doubleAccounting' ? 'double' : true;
      const sz = kid(f, 'sz');
      if (sz && +sz.a.val && +sz.a.val !== 11) o.size = +sz.a.val;
      const nm = kid(f, 'name');
      if (nm && nm.a.val && nm.a.val !== 'Calibri') o.font = nm.a.val;
      const col = colorOf(kid(f, 'color'));
      if (col && col !== 't:1:0') o.color = col;
      return o;
    });
    const fills = kids(kid(ss, 'fills'), 'fill').map((f) => {
      const p = kid(f, 'patternFill');
      if (!p || p.a.patternType !== 'solid') return '';
      return colorOf(kid(p, 'fgColor')) || '';
    });
    const borders = kids(kid(ss, 'borders'), 'border').map((b) => {
      const o = {};
      for (const [side, k] of [['left', 'l'], ['right', 'r'], ['top', 't'], ['bottom', 'b']]) {
        const e = kid(b, side);
        if (e && e.a.style && BORDER_STYLE[e.a.style]) {
          const c = colorOf(kid(e, 'color'));
          o[k] = c && c !== 't:1:0' ? { s: BORDER_STYLE[e.a.style], c } : { s: BORDER_STYLE[e.a.style] };
        }
      }
      return Object.keys(o).length ? o : null;
    });
    for (const xf of kids(kid(ss, 'cellXfs'), 'xf')) {
      const f = {};
      const id = +xf.a.numFmtId || 0;
      const code = nfCodes[id] !== undefined ? nfCodes[id] : BUILTIN_NF[id];
      if (code && code !== 'General') f.nf = code;
      Object.assign(f, fonts[+xf.a.fontId] || {});
      const bg = fills[+xf.a.fillId];
      if (bg) f.bg = bg;
      const bd = borders[+xf.a.borderId];
      if (bd) f.bd = JSON.parse(JSON.stringify(bd));
      const al = kid(xf, 'alignment');
      if (al) {
        const h = al.a.horizontal;
        if (h === 'left' || h === 'right' || h === 'center' || h === 'justify') f.align = h;
        else if (h === 'centerContinuous') f.align = 'center';
        const v = al.a.vertical;
        if (v === 'top') f.va = 'top';
        else if (v === 'center') f.va = 'middle';
        if (al.a.wrapText === '1' || al.a.wrapText === 'true') f.wrap = true;
        if (+al.a.indent > 0) f.indent = Math.min(+al.a.indent, 15);
      }
      out.xfs.push(f);
    }
    return out;
  }

  // Text that Tally would otherwise read as a number, date, boolean or formula gets a leading ' so it stays text.
  const looksTyped = (s) =>
    /^[=']/.test(s) || /^(true|false)$/i.test(s) || /^[\s$€£¥+\-]*[\d.,]+\s*%?\s*$/.test(s) ||
    /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(s) || /^\d{1,2}:\d{2}/.test(s) || /^#[A-Z/0!?]+!?$/.test(s);
  const textRaw = (s) => (looksTyped(s) ? "'" + s : s);

  async function read(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const z = await unzip(bytes);
    if (!z.has('xl/workbook.xml')) throw new Error('This is not an Excel (.xlsx) file');
    const wb = parseXml(await z.text('xl/workbook.xml'));
    const book = kid(wb, 'workbook');
    const date1904 = !!(kid(book, 'workbookPr') && ['1', 'true'].includes(kid(book, 'workbookPr').a.date1904));
    const sheetNodes = kids(kid(book, 'sheets'), 'sheet');
    if (!sheetNodes.length) throw new Error('The Excel file has no sheets');
    const rels = {};
    const relDoc = await z.text('xl/_rels/workbook.xml.rels');
    if (relDoc) for (const r of kids(kid(parseXml(relDoc), 'Relationships'), 'Relationship')) rels[r.a.Id] = r.a.Target;
    const sheetNames = sheetNodes.map((s) => s.a.name);
    const first = sheetNodes.find((s) => s.a.state !== 'hidden') || sheetNodes[0];
    let target = rels[first.a.id] || 'worksheets/sheet1.xml';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const sheetDoc = await z.text(target);
    if (!sheetDoc) throw new Error('Could not find the first sheet in the Excel file');

    const shared = [];
    const sstDoc = await z.text('xl/sharedStrings.xml');
    if (sstDoc) {
      for (const si of kids(kid(parseXml(sstDoc), 'sst'), 'si')) {
        // plain text and rich-text runs count; phonetic hints (rPh) do not
        shared.push(si.c.filter((x) => x.n === 't' || x.n === 'r').map((x) => (x.n === 't' ? x.t : kids(x, 't').map((t) => t.t).join(''))).join(''));
      }
    }
    const styles = parseStyles(parseXml((await z.text('xl/styles.xml')) || ''));
    const ws = kid(parseXml(sheetDoc), 'worksheet');

    const model = { sheetName: first.a.name, sheetNames, cells: [], fmts: styles.xfs.filter(() => true), merges: [], colWidths: {}, rowHeights: {}, date1904 };
    const fmtUsed = new Set();

    const cols = kid(ws, 'cols');
    for (const c of kids(cols, 'col')) {
      if (c.a.width === undefined) continue;
      const w = parseFloat(c.a.width);
      if (!(w > 0) || c.a.hidden === '1') continue;
      const px = Math.round(w * 7 + 5);
      for (let i = +c.a.min; i <= Math.min(+c.a.max, 1326); i++) model.colWidths[i - 1] = px;
    }

    const sharedMasters = new Map();
    const data = kid(ws, 'sheetData');
    for (const row of kids(data, 'row')) {
      const rIdx = row.a.r !== undefined ? +row.a.r - 1 : -1;
      if (rIdx >= 0 && (row.a.customHeight === '1' || row.a.customHeight === 'true') && row.a.ht) model.rowHeights[rIdx] = Math.round(parseFloat(row.a.ht) * (96 / 72));
      let nextCol = 0;
      for (const c of kids(row, 'c')) {
        const pos = c.a.r ? parseRef(c.a.r) : { r: rIdx, c: nextCol };
        if (!pos) continue;
        nextCol = pos.c + 1;
        const xf = c.a.s !== undefined ? +c.a.s : 0;
        const fNode = kid(c, 'f');
        const vNode = kid(c, 'v');
        let raw = '';
        if (fNode) {
          let f = fNode.t;
          if (fNode.a.t === 'shared') {
            if (f) sharedMasters.set(fNode.a.si, { f, r: pos.r, c: pos.c });
            else {
              const m = sharedMasters.get(fNode.a.si);
              if (m) f = shiftFormula(m.f, pos.r - m.r, pos.c - m.c);
            }
          }
          if (f) raw = '=' + f;
        }
        if (!raw) {
          const t = c.a.t;
          if (t === 's' && vNode) raw = textRaw(shared[+vNode.t] || '');
          else if (t === 'inlineStr') raw = textRaw(textOf(kid(c, 'is')));
          else if (t === 'str' && vNode) raw = textRaw(vNode.t);
          else if (t === 'b' && vNode) raw = vNode.t.trim() === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'e' && vNode) raw = "'" + vNode.t;
          else if (vNode && vNode.t.trim() !== '') {
            const n = Number(vNode.t);
            raw = isNaN(n) ? textRaw(vNode.t) : String(n);
          }
        }
        const fmt = styles.xfs[xf];
        const styled = fmt && Object.keys(fmt).length > 0;
        if (raw === '' && !styled) continue;
        if (styled) fmtUsed.add(xf);
        model.cells.push({ r: pos.r, c: pos.c, raw, xf: styled ? xf : -1 });
      }
    }

    for (const m of kids(kid(ws, 'mergeCells'), 'mergeCell')) {
      const rg = parseRange(m.a.ref || '');
      if (rg && (rg.r1 !== rg.r2 || rg.c1 !== rg.c2)) model.merges.push(rg);
    }
    return model;
  }

  /* ---------- writing ---------- */

  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const OUT_STYLE = { thin: 'thin', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' };

  /*
   * model = { cells: [{ r, c, v, f?, t? }], fmts: [{ r, c, fmt }], colWidths: {c: px}, rowHeights: {r: px},
   *           merges: [{r1,c1,r2,c2}], resolveColor(c) -> '#rrggbb', defaultColPx, defaultRowPx }
   * v is a number, string, boolean or { error: '#N/A' }; f is the formula without '='.
   */
  async function write(model) {
    const resolve = model.resolveColor || ((c) => c);
    const argb = (c) => 'FF' + String(resolve(c) || '#000000').replace('#', '').toUpperCase().padStart(6, '0');
    const nfIds = new Map();
    const fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    const idx = (list, xml) => {
      let i = list.indexOf(xml);
      if (i < 0) { list.push(xml); i = list.length - 1; }
      return i;
    };
    const xfCache = new Map();
    const BUILTIN_BY_CODE = {};
    for (const [id, code] of Object.entries(BUILTIN_NF)) if (!(code in BUILTIN_BY_CODE)) BUILTIN_BY_CODE[code] = +id;

    function xfFor(fmt) {
      if (!fmt || !Object.keys(fmt).length) return 0;
      const sig = JSON.stringify(fmt);
      if (xfCache.has(sig)) return xfCache.get(sig);
      let nfId = 0;
      if (fmt.nf && fmt.nf !== 'General') {
        if (BUILTIN_BY_CODE[fmt.nf] !== undefined) nfId = BUILTIN_BY_CODE[fmt.nf];
        else {
          if (!nfIds.has(fmt.nf)) nfIds.set(fmt.nf, 164 + nfIds.size);
          nfId = nfIds.get(fmt.nf);
        }
      }
      let font = '<font>';
      if (fmt.b) font += '<b/>';
      if (fmt.i) font += '<i/>';
      if (fmt.s) font += '<strike/>';
      if (fmt.u) font += fmt.u === 'double' ? '<u val="double"/>' : '<u/>';
      font += '<sz val="' + (fmt.size || 11) + '"/>';
      font += fmt.color ? '<color rgb="' + argb(fmt.color) + '"/>' : '';
      const fname = fmt.font && !String(fmt.font).startsWith('theme:') ? fmt.font : 'Calibri';
      font += '<name val="' + esc(fname) + '"/><family val="2"/></font>';
      const fontId = idx(fonts, font);
      const fillId = fmt.bg ? idx(fills, '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(fmt.bg) + '"/><bgColor indexed="64"/></patternFill></fill>') : 0;
      let borderId = 0;
      if (fmt.bd) {
        let b = '<border>';
        for (const [k, tag] of [['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom']]) {
          const e = fmt.bd[k];
          if (e && OUT_STYLE[e.s]) b += '<' + tag + ' style="' + OUT_STYLE[e.s] + '"><color ' + (e.c && e.c !== 'auto' ? 'rgb="' + argb(e.c) + '"' : 'auto="1"') + '/></' + tag + '>';
          else b += '<' + tag + '/>';
        }
        b += '<diagonal/></border>';
        borderId = idx(borders, b);
      }
      let al = '';
      const attrs = [];
      if (fmt.align) attrs.push('horizontal="' + fmt.align + '"');
      if (fmt.va && fmt.va !== 'bottom') attrs.push('vertical="' + (fmt.va === 'middle' ? 'center' : 'top') + '"');
      if (fmt.wrap) attrs.push('wrapText="1"');
      if (fmt.indent) attrs.push('indent="' + fmt.indent + '"');
      if (attrs.length) al = '<alignment ' + attrs.join(' ') + '/>';
      const xf = '<xf numFmtId="' + nfId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"' +
        (nfId ? ' applyNumberFormat="1"' : '') + (fontId ? ' applyFont="1"' : '') + (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') +
        (al ? ' applyAlignment="1">' + al + '</xf>' : '/>');
      xfs.push(xf);
      xfCache.set(sig, xfs.length - 1);
      return xfs.length - 1;
    }

    // gather cells by row
    const rows = new Map();
    const at = (r, c) => {
      if (!rows.has(r)) rows.set(r, new Map());
      const row = rows.get(r);
      if (!row.has(c)) row.set(c, {});
      return row.get(c);
    };
    for (const x of model.cells) Object.assign(at(x.r, x.c), { v: x.v, f: x.f });
    for (const x of model.fmts) at(x.r, x.c).s = xfFor(x.fmt);

    const defW = model.defaultColPx || 96;
    const defH = model.defaultRowPx || 24;
    let sheet = XML + '<worksheet ' + NS + '><sheetFormatPr defaultColWidth="' + (Math.max(1, (defW - 5) / 7)).toFixed(2) + '" defaultRowHeight="' + (defH * 0.75) + '" customHeight="1"/>';
    const widths = Object.keys(model.colWidths || {}).map(Number).filter((c) => model.colWidths[c] !== defW).sort((a, b) => a - b);
    if (widths.length) {
      sheet += '<cols>' + widths.map((c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + (Math.max(1, (model.colWidths[c] - 5) / 7)).toFixed(2) + '" customWidth="1"/>').join('') + '</cols>';
    }
    sheet += '<sheetData>';
    const rowKeys = new Set([...rows.keys(), ...Object.keys(model.rowHeights || {}).map(Number)]);
    for (const r of [...rowKeys].sort((a, b) => a - b)) {
      const ht = model.rowHeights && model.rowHeights[r];
      sheet += '<row r="' + (r + 1) + '"' + (ht ? ' ht="' + (ht * 0.75).toFixed(2) + '" customHeight="1"' : '') + '>';
      const row = rows.get(r);
      if (row) {
        for (const c of [...row.keys()].sort((a, b) => a - b)) {
          const cell = row.get(c);
          const ref = colName(c) + (r + 1);
          const s = cell.s ? ' s="' + cell.s + '"' : '';
          const v = cell.v;
          const f = cell.f ? '<f>' + esc(cell.f) + '</f>' : '';
          if (v === undefined || v === null || v === '') {
            sheet += f ? '<c r="' + ref + '"' + s + '>' + f + '</c>' : '<c r="' + ref + '"' + s + '/>';
          } else if (typeof v === 'number') {
            sheet += '<c r="' + ref + '"' + s + '>' + f + '<v>' + (isFinite(v) ? v : 0) + '</v></c>';
          } else if (typeof v === 'boolean') {
            sheet += '<c r="' + ref + '"' + s + ' t="b">' + f + '<v>' + (v ? 1 : 0) + '</v></c>';
          } else if (typeof v === 'object' && v.error) {
            sheet += '<c r="' + ref + '"' + s + ' t="e">' + f + '<v>' + esc(v.error) + '</v></c>';
          } else if (f) {
            sheet += '<c r="' + ref + '"' + s + ' t="str">' + f + '<v>' + esc(v) + '</v></c>';
          } else {
            sheet += '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
          }
        }
      }
      sheet += '</row>';
    }
    sheet += '</sheetData>';
    if (model.merges && model.merges.length) {
      sheet += '<mergeCells count="' + model.merges.length + '">' + model.merges.map((m) => '<mergeCell ref="' + colName(m.c1) + (m.r1 + 1) + ':' + colName(m.c2) + (m.r2 + 1) + '"/>').join('') + '</mergeCells>';
    }
    sheet += '</worksheet>';

    let styles = XML + '<styleSheet ' + NS + '>';
    if (nfIds.size) styles += '<numFmts count="' + nfIds.size + '">' + [...nfIds].map(([code, id]) => '<numFmt numFmtId="' + id + '" formatCode="' + esc(code) + '"/>').join('') + '</numFmts>';
    styles += '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') + '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders>';
    styles += '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>';
    styles += '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

    const name = esc((model.sheetName || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    return zip([
      ['[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', XML + '<workbook ' + NS + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>'],
      ['xl/_rels/workbook.xml.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', styles],
      ['xl/worksheets/sheet1.xml', sheet]
    ]);
  }

  return { read, write, shiftFormula, colName, colNum };
});
