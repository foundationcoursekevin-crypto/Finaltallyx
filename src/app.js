/*
 * Tally renderer: grid UI, editing, selection, clipboard, undo/redo,
 * formatting, charts panel and file handling.
 */
(function () {
  'use strict';

  const { Sheet, key, colToName, parseKey, shiftFormula, inferFormat, parseLiteral } = window.TallyEngine;
  const H = window.TallyHelpers;
  const FILL = window.TallyNumFmt.FILL;
  const T = window.TallyTheme;
  const C = window.TallyCrypto;
  const XL = window.TallyXlsx;
  const ctx = (window.TallyApp = {}); // surface used by format-ui.js

  const ROWS = 5000; // 5000 rows x 1326 columns; only the rows and columns near the screen are drawn
  const ROW_H = 20;
  const ROW_OVER = 60;
  const ROW_START = 120;
  const COLS = 1326; // columns A to AXZ (1326 x 200 = 265,200 cells)
  const WIN_OVER = 30; // columns kept in the page beyond each edge of the viewport
  const WIN_START = 70;
  const HEAD_H = 20;
  const RH_W = 42;
  const DEF_W = 88;
  const MIN_W = 36;

  /* ---------- desktop bridge (falls back to a stub in a plain browser) ---------- */

  const api =
    window.tally ||
    {
      saveAs: async () => null,
      write: async () => null,
      open: async () => null,
      confirm: async () => true,
      setDirty: () => {},
      onMenu: () => {}
    };

  /* ---------- document state ---------- */

  let sheet = new Sheet({ rows: ROWS, cols: COLS });
  let fmts = new Map(); // key -> { b, i, color, bg, align, nf }
  let colWidths = new Array(COLS).fill(DEF_W);
  let rowHeights = {}; // row index -> px (sparse)
  let merges = []; // [{ r1, c1, r2, c2 }]
  let renderedMerges = null;
  let mergedTds = [];
  let cfRules = []; // conditional formatting rules
  let cfStats = [];
  let theme = { colors: T.DEFAULT.colors, fonts: T.DEFAULT.fonts };
  let renderedTheme = null;
  let themeColors = T.colorSet(T.DEFAULT.colors).c;
  let themeFonts = T.fontSet(T.DEFAULT.fonts);
  let painter = null; // copied formats waiting to be painted
  let charts = []; // { id, title, type, range }
  let chartSeq = 0;
  let filePath = null;
  let docLabel = ''; // name shown for a sheet that was imported and not saved yet
  let docPassword = null; // when set, saves are encrypted with it
  let dirty = false;
  let tallyShown = false;
  let selBox = null;

  let anchor = { r: 0, c: 0 };
  let focus = { r: 0, c: 0 };
  let editing = null; // { r, c, source: 'cell' | 'bar', mode: 'enter' | 'edit' }
  let pointRef = null; // { start, text } while building a formula by clicking cells
  let drag = null;
  let tx = null;
  let undoStack = [];
  let redoStack = [];
  let clip = null; // { r1, c1, rows: [[{ raw, fmt }]], text }

  const $ = (id) => document.getElementById(id);
  const wrap = $('grid-wrap');
  const sheetEl = $('sheet');
  const grid = $('grid');
  const selEl = $('sel');
  const editor = $('editor');
  const bar = $('bar');
  const namebox = $('namebox');

  let cellEls = [];
  let colHeads = [];
  let rowHeads = [];
  let colEls = [];
  let bodyEl = null;
  let win = { c0: 0, c1: 0, r0: 0, r1: 0 }; // inclusive range of columns and rows that currently exist as DOM cells
  let rowY = []; // top edge of every row in px, not counting the column-header row
  let rowTrs = [];
  let colX = []; // left edge of every column in px, not counting the row-header column

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- grid construction ---------- */

  function buildGrid() {
    grid.textContent = '';
    const colgroup = document.createElement('colgroup');
    const rhCol = document.createElement('col');
    rhCol.style.width = RH_W + 'px';
    colgroup.appendChild(rhCol);
    colEls = [];
    for (let c = 0; c < COLS; c++) {
      const col = document.createElement('col');
      col.style.width = colWidths[c] + 'px';
      colgroup.appendChild(col);
      colEls.push(col);
    }
    grid.appendChild(colgroup);

    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner';
    corner.dataset.corner = '1';
    htr.appendChild(corner);
    colHeads = [];
    for (let c = 0; c < COLS; c++) {
      const th = document.createElement('th');
      th.className = 'ch';
      th.dataset.c = c;
      th.textContent = colToName(c);
      const rz = document.createElement('div');
      rz.className = 'rz';
      rz.dataset.c = c;
      th.appendChild(rz);
      htr.appendChild(th);
      colHeads.push(th);
    }
    thead.appendChild(htr);
    grid.appendChild(thead);

    bodyEl = document.createElement('tbody');
    grid.appendChild(bodyEl);
    rebuildColX();
    rebuildRowY();
    win = fitMerges(0, Math.min(COLS - 1, WIN_START), 0, Math.min(ROWS - 1, ROW_START));
    fillBody();
    updateTableWidth();
  }

  /* ---------- column window: only the columns near the viewport exist as DOM cells ---------- */

  const headOff = () => (grid.classList.contains('no-heads') ? 0 : RH_W);

  function rebuildColX() {
    colX = new Array(COLS + 1);
    let x = 0;
    for (let c = 0; c < COLS; c++) {
      colX[c] = x;
      x += colWidths[c];
    }
    colX[COLS] = x;
  }

  function colAt(x) {
    let lo = 0;
    let hi = COLS - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (colX[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  const headH = () => (grid.classList.contains('no-heads') ? 0 : HEAD_H);

  function rebuildRowY() {
    rowY = new Array(ROWS + 1);
    let y = 0;
    for (let r = 0; r < ROWS; r++) {
      rowY[r] = y;
      y += rowHeights[r] || ROW_H;
    }
    rowY[ROWS] = y;
  }

  function rowAt(y) {
    let lo = 0;
    let hi = ROWS - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rowY[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // Top and bottom of a row in sheet coordinates: measured when the row is on the page, worked out from heights otherwise.
  function rowTopPx(r) {
    const tr = rowTrs[r];
    if (tr) return tr.getBoundingClientRect().top - sheetEl.getBoundingClientRect().top;
    return headH() + rowY[r];
  }
  function rowBottomPx(r) {
    const tr = rowTrs[r];
    if (tr) return tr.getBoundingClientRect().bottom - sheetEl.getBoundingClientRect().top;
    return headH() + rowY[r + 1];
  }

  // A merged cell must never be cut by the window edge, so widen the window to hold whole merges.
  function fitMerges(c0, c1, r0, r1) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of merges) {
        if (m.c1 <= c1 && m.c2 >= c0 && m.r1 <= r1 && m.r2 >= r0) {
          if (m.c1 < c0) { c0 = m.c1; changed = true; }
          if (m.c2 > c1) { c1 = m.c2; changed = true; }
          if (m.r1 < r0) { r0 = m.r1; changed = true; }
          if (m.r2 > r1) { r1 = m.r2; changed = true; }
        }
      }
    }
    return { c0, c1, r0, r1 };
  }

  function fillBody() {
    const { c0, c1, r0, r1 } = win;
    const parts = [];
    if (r0 > 0) parts.push('<tr class="spr" style="height:' + rowY[r0] + 'px"><td class="sp" colspan="' + (COLS + 1) + '"></td></tr>');
    for (let r = r0; r <= r1; r++) {
      parts.push('<tr' + (rowHeights[r] ? ' style="height:' + rowHeights[r] + 'px"' : '') + '><th class="rh" data-r="' + r + '">' + (r + 1) + '<div class="rzr" data-r="' + r + '"></div></th>');
      if (c0 > 0) parts.push('<td class="sp" colspan="' + c0 + '"></td>');
      for (let c = c0; c <= c1; c++) parts.push('<td data-r="' + r + '" data-c="' + c + '"></td>');
      if (c1 < COLS - 1) parts.push('<td class="sp" colspan="' + (COLS - 1 - c1) + '"></td>');
      parts.push('</tr>');
    }
    if (r1 < ROWS - 1) parts.push('<tr class="spr" style="height:' + (rowY[ROWS] - rowY[r1 + 1]) + 'px"><td class="sp" colspan="' + (COLS + 1) + '"></td></tr>');
    bodyEl.innerHTML = parts.join('');
    cellEls = [];
    rowHeads = [];
    rowTrs = [];
    const off = c0 > 0 ? 2 : 1;
    const first = r0 > 0 ? 1 : 0;
    for (let r = r0; r <= r1; r++) {
      const tr = bodyEl.rows[first + r - r0];
      rowTrs[r] = tr;
      rowHeads[r] = tr.cells[0];
      const row = [];
      for (let c = c0; c <= c1; c++) row[c] = tr.cells[c - c0 + off];
      cellEls[r] = row;
    }
    mergedTds = [];
    renderedMerges = null;
    markRowHeads();
  }

  function markRowHeads() {
    const { r1, r2 } = rect();
    for (let r = win.r0; r <= win.r1; r++) rowHeads[r].classList.toggle('on', r >= r1 && r <= r2);
  }

  // Re-centre the window on what is on screen. force=true guarantees the visible cells exist.
  function syncWindow(force) {
    const x0 = Math.max(0, wrap.scrollLeft - headOff());
    const a = colAt(x0);
    const b = colAt(x0 + wrap.clientWidth);
    const y0 = Math.max(0, wrap.scrollTop - headH());
    const ra = rowAt(y0);
    const rb = rowAt(y0 + wrap.clientHeight);
    const margin = force ? 0 : 6;
    const rmargin = force ? 0 : 20;
    const colsOk = (win.c0 === 0 || a - margin >= win.c0) && (win.c1 === COLS - 1 || b + margin <= win.c1);
    const rowsOk = (win.r0 === 0 || ra - rmargin >= win.r0) && (win.r1 === ROWS - 1 || rb + rmargin <= win.r1);
    if (colsOk && rowsOk) return;
    const w = fitMerges(
      colsOk ? win.c0 : Math.max(0, a - WIN_OVER),
      colsOk ? win.c1 : Math.min(COLS - 1, b + WIN_OVER),
      rowsOk ? win.r0 : Math.max(0, ra - ROW_OVER),
      rowsOk ? win.r1 : Math.min(ROWS - 1, rb + ROW_OVER)
    );
    if (w.c0 === win.c0 && w.c1 === win.c1 && w.r0 === win.r0 && w.r1 === win.r1) return;
    win = w;
    fillBody();
    renderAll();
    placeOverlay();
    if (editing && ctx.onWindowMoved) ctx.onWindowMoved();
  }

  function updateTableWidth() {
    rebuildColX();
    grid.style.width = RH_W + colWidths.reduce((a, b) => a + b, 0) + 'px';
  }

  /* ---------- rendering ---------- */

  function bdCss(b) {
    if (!b) return '';
    const col = !b.c || b.c === 'auto' ? 'var(--ink)' : T.resolve(b.c, themeColors);
    switch (b.s) {
      case 'medium': return '2px solid ' + col;
      case 'thick': return '3px solid ' + col;
      case 'dashed': return '1px dashed ' + col;
      case 'dotted': return '1px dotted ' + col;
      case 'double': return '3px double ' + col;
      default: return '1px solid ' + col;
    }
  }

  const hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mixColor = (c1, c2, t) => {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    t = Math.max(0, Math.min(1, t));
    return '#' + [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0')).join('');
  };

  /* ---- conditional formatting ---- */

  const dupKey = (v) => typeof v + ':' + (typeof v === 'string' ? v.toLowerCase() : String(v));

  function cfPrepare() {
    cfStats = cfRules.map((rule) => {
      const g = rule.range;
      const st = {};
      if (rule.type === 'scale' || rule.type === 'databar') {
        const nums = [];
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
          const v = sheet.getValue(key(r, c));
          if (typeof v === 'number' && isFinite(v)) nums.push(v);
        }
        nums.sort((a, b) => a - b);
        st.min = nums.length ? nums[0] : 0;
        st.max = nums.length ? nums[nums.length - 1] : 0;
        st.mid = nums.length ? (nums.length % 2 ? nums[nums.length >> 1] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : 0;
        st.has = nums.length > 0;
      } else if (rule.type === 'duplicate') {
        st.counts = new Map();
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
          const v = sheet.getValue(key(r, c));
          if (v === null || v === undefined || v instanceof XlErrorCls) continue;
          const k = dupKey(v);
          st.counts.set(k, (st.counts.get(k) || 0) + 1);
        }
      }
      return st;
    });
  }
  const XlErrorCls = window.TallyEngine.XlError;

  function cfEffect(r, c, v) {
    let fmt = null;
    let bar = null;
    for (let i = 0; i < cfRules.length; i++) {
      const rule = cfRules[i];
      const g = rule.range;
      if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue;
      const st = cfStats[i];
      let hit = false;
      switch (rule.type) {
        case 'gt': hit = typeof v === 'number' && v > Number(rule.v1); break;
        case 'lt': hit = typeof v === 'number' && v < Number(rule.v1); break;
        case 'eq': {
          const n = Number(rule.v1);
          if (String(rule.v1).trim() !== '' && !isNaN(n)) hit = typeof v === 'number' && v === n;
          else hit = v !== null && !(v instanceof XlErrorCls) && String(v).toLowerCase() === String(rule.v1).toLowerCase();
          break;
        }
        case 'between': {
          const a = Number(rule.v1);
          const b = Number(rule.v2);
          hit = typeof v === 'number' && v >= Math.min(a, b) && v <= Math.max(a, b);
          break;
        }
        case 'contains':
          hit = v !== null && !(v instanceof XlErrorCls) && String(v).toLowerCase().indexOf(String(rule.text || '').toLowerCase()) !== -1;
          break;
        case 'duplicate':
          hit = v !== null && !(v instanceof XlErrorCls) && (st.counts.get(dupKey(v)) || 0) > 1;
          break;
        case 'scale':
          if (typeof v === 'number' && st.has) {
            const cl = rule.colors;
            let col;
            if (cl.length === 3) {
              col = v <= st.mid
                ? mixColor(cl[0], cl[1], st.mid === st.min ? 1 : (v - st.min) / (st.mid - st.min))
                : mixColor(cl[1], cl[2], st.max === st.mid ? 1 : (v - st.mid) / (st.max - st.mid));
            } else col = mixColor(cl[0], cl[1], st.max === st.min ? 1 : (v - st.min) / (st.max - st.min));
            fmt = Object.assign(fmt || {}, { bg: col });
          }
          break;
        case 'databar':
          if (typeof v === 'number' && st.has) {
            const lo = Math.min(0, st.min);
            const hi = Math.max(0, st.max);
            const pct = hi === lo ? 100 : Math.max(3, Math.min(100, ((v - lo) / (hi - lo)) * 100));
            bar = { pct: Math.round(pct), color: rule.colors[0] };
          }
          break;
        default:
      }
      if (hit) fmt = Object.assign(fmt || {}, rule.fmt);
    }
    return fmt || bar ? { fmt, bar } : null;
  }

  /* ---- merged cells ---- */

  function masterOf(r, c) {
    for (const m of merges) if (r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
    return null;
  }

  function renderMerges() {
    for (const td of mergedTds) {
      td.style.display = '';
      td.rowSpan = 1;
      td.colSpan = 1;
      td._covered = false;
      td._merge = null;
      td._sig = null;
    }
    mergedTds = [];
    for (const m of merges) {
      for (let r = m.r1; r <= m.r2; r++) {
        for (let c = m.c1; c <= m.c2; c++) {
          const td = cellEls[r] && cellEls[r][c];
          if (!td) continue;
          mergedTds.push(td);
          td._sig = null;
          if (r === m.r1 && c === m.c1) {
            td.rowSpan = m.r2 - m.r1 + 1;
            td.colSpan = m.c2 - m.c1 + 1;
            td._merge = m;
          } else {
            td.style.display = 'none';
            td._covered = true;
            td.textContent = '';
          }
        }
      }
    }
    renderedMerges = merges;
  }

  /* ---- cells ---- */

  function renderCell(r, c) {
    const td = cellEls[r] && cellEls[r][c];
    if (!td || td._covered) return;
    const k = key(r, c);
    const f = fmts.get(k);
    const v = sheet.getValue(k);
    const eff = cfRules.length ? cfEffect(r, c, v) : null;
    let ef = eff && eff.fmt ? Object.assign({}, f, eff.fmt) : f;
    const m = td._merge;
    if (m) {
      const edge = (rr, cc, side) => {
        const x = fmts.get(key(rr, cc));
        return x && x.bd ? x.bd[side] : undefined;
      };
      const bd = {};
      const t = edge(m.r1, m.c1, 't');
      const l = edge(m.r1, m.c1, 'l');
      const rt = edge(m.r1, m.c2, 'r');
      const b = edge(m.r2, m.c1, 'b');
      if (t) bd.t = t;
      if (l) bd.l = l;
      if (rt) bd.r = rt;
      if (b) bd.b = b;
      ef = Object.assign({}, ef, { bd });
    }
    const { text, kind, color } = H.formatValue(v, f && f.nf);
    const bar = eff && eff.bar;
    const sig = text + '\u0001' + kind + '\u0001' + (color || '') + '\u0001' + (ef ? JSON.stringify(ef) : '') + (bar ? '\u0001' + bar.pct + bar.color : '');
    if (td._sig === sig) return;
    td._sig = sig;
    const blankAgain = !ef && text === '' && !bar && !td._merge;

    if (text.indexOf(FILL) !== -1) {
      td.textContent = '';
      const row = document.createElement('div');
      row.className = 'fillrow';
      const i = text.indexOf(FILL);
      const left = document.createElement('span');
      left.textContent = text.slice(0, i);
      const right = document.createElement('span');
      right.textContent = text.slice(i + 1).split(FILL).join('');
      row.append(left, right);
      td.appendChild(row);
    } else {
      td.textContent = text;
    }
    td.className = kind === 'num' ? 'num' : kind === 'bool' ? 'bool' : kind === 'error' ? 'error' : '';

    const s = td.style;
    const e = ef || {};
    s.fontWeight = e.b ? '700' : '';
    s.fontStyle = e.i ? 'italic' : '';
    const deco = [];
    if (e.u) deco.push('underline');
    if (e.s) deco.push('line-through');
    s.textDecorationLine = deco.join(' ');
    s.textDecorationStyle = e.u === 'double' ? 'double' : '';
    s.fontFamily = e.font ? '"' + String(T.resolveFont(e.font, themeFonts)).replace(/["\\]/g, '') + '", var(--font)' : '';
    s.fontSize = e.size ? (e.size * 4) / 3 + 'px' : '';
    s.lineHeight = e.size ? '1.35' : '';
    s.color = color || T.resolve(e.color, themeColors);
    s.backgroundColor = T.resolve(e.bg, themeColors);
    s.backgroundImage = bar ? 'linear-gradient(to right, ' + bar.color + ' ' + bar.pct + '%, transparent ' + bar.pct + '%)' : '';
    s.textAlign = e.align || '';
    s.verticalAlign = e.va || '';
    const ind = e.indent ? 6 + e.indent * 9 + 'px' : '';
    s.paddingLeft = e.align !== 'right' && e.align !== 'center' ? ind : '';
    s.paddingRight = e.align === 'right' ? ind : '';
    s.whiteSpace = e.wrap ? 'pre-wrap' : '';
    s.overflowWrap = e.wrap ? 'anywhere' : '';
    const bd = e.bd || {};
    s.borderTop = bdCss(bd.t);
    s.borderRight = bdCss(bd.r);
    s.borderBottom = bdCss(bd.b);
    s.borderLeft = bdCss(bd.l);
    if (blankAgain) td._sig = undefined;
  }

  function applyTheme() {
    themeColors = T.colorSet(theme.colors).c;
    themeFonts = T.fontSet(theme.fonts);
    document.documentElement.style.setProperty('--cell-font', '"' + themeFonts.body + '", var(--font)');
    window.TallyCharts.setPalette(themeColors.slice(4));
    for (let r = win.r0; r <= win.r1; r++) for (let c = win.c0; c <= win.c1; c++) if (cellEls[r][c]._sig !== undefined) cellEls[r][c]._sig = null;
    renderedTheme = theme;
    scheduleCharts();
    if (ctx.onThemeChange) ctx.onThemeChange();
  }

  function renderAll() {
    if (theme !== renderedTheme) applyTheme();
    if (merges !== renderedMerges) {
      const w = fitMerges(win.c0, win.c1, win.r0, win.r1);
      if (w.c0 !== win.c0 || w.c1 !== win.c1 || w.r0 !== win.r0 || w.r1 !== win.r1) {
        win = w;
        fillBody();
      }
      renderMerges();
    }
    cfPrepare();
    const anyCf = cfRules.length > 0;
    for (let r = win.r0; r <= win.r1; r++) {
      const row = cellEls[r];
      for (let c = win.c0; c <= win.c1; c++) {
        // Blank, unformatted, never-painted cells need no work (this keeps 100k+ cells fast).
        if (row[c]._sig === undefined && !anyCf) {
          const k = key(r, c);
          if (!sheet.cells.has(k) && !fmts.has(k)) continue;
        }
        renderCell(r, c);
      }
    }
  }

  function afterChange() {
    renderAll();
    placeOverlay();
    refreshSelectionInfo();
    updateUndoButtons();
    scheduleCharts();
  }

  /* ---------- selection ---------- */

  // The selection grows to include any merged cell it touches.
  function rect() {
    let r1 = Math.min(anchor.r, focus.r);
    let r2 = Math.max(anchor.r, focus.r);
    let c1 = Math.min(anchor.c, focus.c);
    let c2 = Math.max(anchor.c, focus.c);
    if (merges.length) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const m of merges) {
          if (m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1) {
            if (m.r1 < r1) { r1 = m.r1; changed = true; }
            if (m.r2 > r2) { r2 = m.r2; changed = true; }
            if (m.c1 < c1) { c1 = m.c1; changed = true; }
            if (m.c2 > c2) { c2 = m.c2; changed = true; }
          }
        }
      }
    }
    return { r1, r2, c1, c2 };
  }

  function setSelection(a, f, opts) {
    const ma = masterOf(a.r, a.c);
    if (ma) a = { r: ma.r1, c: ma.c1 };
    anchor = a;
    focus = f || a;
    if (!opts || opts.scroll !== false) ensureVisible(focus.r, focus.c);
    updateSelection();
  }

  function ensureVisible(r, c) {
    const m = masterOf(r, c);
    const r1 = m ? m.r1 : r;
    const r2 = m ? m.r2 : r;
    const c1 = m ? m.c1 : c;
    const c2 = m ? m.c2 : c;
    // Rows: measured when they are on the page, worked out from their heights otherwise.
    const t = rowTopPx(r1);
    const b = rowBottomPx(r2);
    if (t < wrap.scrollTop + headH()) wrap.scrollTop = Math.max(0, t - headH());
    else if (b > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = b - wrap.clientHeight;
    // Columns come from the widths, because the column may not be in the page yet.
    const left = colX[c1];
    const right = colX[c2] + colWidths[c2];
    const viewL = wrap.scrollLeft;
    const viewR = wrap.scrollLeft + wrap.clientWidth - headOff();
    if (left < viewL) wrap.scrollLeft = left;
    else if (right > viewR) wrap.scrollLeft = right - wrap.clientWidth + headOff();
    syncWindow(true);
  }

  function placeOverlay() {
    const { r1, c1, r2, c2 } = rect();
    const top = rowTopPx(r1);
    const bottom = rowBottomPx(r2);
    const left = headOff() + colX[c1];
    const right = headOff() + colX[c2] + colWidths[c2];
    selEl.style.left = left - 1 + 'px';
    selEl.style.top = top - 1 + 'px';
    selEl.style.width = right - left + 1 + 'px';
    selEl.style.height = bottom - top + 1 + 'px';
    selEl.classList.toggle('multi', r1 !== r2 || c1 !== c2);
    selBox = { right, bottom };
    placeChip();
  }

  // The live tally: totals hang off the bottom-right corner of the selection, kept inside the visible sheet.
  function placeChip() {
    const chip = $('tallychip');
    if (!tallyShown || editing || !selBox) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    const h = chip.offsetHeight || 28;
    const w = chip.offsetWidth || 220;
    const maxX = wrap.scrollLeft + wrap.clientWidth - 10;
    const maxY = wrap.scrollTop + wrap.clientHeight - h - 10;
    const x = Math.max(wrap.scrollLeft + w + 60, Math.min(selBox.right, maxX));
    chip.style.left = x + 'px';
    chip.style.top = Math.min(selBox.bottom + 6, maxY) + 'px';
  }

  function updateSelection() {
    const { r1, c1, r2, c2 } = rect();
    placeOverlay();
    for (let c = 0; c < COLS; c++) colHeads[c].classList.toggle('on', c >= c1 && c <= c2);
    markRowHeads();
    const fullCols = r1 === 0 && r2 === ROWS - 1;
    const fullRows = c1 === 0 && c2 === COLS - 1;
    if (document.activeElement !== namebox) {
      namebox.value =
        r1 === r2 && c1 === c2
          ? key(anchor.r, anchor.c)
          : fullCols && fullRows
          ? 'A1:' + key(ROWS - 1, COLS - 1)
          : key(r1, c1) + ':' + key(r2, c2);
    }
    refreshSelectionInfo();
  }

  function refreshSelectionInfo() {
    const ak = key(anchor.r, anchor.c);
    if (!editing) bar.value = sheet.getRaw(ak);
    // status bar aggregates
    const { r1, c1, r2, c2 } = rect();
    let count = 0;
    let n = 0;
    let sum = 0;
    const take = (v) => {
      if (v === null) return;
      count++;
      if (typeof v === 'number') {
        n++;
        sum += v;
      }
    };
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 20000) {
      // Huge selection (like select-all): only look at cells that hold something.
      for (const k of sheet.cells.keys()) {
        const p = parseKey(k);
        if (p && p.r >= r1 && p.r <= r2 && p.c >= c1 && p.c <= c2) take(sheet.getValue(k));
      }
    } else {
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) take(sheet.getValue(key(r, c)));
    }
    const agg = $('status-agg');
    agg.textContent = '';
    const chip = $('tallychip');
    chip.textContent = '';
    tallyShown = false;
    if (count > 1 && n > 0) {
      const fmt = (x) => H.formatValue(Math.round(x * 1e4) / 1e4, 'general').text;
      for (const [label, val] of [['Sum', fmt(sum)], ['Count', String(count)], ['Average', fmt(sum / n)]]) {
        const s = document.createElement('span');
        s.textContent = label + ' ' + val;
        agg.appendChild(s);
        const t = document.createElement(label === 'Sum' ? 'b' : 'span');
        t.textContent = label + ' ' + val;
        chip.appendChild(t);
      }
      tallyShown = true;
    }
    placeChip();
    if (ctx.onSelectionChange) ctx.onSelectionChange();
  }

  function forEachInSelection(fn) {
    let { r1, c1, r2, c2 } = rect();
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 150000) {
      // A selection this big (like select-all) is only applied to the used area and what is on screen.
      let maxR = win.r1;
      let maxC = win.c1;
      for (const m of [sheet.cells, fmts]) {
        for (const k of m.keys()) {
          const p = parseKey(k);
          if (p && p.r > maxR) maxR = p.r;
          if (p && p.c > maxC) maxC = p.c;
        }
      }
      r2 = Math.min(r2, maxR);
      c2 = Math.min(c2, maxC);
    }
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(key(r, c), r, c);
  }

  /* ---------- transactions & undo ---------- */

  function setRaw(k, raw) {
    const old = sheet.getRaw(k);
    if (old === raw) return;
    tx.push({ k, type: 'raw', old, new: raw });
    sheet.setRaw(k, raw);
  }

  function setFmt(k, patch, replace) {
    const old = fmts.get(k) || null;
    let next;
    if (replace) next = patch ? Object.assign({}, patch) : null;
    else {
      next = Object.assign({}, old || {});
      for (const name of Object.keys(patch)) {
        if (patch[name] === undefined || patch[name] === null || patch[name] === false) delete next[name];
        else next[name] = patch[name];
      }
    }
    if (next && !Object.keys(next).length) next = null;
    if (JSON.stringify(old) === JSON.stringify(next)) return;
    tx.push({ k, type: 'fmt', old, new: next });
    setFmtDirect(k, next);
  }

  function setFmtDirect(k, obj) {
    if (!obj) fmts.delete(k);
    else fmts.set(k, obj);
  }

  function transact(fn) {
    tx = [];
    try {
      fn();
    } finally {
      const done = tx;
      tx = null;
      if (done.length) {
        undoStack.push(done);
        if (undoStack.length > 200) undoStack.shift();
        redoStack = [];
        setDirty(true);
      }
      afterChange();
    }
  }

  function applyChange(ch, which) {
    if (ch.type === 'raw') sheet.setRaw(ch.k, ch[which]);
    else if (ch.type === 'merges') merges = ch[which];
    else if (ch.type === 'cf') cfRules = ch[which];
    else if (ch.type === 'theme') theme = ch[which];
    else setFmtDirect(ch.k, ch[which]);
  }

  function setMerges(next) {
    tx.push({ type: 'merges', old: merges, new: next });
    merges = next;
  }

  function setTheme(next) {
    tx.push({ type: 'theme', old: theme, new: next });
    theme = next;
  }

  function setCF(next) {
    tx.push({ type: 'cf', old: cfRules, new: next });
    cfRules = next;
  }

  const inGrid = (r, c) => r >= 0 && c >= 0 && r < ROWS && c < COLS;

  function patchBorder(r, c, side, val) {
    if (!inGrid(r, c)) return;
    const k = key(r, c);
    const cur = (fmts.get(k) || {}).bd || {};
    const next = Object.assign({}, cur);
    if (val) next[side] = val;
    else delete next[side];
    setFmt(k, { bd: Object.keys(next).length ? next : undefined });
  }

  // Sets one edge of a cell and the matching edge of its neighbor so they agree.
  function setEdge(r, c, side, val) {
    patchBorder(r, c, side, val);
    const opp = { t: 'b', b: 't', l: 'r', r: 'l' }[side];
    patchBorder(r + (side === 'b' ? 1 : side === 't' ? -1 : 0), c + (side === 'r' ? 1 : side === 'l' ? -1 : 0), opp, val);
  }

  // spec: { t, r, b, l, h, v } each undefined (leave), null (clear) or { s, c }.
  // Call inside transact().
  function applyBorders(spec) {
    const { r1, c1, r2, c2 } = rect();
    for (let c = c1; c <= c2; c++) {
      if (spec.t !== undefined) setEdge(r1, c, 't', spec.t);
      if (spec.b !== undefined) setEdge(r2, c, 'b', spec.b);
    }
    for (let r = r1; r <= r2; r++) {
      if (spec.l !== undefined) setEdge(r, c1, 'l', spec.l);
      if (spec.r !== undefined) setEdge(r, c2, 'r', spec.r);
    }
    if (spec.h !== undefined) for (let r = r1; r < r2; r++) for (let c = c1; c <= c2; c++) setEdge(r, c, 'b', spec.h);
    if (spec.v !== undefined) for (let r = r1; r <= r2; r++) for (let c = c1; c < c2; c++) setEdge(r, c, 'r', spec.v);
  }

  // Call inside transact(). Keeps only the top-left cell's contents, like Excel.
  function mergeCells(center) {
    const R = rect();
    if (R.r1 === R.r2 && R.c1 === R.c2) return;
    const keep = merges.filter((m) => !(m.r1 <= R.r2 && m.r2 >= R.r1 && m.c1 <= R.c2 && m.c2 >= R.c1));
    forEachInSelection((k, r, c) => {
      if (r !== R.r1 || c !== R.c1) setRaw(k, '');
    });
    setMerges(keep.concat([{ r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 }]));
    if (center) setFmt(key(R.r1, R.c1), { align: 'center' });
    anchor = { r: R.r1, c: R.c1 };
    focus = { r: R.r2, c: R.c2 };
  }

  function unmergeCells() {
    const R = rect();
    const keep = merges.filter((m) => !(m.r1 <= R.r2 && m.r2 >= R.r1 && m.c1 <= R.c2 && m.c2 >= R.c1));
    if (keep.length !== merges.length) setMerges(keep);
  }

  function copyFormats() {
    const R = rect();
    const rows = [];
    for (let r = R.r1; r <= R.r2; r++) {
      const row = [];
      for (let c = R.c1; c <= R.c2; c++) {
        const f = fmts.get(key(r, c));
        row.push(f ? JSON.parse(JSON.stringify(f)) : null);
      }
      rows.push(row);
    }
    return rows;
  }

  function applyPainter() {
    const src = painter;
    painter = null;
    if (ctx.onPainterDone) ctx.onPainterDone();
    if (!src) return;
    const R = rect();
    const h = src.length;
    const w = src[0].length;
    transact(() => forEachInSelection((k, r, c) => setFmt(k, src[(r - R.r1) % h][(c - R.c1) % w], true)));
  }

  // Excel applies a date, percent or currency format to what you just typed.
  function autoFormat(k, raw) {
    const f = fmts.get(k);
    if (f && f.nf) return;
    let nf = inferFormat(raw);
    if (!nf) {
      const m = /^=\s*(TODAY|NOW|DATE)\s*\(/i.exec(raw);
      if (m) nf = m[1].toUpperCase() === 'NOW' ? 'm/d/yyyy h:mm' : 'm/d/yyyy';
    }
    if (nf) setFmt(k, { nf });
  }

  function undo() {
    const t = undoStack.pop();
    if (!t) return;
    for (let i = t.length - 1; i >= 0; i--) applyChange(t[i], 'old');
    redoStack.push(t);
    setDirty(true);
    afterChange();
    flash('Undid last change');
  }

  function redo() {
    const t = redoStack.pop();
    if (!t) return;
    for (const ch of t) applyChange(ch, 'new');
    undoStack.push(t);
    setDirty(true);
    afterChange();
  }

  function updateUndoButtons() {
    $('btn-undo').disabled = !undoStack.length;
    $('btn-redo').disabled = !redoStack.length;
  }

  /* ---------- editing ---------- */

  const activeInput = () => (editing && editing.source === 'bar' ? bar : editor);

  function positionEditor(r, c) {
    if (!(cellEls[r] && cellEls[r][c])) ensureVisible(r, c);
    const td = cellEls[r] && cellEls[r][c];
    if (!td) return;
    const a = td.getBoundingClientRect();
    const s = sheetEl.getBoundingClientRect();
    editor.style.left = a.left - s.left - 1 + 'px';
    editor.style.top = a.top - s.top - 1 + 'px';
    editor.style.minWidth = a.width + 1 + 'px';
    editor.style.width = Math.max(a.width + 1, 140) + 'px';
    editor.style.height = a.height + 1 + 'px';
  }

  function startEdit(r, c, initial, mode, source) {
    if (editing) return;
    source = source || 'cell';
    const original = sheet.getRaw(key(r, c));
    editing = { r, c, source, mode };
    pointRef = null;
    const el = source === 'bar' ? bar : editor;
    if (source === 'cell') {
      positionEditor(r, c);
      editor.hidden = false;
    }
    el.value = initial !== undefined ? initial : original;
    bar.value = el.value;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    flash('');
  }

  function commitEdit(dr, dc) {
    if (!editing) return;
    const { r, c } = editing;
    const el = activeInput();
    const val = el.value;
    editing = null;
    pointRef = null;
    editor.hidden = true;
    transact(() => {
      const k = key(r, c);
      let v = val;
      const f = fmts.get(k);
      if (f && f.nf === '@' && v && v[0] !== '=' && v[0] !== "'" && typeof parseLiteral(v) !== 'string') v = "'" + v;
      setRaw(k, v);
      autoFormat(k, v);
    });
    wrap.focus({ preventScroll: true });
    if (dr || dc) moveActive(dr || 0, dc || 0);
    else updateSelection();
  }

  function cancelEdit() {
    if (!editing) return;
    editing = null;
    pointRef = null;
    editor.hidden = true;
    wrap.focus({ preventScroll: true });
    updateSelection();
  }

  // Where an arrow key goes from here (steps over a merged cell as one).
  function stepTarget(dr, dc) {
    const R = rect();
    const m = masterOf(anchor.r, anchor.c);
    const whole = m && R.r1 === m.r1 && R.r2 === m.r2 && R.c1 === m.c1 && R.c2 === m.c2;
    const baseR = whole ? (dr > 0 ? R.r2 : dr < 0 ? R.r1 : anchor.r) : anchor.r;
    const baseC = whole ? (dc > 0 ? R.c2 : dc < 0 ? R.c1 : anchor.c) : anchor.c;
    return { r: clamp(baseR + dr, 0, ROWS - 1), c: clamp(baseC + dc, 0, COLS - 1) };
  }

  function moveActive(dr, dc) {
    setSelection(stepTarget(dr, dc));
  }

  // Clicking a cell while typing a formula inserts its reference.
  function pointModeActive() {
    if (!editing) return false;
    const el = activeInput();
    const v = el.value;
    if (v[0] !== '=') return false;
    if (pointRef && v.endsWith(pointRef.text)) return true;
    return /[=(,+\-*/^&<>:]$/.test(v);
  }

  function setPointRef(a, b) {
    const el = activeInput();
    const text = a.r === b.r && a.c === b.c ? key(a.r, a.c) : key(Math.min(a.r, b.r), Math.min(a.c, b.c)) + ':' + key(Math.max(a.r, b.r), Math.max(a.c, b.c));
    const start = pointRef && el.value.endsWith(pointRef.text) ? pointRef.start : el.value.length;
    el.value = el.value.slice(0, start) + text;
    pointRef = { start, text };
    if (editing.source === 'cell') bar.value = el.value;
    else editor.value = el.value;
    el.setSelectionRange(el.value.length, el.value.length);
  }

  /* ---------- mouse ---------- */

  function cellFromEvent(e) {
    const td = e.target.closest ? e.target.closest('td[data-r]') : null;
    return td ? { r: +td.dataset.r, c: +td.dataset.c } : null;
  }

  grid.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rz = e.target.closest('.rz');
    if (rz) {
      if (editing) commitEdit();
      const c = +rz.dataset.c;
      drag = { mode: 'resize', c, startX: e.clientX, startW: colWidths[c] };
      document.body.style.cursor = 'col-resize';
      return;
    }
    const rzr = e.target.closest('.rzr');
    if (rzr) {
      if (editing) commitEdit();
      const r = +rzr.dataset.r;
      drag = { mode: 'rowresize', r, startY: e.clientY, startH: rzr.closest('tr').getBoundingClientRect().height };
      document.body.style.cursor = 'row-resize';
      return;
    }
    const cell = cellFromEvent(e);
    if (cell) {
      if (pointModeActive()) {
        drag = { mode: 'point', from: cell };
        setPointRef(cell, cell);
        return;
      }
      if (editing) commitEdit();
      wrap.focus({ preventScroll: true });
      drag = { mode: 'select' };
      if (e.shiftKey) setSelection(anchor, cell);
      else setSelection(cell);
      return;
    }
    const ch = e.target.closest('th.ch');
    if (ch) {
      if (editing) commitEdit();
      wrap.focus({ preventScroll: true });
      const c = +ch.dataset.c;
      drag = { mode: 'col' };
      const from = e.shiftKey ? anchor.c : c;
      setSelection({ r: 0, c: from }, { r: ROWS - 1, c }, { scroll: false });
      return;
    }
    const rh = e.target.closest('th.rh');
    if (rh) {
      if (editing) commitEdit();
      wrap.focus({ preventScroll: true });
      const r = +rh.dataset.r;
      drag = { mode: 'row' };
      const from = e.shiftKey ? anchor.r : r;
      setSelection({ r: from, c: 0 }, { r, c: COLS - 1 }, { scroll: false });
      return;
    }
    if (e.target.closest('th.corner')) {
      if (editing) commitEdit();
      wrap.focus({ preventScroll: true });
      setSelection({ r: 0, c: 0 }, { r: ROWS - 1, c: COLS - 1 }, { scroll: false });
    }
  });

  grid.addEventListener('mouseover', (e) => {
    if (!drag) return;
    const cell = cellFromEvent(e);
    if (drag.mode === 'select' && cell) setSelection(anchor, cell, { scroll: false });
    else if (drag.mode === 'point' && cell) setPointRef(drag.from, cell);
    else if (drag.mode === 'col') {
      const ch = e.target.closest('th.ch');
      if (ch) setSelection({ r: 0, c: anchor.c }, { r: ROWS - 1, c: +ch.dataset.c }, { scroll: false });
    } else if (drag.mode === 'row') {
      const rh = e.target.closest('th.rh');
      if (rh) setSelection({ r: anchor.r, c: 0 }, { r: +rh.dataset.r, c: COLS - 1 }, { scroll: false });
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (drag && drag.mode === 'rowresize') {
      const h = Math.max(16, Math.round(drag.startH + e.clientY - drag.startY));
      rowHeights[drag.r] = h;
      if (rowTrs[drag.r]) rowTrs[drag.r].style.height = h + 'px';
      rebuildRowY();
      placeOverlay();
      return;
    }
    if (!drag || drag.mode !== 'resize') return;
    const w = Math.max(MIN_W, Math.round(drag.startW + e.clientX - drag.startX));
    colWidths[drag.c] = w;
    colEls[drag.c].style.width = w + 'px';
    updateTableWidth();
    placeOverlay();
  });

  document.addEventListener('mouseup', () => {
    if (drag && (drag.mode === 'resize' || drag.mode === 'rowresize')) {
      document.body.style.cursor = '';
      setDirty(true);
      scheduleCharts();
      placeOverlay();
    }
    if (drag && drag.mode === 'select' && painter) applyPainter();
    if (drag && drag.mode === 'point' && editing) activeInput().focus();
    drag = null;
  });

  function autofitColumn(c) {
    const cv = autofitColumn.cv || (autofitColumn.cv = document.createElement('canvas'));
    const g = cv.getContext('2d');
    let max = 0;
    for (let r = 0; r < ROWS; r++) {
      const k = key(r, c);
      const f = fmts.get(k) || {};
      const v = sheet.getValue(k);
      if (v === null) continue;
      const t = H.formatValue(v, f.nf).text.split(window.TallyNumFmt.FILL).join(' ');
      g.font = (f.i ? 'italic ' : '') + (f.b ? 'bold ' : '') + ((f.size || 11) * 4) / 3 + 'px ' + (f.font ? '"' + T.resolveFont(f.font, themeFonts) + '", ' : '') + 'system-ui, sans-serif';
      max = Math.max(max, g.measureText(t).width + (f.indent || 0) * 9);
    }
    setColWidth(c, clamp(Math.ceil(max + 16), MIN_W, 600));
  }

  function setColWidth(c, w) {
    colWidths[c] = clamp(Math.round(w), MIN_W, 1000);
    colEls[c].style.width = colWidths[c] + 'px';
    updateTableWidth();
    placeOverlay();
    setDirty(true);
    scheduleCharts();
  }

  function setRowHeight(r, h) {
    if (h) rowHeights[r] = clamp(Math.round(h), 12, 600);
    else delete rowHeights[r];
    if (rowTrs[r]) rowTrs[r].style.height = rowHeights[r] ? rowHeights[r] + 'px' : '';
    rebuildRowY();
    placeOverlay();
    setDirty(true);
  }

  grid.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (editing) commitEdit();
    const R = rect();
    let kind = 'cell';
    const cell = cellFromEvent(e);
    const ch = e.target.closest('th.ch');
    const rh = e.target.closest('th.rh');
    if (cell) {
      if (cell.r < R.r1 || cell.r > R.r2 || cell.c < R.c1 || cell.c > R.c2) setSelection(cell);
    } else if (ch) {
      kind = 'col';
      const c = +ch.dataset.c;
      if (c < R.c1 || c > R.c2 || R.r2 - R.r1 !== ROWS - 1) setSelection({ r: 0, c }, { r: ROWS - 1, c }, { scroll: false });
    } else if (rh) {
      kind = 'row';
      const r = +rh.dataset.r;
      if (r < R.r1 || r > R.r2 || R.c2 - R.c1 !== COLS - 1) setSelection({ r, c: 0 }, { r, c: COLS - 1 }, { scroll: false });
    } else return;
    wrap.focus({ preventScroll: true });
    if (ctx.onContextMenu) ctx.onContextMenu(e.clientX, e.clientY, kind);
  });

  grid.addEventListener('dblclick', (e) => {
    const rzHit = e.target.closest('.rz');
    if (rzHit) {
      autofitColumn(+rzHit.dataset.c);
      return;
    }
    const rzrHit = e.target.closest('.rzr');
    if (rzrHit) {
      setRowHeight(+rzrHit.dataset.r, null);
      return;
    }
    const cell = cellFromEvent(e);
    if (cell && !editing) {
      setSelection(cell);
      startEdit(cell.r, cell.c, undefined, 'edit');
    }
  });

  /* ---------- keyboard ---------- */

  const DIRS = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  function jumpEdge(r, c, dr, dc) {
    const filled = (rr, cc) => sheet.getRaw(key(rr, cc)) !== '';
    const inb = (rr, cc) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS;
    let nr = r + dr;
    let nc = c + dc;
    if (!inb(nr, nc)) return { r, c };
    if (filled(r, c) && filled(nr, nc)) {
      while (inb(nr + dr, nc + dc) && filled(nr + dr, nc + dc)) {
        nr += dr;
        nc += dc;
      }
      return { r: nr, c: nc };
    }
    while (inb(nr, nc) && !filled(nr, nc)) {
      nr += dr;
      nc += dc;
    }
    if (!inb(nr, nc)) return { r: nr - dr, c: nc - dc };
    return { r: nr, c: nc };
  }

  function editorKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitEdit(0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (editing && editing.mode === 'enter' && DIRS[e.key] && !e.shiftKey && activeInput().value[0] !== '=') {
      e.preventDefault();
      const [dr, dc] = DIRS[e.key];
      commitEdit(dr, dc);
    }
  }

  function gridKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (DIRS[k]) {
      e.preventDefault();
      const [dr, dc] = DIRS[k];
      const from = e.shiftKey ? focus : anchor;
      let n = e.shiftKey ? { r: from.r + dr, c: from.c + dc } : stepTarget(dr, dc);
      if (mod) n = jumpEdge(from.r, from.c, dr, dc);
      n = { r: clamp(n.r, 0, ROWS - 1), c: clamp(n.c, 0, COLS - 1) };
      if (e.shiftKey) setSelection(anchor, n);
      else setSelection(n);
      return;
    }
    if (mod) {
      switch (k.toLowerCase()) {
        case 'a':
          e.preventDefault();
          setSelection({ r: 0, c: 0 }, { r: ROWS - 1, c: COLS - 1 }, { scroll: false });
          return;
        case 'b':
          e.preventDefault();
          toggleFlag('b');
          return;
        case 'i':
          e.preventDefault();
          toggleFlag('i');
          return;
        case 'd':
          e.preventDefault();
          fill('down');
          return;
        case 'r':
          e.preventDefault();
          fill('right');
          return;
        case 'home':
          e.preventDefault();
          setSelection({ r: 0, c: 0 });
          return;
        default:
          return;
      }
    }
    switch (k) {
      case 'Enter':
        e.preventDefault();
        moveActive(e.shiftKey ? -1 : 1, 0);
        return;
      case 'Tab':
        e.preventDefault();
        moveActive(0, e.shiftKey ? -1 : 1);
        return;
      case 'F2':
        e.preventDefault();
        startEdit(anchor.r, anchor.c, undefined, 'edit');
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        clearSelection();
        return;
      case 'Home':
        e.preventDefault();
        setSelection({ r: anchor.r, c: 0 });
        return;
      case 'PageDown':
        e.preventDefault();
        moveActive(20, 0);
        return;
      case 'PageUp':
        e.preventDefault();
        moveActive(-20, 0);
        return;
      case 'Escape':
        if (painter) {
          painter = null;
          if (ctx.onPainterDone) ctx.onPainterDone();
        }
        return;
      default:
    }
    if (k.length === 1 && !e.altKey) {
      e.preventDefault();
      startEdit(anchor.r, anchor.c, k, 'enter');
    }
  }

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t === editor || t === bar) {
      editorKey(e);
      return;
    }
    if (t === wrap || t === document.body) gridKey(e);
  });

  editor.addEventListener('input', () => {
    bar.value = editor.value;
    pointRef = null;
  });
  bar.addEventListener('input', () => {
    if (editing && editing.source === 'bar') pointRef = null;
  });
  bar.addEventListener('focus', () => {
    if (!editing) startEdit(anchor.r, anchor.c, undefined, 'edit', 'bar');
  });
  // Moving to the formula search box keeps the edit open, so a function can be added to the formula being typed.
  editor.addEventListener('blur', (e) => {
    if (editing && editing.source === 'cell' && e.relatedTarget !== $('fsearch')) commitEdit();
  });
  bar.addEventListener('blur', (e) => {
    if (editing && editing.source === 'bar' && e.relatedTarget !== $('fsearch')) commitEdit();
  });

  namebox.addEventListener('focus', () => namebox.select());
  namebox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const m = /^\s*([A-Za-z]+\d+)(?::([A-Za-z]+\d+))?\s*$/.exec(namebox.value);
      const a = m && parseKey(m[1]);
      const b = m && m[2] ? parseKey(m[2]) : a;
      if (a && b && a.r < ROWS && a.c < COLS && b.r < ROWS && b.c < COLS && a.r >= 0 && b.r >= 0) {
        wrap.focus({ preventScroll: true });
        setSelection(a, b);
      } else {
        flash('Enter a cell like B5 or a range like A1:C10');
      }
    } else if (e.key === 'Escape') {
      wrap.focus({ preventScroll: true });
      updateSelection();
    }
  });
  namebox.addEventListener('blur', updateSelection);

  /* ---------- clearing, filling, formatting ---------- */

  function clearSelection() {
    transact(() => forEachInSelection((k) => setRaw(k, '')));
  }

  function fill(direction) {
    const { r1, c1, r2, c2 } = rect();
    transact(() => {
      if (direction === 'down') {
        const srcRow = r1 === r2 ? r1 - 1 : r1;
        if (srcRow < 0) return;
        const from = r1 === r2 ? r1 : r1 + 1;
        for (let c = c1; c <= c2; c++) {
          const sk = key(srcRow, c);
          for (let r = from; r <= r2; r++) {
            const k = key(r, c);
            setRaw(k, shiftFormula(sheet.getRaw(sk), r - srcRow, 0));
            setFmt(k, fmts.get(sk) || null, true);
          }
        }
      } else {
        const srcCol = c1 === c2 ? c1 - 1 : c1;
        if (srcCol < 0) return;
        const from = c1 === c2 ? c1 : c1 + 1;
        for (let r = r1; r <= r2; r++) {
          const sk = key(r, srcCol);
          for (let c = from; c <= c2; c++) {
            const k = key(r, c);
            setRaw(k, shiftFormula(sheet.getRaw(sk), 0, c - srcCol));
            setFmt(k, fmts.get(sk) || null, true);
          }
        }
      }
    });
  }

  function applyFmt(patch) {
    transact(() => forEachInSelection((k) => setFmt(k, patch)));
  }

  function toggleFlag(flag) {
    const cur = !!(fmts.get(key(anchor.r, anchor.c)) || {})[flag];
    applyFmt({ [flag]: cur ? undefined : true });
  }

  $('btn-undo').addEventListener('mousedown', (e) => e.preventDefault());
  $('btn-redo').addEventListener('mousedown', (e) => e.preventDefault());
  $('btn-undo').addEventListener('click', () => doUndo());
  $('btn-redo').addEventListener('click', () => doRedo());

  function doUndo() {
    if (editing) document.execCommand('undo');
    else undo();
  }
  function doRedo() {
    if (editing) document.execCommand('redo');
    else redo();
  }

  /* ---------- clipboard ---------- */

  const isTextInput = (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

  function doCopy(data) {
    const { r1, c1, r2, c2 } = rect();
    const rows = [];
    const display = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      const drow = [];
      for (let c = c1; c <= c2; c++) {
        const k = key(r, c);
        const f = fmts.get(k);
        row.push({ raw: sheet.getRaw(k), fmt: f ? Object.assign({}, f) : null });
        drow.push(H.formatValue(sheet.getValue(k), f && f.nf).text);
      }
      rows.push(row);
      display.push(drow);
    }
    const text = H.toTSV(display);
    clip = { r1, c1, rows, text };
    data.setData('text/plain', text);
    flash('Copied ' + H.rangeLabel({ r1, c1, r2, c2 }));
  }

  function doPaste(text) {
    const { r1, c1, r2, c2 } = rect();
    const multi = r2 > r1 || c2 > c1;
    let last = null;
    if (clip && text === clip.text) {
      const h = clip.rows.length;
      const w = clip.rows[0].length;
      transact(() => {
        const put = (r, c, i, j) => {
          const item = clip.rows[i][j];
          const k = key(r, c);
          setRaw(k, shiftFormula(item.raw, r - (clip.r1 + i), c - (clip.c1 + j)));
          setFmt(k, item.fmt, true);
        };
        if (h === 1 && w === 1 && multi) {
          forEachInSelection((k, r, c) => put(r, c, 0, 0));
          last = { r1, c1, r2, c2 };
        } else {
          for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (r1 + i < ROWS && c1 + j < COLS) put(r1 + i, c1 + j, i, j);
          last = { r1, c1, r2: Math.min(ROWS - 1, r1 + h - 1), c2: Math.min(COLS - 1, c1 + w - 1) };
        }
      });
    } else {
      const rows = H.parseTSV(text);
      if (!rows.length || (rows.length === 1 && rows[0].length === 1 && rows[0][0] === '')) return;
      const w = Math.max.apply(null, rows.map((r) => r.length));
      transact(() => {
        if (rows.length === 1 && w === 1 && multi) {
          forEachInSelection((k) => {
            setRaw(k, rows[0][0]);
            autoFormat(k, rows[0][0]);
          });
          last = { r1, c1, r2, c2 };
        } else {
          rows.forEach((row, i) =>
            row.forEach((v, j) => {
              if (r1 + i < ROWS && c1 + j < COLS) {
                const k = key(r1 + i, c1 + j);
                setRaw(k, v);
                autoFormat(k, v);
              }
            })
          );
          last = { r1, c1, r2: Math.min(ROWS - 1, r1 + rows.length - 1), c2: Math.min(COLS - 1, c1 + w - 1) };
        }
      });
    }
    if (last) setSelection({ r: last.r1, c: last.c1 }, { r: last.r2, c: last.c2 }, { scroll: false });
  }

  document.addEventListener('copy', (e) => {
    if (isTextInput(e.target)) return;
    e.preventDefault();
    doCopy(e.clipboardData);
  });
  document.addEventListener('cut', (e) => {
    if (isTextInput(e.target)) return;
    e.preventDefault();
    doCopy(e.clipboardData);
    clearSelection();
  });
  document.addEventListener('paste', (e) => {
    if (isTextInput(e.target)) return;
    e.preventDefault();
    doPaste(e.clipboardData.getData('text/plain'));
  });

  /* ---------- charts ---------- */

  function rangeFromSelection() {
    const { r1, c1, r2, c2 } = rect();
    if (r1 === r2 && c1 === c2) return H.currentRegion(sheet, r1, c1);
    return { r1, c1, r2, c2 };
  }

  function addChart(type) {
    const rg = rangeFromSelection();
    const data = H.chartData(sheet, rg);
    if (!data.series.length) {
      flash('Select cells that contain numbers, then choose Chart');
      return;
    }
    charts.push({ id: ++chartSeq, title: 'Chart ' + chartSeq, type: type || 'bar', range: rg });
    $('charts').hidden = false;
    renderChartsPanel();
    setDirty(true);
    scheduleCharts();
    placeOverlay();
    const list = $('charts-list');
    list.lastElementChild && list.lastElementChild.scrollIntoView({ block: 'nearest' });
  }

  function renderChartsPanel() {
    const list = $('charts-list');
    list.textContent = '';
    $('charts-empty').hidden = charts.length > 0;
    for (const ch of charts) {
      const card = document.createElement('section');
      card.className = 'chart-card';
      card.dataset.id = ch.id;

      const head = document.createElement('div');
      head.className = 'chart-head';
      const title = document.createElement('input');
      title.className = 'chart-title';
      title.value = ch.title;
      title.setAttribute('aria-label', 'Chart title');
      title.addEventListener('input', () => {
        ch.title = title.value;
        setDirty(true);
      });
      title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') wrap.focus({ preventScroll: true });
      });
      const del = document.createElement('button');
      del.className = 'tb';
      del.textContent = '×';
      del.title = 'Remove chart';
      del.setAttribute('aria-label', 'Remove chart');
      del.addEventListener('click', () => {
        charts = charts.filter((x) => x !== ch);
        renderChartsPanel();
        setDirty(true);
        placeOverlay();
      });
      head.append(title, del);

      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', ch.title + ' chart of ' + H.rangeLabel(ch.range));

      const foot = document.createElement('div');
      foot.className = 'chart-foot';
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Chart type');
      for (const [type, label] of [['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie']]) {
        const b = document.createElement('button');
        b.textContent = label;
        b.setAttribute('aria-pressed', String(ch.type === type));
        b.addEventListener('click', () => {
          ch.type = type;
          seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          setDirty(true);
          scheduleCharts();
        });
        seg.appendChild(b);
      }
      const rg = document.createElement('div');
      rg.className = 'chart-range';
      const lab = document.createElement('span');
      lab.textContent = H.rangeLabel(ch.range);
      const upd = document.createElement('button');
      upd.textContent = 'Use selection';
      upd.title = 'Point this chart at the selected cells';
      upd.addEventListener('click', () => {
        const next = rangeFromSelection();
        if (!H.chartData(sheet, next).series.length) {
          flash('Select cells that contain numbers first');
          return;
        }
        ch.range = next;
        lab.textContent = H.rangeLabel(next);
        setDirty(true);
        scheduleCharts();
      });
      rg.append(lab, upd);
      foot.append(seg, rg);

      card.append(head, canvas, foot);
      list.appendChild(card);
    }
    scheduleCharts();
  }

  let chartRaf = 0;
  function scheduleCharts() {
    if (chartRaf || $('charts').hidden) return;
    chartRaf = requestAnimationFrame(() => {
      chartRaf = 0;
      const cards = $('charts-list').children;
      for (let i = 0; i < cards.length; i++) {
        const ch = charts.find((x) => String(x.id) === cards[i].dataset.id);
        if (!ch) continue;
        window.TallyCharts.draw(cards[i].querySelector('canvas'), H.chartData(sheet, ch.range), ch.type);
      }
    });
  }

  $('btn-charts-close').addEventListener('click', () => {
    $('charts').hidden = true;
    placeOverlay();
  });
  new ResizeObserver(() => {
    scheduleCharts();
    placeOverlay();
  }).observe($('charts'));
  window.addEventListener('resize', () => {
    scheduleCharts();
    placeOverlay();
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleCharts);
  }

  /* ---------- files ---------- */

  const baseName = (p) => (p ? p.split(/[\\/]/).pop() : 'Untitled');

  function setDirty(v) {
    dirty = v;
    api.setDirty(v);
    updateTitle();
  }

  // The file name is shown in the window title and in the bar at the top of the sheet.
  function updateTitle() {
    const name = (filePath ? baseName(filePath) : docLabel || 'Untitled') + (dirty ? ' •' : '');
    document.title = name + ' — Tally';
    const el = $('docname');
    if (el) {
      el.textContent = (docPassword ? '🔒 ' : '') + name;
      el.title = (filePath || 'Not saved yet') + (docPassword ? ' (password protected)' : '');
    }
  }

  let flashTimer = 0;
  function flash(msg) {
    const el = $('status-msg');
    el.textContent = msg;
    clearTimeout(flashTimer);
    if (msg) flashTimer = setTimeout(() => (el.textContent = ''), 4000);
  }

  function serialize() {
    const cells = {};
    for (const [k, raw] of sheet.cells) cells[k] = { v: raw };
    for (const [k, f] of fmts) (cells[k] = cells[k] || {}).f = f;
    const widths = {};
    colWidths.forEach((w, i) => {
      if (w !== DEF_W) widths[i] = w;
    });
    return JSON.stringify({ app: 'tally', version: 3, cells, colWidths: widths, rowHeights, merges, cf: cfRules, theme: { colors: theme.colors, fonts: theme.fonts }, charts }, null, 1);
  }

  function resetDocument() {
    sheet = new Sheet({ rows: ROWS, cols: COLS });
    fmts = new Map();
    colWidths = new Array(COLS).fill(DEF_W);
    rowHeights = {};
    merges = [];
    cfRules = [];
    theme = { colors: T.DEFAULT.colors, fonts: T.DEFAULT.fonts };
    painter = null;
    charts = [];
    chartSeq = 0;
    undoStack = [];
    redoStack = [];
    filePath = null;
    docLabel = '';
    docPassword = null;
    editing = null;
    editor.hidden = true;
    buildGrid();
    renderChartsPanel();
    $('charts').hidden = true;
    setSelection({ r: 0, c: 0 }, null, { scroll: false });
    wrap.scrollTo(0, 0);
    setDirty(false);
    afterChange();
  }

  async function confirmDiscard() {
    if (!dirty) return true;
    return api.confirm({ message: 'Discard unsaved changes?', detail: 'Your latest edits have not been saved.', ok: 'Discard' });
  }

  async function newDoc() {
    if (!(await confirmDiscard())) return;
    resetDocument();
    flash('New sheet');
  }

  function loadTally(text, path) {
    const obj = JSON.parse(text);
    if (!obj || obj.app !== 'tally' || typeof obj.cells !== 'object') throw new Error('This is not a Tally file');
    resetDocument();
    for (const k of Object.keys(obj.cells)) {
      const p = parseKey(k);
      if (!p || p.r >= ROWS || p.c >= COLS) continue;
      const cell = obj.cells[k] || {};
      if (typeof cell.v === 'string') sheet.setRaw(k, cell.v);
      if (cell.f && typeof cell.f === 'object') {
        const legacy = { number: '#,##0.00', currency: '$#,##0.00', percent: '0.00%' };
        if (legacy[cell.f.nf]) cell.f.nf = legacy[cell.f.nf];
        fmts.set(k, cell.f);
      }
    }
    for (const i of Object.keys(obj.colWidths || {})) {
      const c = +i;
      if (c >= 0 && c < COLS) colWidths[c] = Math.max(MIN_W, +obj.colWidths[i] || DEF_W);
    }
    const okRect = (m) => m && [m.r1, m.c1, m.r2, m.c2].every((n) => Number.isInteger(n)) && m.r1 >= 0 && m.c1 >= 0 && m.r2 < ROWS && m.c2 < COLS && m.r1 <= m.r2 && m.c1 <= m.c2;
    for (const i of Object.keys(obj.rowHeights || {})) {
      const r = +i;
      if (r >= 0 && r < ROWS) rowHeights[r] = clamp(+obj.rowHeights[i] || ROW_H, 12, 600);
    }
    merges = Array.isArray(obj.merges) ? obj.merges.filter(okRect).map((m) => ({ r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 })) : [];
    if (obj.theme && typeof obj.theme === 'object') {
      theme = { colors: T.hasColors(obj.theme.colors) ? obj.theme.colors : T.DEFAULT.colors, fonts: T.hasFonts(obj.theme.fonts) ? obj.theme.fonts : T.DEFAULT.fonts };
    }
    cfRules = Array.isArray(obj.cf) ? obj.cf.filter((x) => x && okRect(x.range) && typeof x.type === 'string') : [];
    charts = Array.isArray(obj.charts) ? obj.charts.filter((c) => c && c.range && ['bar', 'line', 'pie'].includes(c.type)) : [];
    chartSeq = charts.reduce((m, c) => Math.max(m, +c.id || 0), 0);
    charts.forEach((c) => (c.id = c.id || ++chartSeq));
    filePath = path;
    buildGrid();
    renderChartsPanel();
    $('charts').hidden = charts.length === 0;
    setDirty(false);
    afterChange();
    updateSelection();
  }

  async function openDoc() {
    if (!(await confirmDiscard())) return;
    try {
      const f = await api.open({ filters: [{ name: 'Tally or Excel', extensions: ['tally', 'xlsx', 'xlsm'] }, { name: 'Tally sheet', extensions: ['tally'] }, { name: 'Excel workbook', extensions: ['xlsx', 'xlsm'] }] });
      if (!f) return;
      if (f.bytes) return await importXlsx(f);
      let obj;
      try {
        obj = JSON.parse(f.content);
      } catch (e) {
        throw new Error('This is not a Tally file');
      }
      let text = f.content;
      let pw = null;
      if (C.isEncrypted(obj)) {
        let error = '';
        for (;;) {
          const res = await pwDialog({ title: 'Password needed', note: baseName(f.path) + ' is password protected.', error, okLabel: 'Open' });
          if (!res) return;
          flash('Decrypting…');
          try {
            text = await C.decrypt(obj, res.password);
            pw = res.password;
            break;
          } catch (err) {
            error = 'Wrong password, or the file is damaged.';
          }
        }
      }
      loadTally(text, f.path);
      docPassword = pw;
      updateTitle();
      flash('Opened ' + baseName(f.path) + (pw ? ' (encrypted)' : ''));
    } catch (err) {
      flash('Couldn’t open that file: ' + err.message);
    }
  }

  async function save(forceAs) {
    try {
      let content = serialize();
      if (docPassword) {
        flash('Encrypting…');
        content = await C.encrypt(content, docPassword);
      }
      let p = filePath;
      if (forceAs || !p) {
        p = await api.saveAs({ content, defaultPath: filePath || (docLabel ? docLabel.replace(/\.[^.]+$/, '') : 'Untitled') + '.tally', filters: [{ name: 'Tally sheet', extensions: ['tally'] }] });
        if (!p) return;
      } else {
        await api.write(p, content);
      }
      filePath = p;
      setDirty(false);
      flash('Saved ' + baseName(p) + (docPassword ? ' (encrypted)' : ''));
    } catch (err) {
      flash('Couldn’t save: ' + err.message);
    }
  }

  async function importCSV() {
    if (!(await confirmDiscard())) return;
    try {
      const f = await api.open({ filters: [{ name: 'CSV or text', extensions: ['csv', 'tsv', 'txt'] }] });
      if (!f) return;
      const rows = H.parseCSV(f.content);
      resetDocument();
      let clipped = false;
      rows.forEach((row, r) =>
        row.forEach((v, c) => {
          if (r >= ROWS || c >= COLS) {
            if (v !== '') clipped = true;
            return;
          }
          if (v !== '') sheet.setRaw(key(r, c), v);
        })
      );
      setDirty(true);
      afterChange();
      flash(clipped ? 'Imported. Cells beyond ' + COLS + ' columns × ' + ROWS + ' rows were left out' : 'Imported ' + baseName(f.path));
    } catch (err) {
      flash('Couldn’t import: ' + err.message);
    }
  }

  /* ---------- Excel (.xlsx) ---------- */

  async function importXlsx(f) {
    flash('Reading ' + baseName(f.path) + '…');
    let m;
    try {
      m = await XL.read(f.bytes);
    } catch (err) {
      throw new Error(err && err.message ? err.message : 'Could not read the Excel file');
    }
    resetDocument();
    theme = { colors: 'Office', fonts: 'Office' }; // keeps Excel's colours and Calibri as the file expects
    let clipped = 0;
    const dateNf = /[dy]|m{1,5}(?![^[]*\])/i;
    for (const cell of m.cells) {
      if (cell.r >= ROWS || cell.c >= COLS) {
        clipped++;
        continue;
      }
      const k = key(cell.r, cell.c);
      let raw = cell.raw;
      const fmt = cell.xf >= 0 ? m.fmts[cell.xf] : null;
      if (m.date1904 && fmt && fmt.nf && dateNf.test(fmt.nf) && raw !== '' && !isNaN(Number(raw))) raw = String(Number(raw) + 1462);
      if (raw !== '') sheet.setRaw(k, raw);
      if (fmt && Object.keys(fmt).length) fmts.set(k, JSON.parse(JSON.stringify(fmt)));
    }
    for (const c of Object.keys(m.colWidths)) if (+c < COLS) colWidths[+c] = Math.max(MIN_W, m.colWidths[c]);
    for (const r of Object.keys(m.rowHeights)) if (+r < ROWS) rowHeights[+r] = clamp(m.rowHeights[r], 12, 600);
    merges = m.merges.filter((g) => g.r2 < ROWS && g.c2 < COLS).map((g) => ({ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }));
    docLabel = baseName(f.path);
    buildGrid();
    setSelection({ r: 0, c: 0 }, null, { scroll: false });
    wrap.scrollTo(0, 0);
    setDirty(true);
    afterChange();
    updateSelection();
    let unknown = 0;
    for (const [k, raw] of sheet.cells) {
      if (typeof raw === 'string' && raw[0] === '=') {
        const v = sheet.getValue(k);
        if (v instanceof XlErrorCls && v.code === '#NAME?') unknown++;
      }
    }
    const notes = [];
    if (m.sheetNames.length > 1) notes.push('only the sheet "' + m.sheetName + '" was opened');
    if (clipped) notes.push(clipped + ' cells beyond ' + COLS + ' columns × ' + ROWS + ' rows were left out');
    if (unknown) notes.push(unknown + ' formulas use functions Tally does not have yet');
    flash('Opened ' + baseName(f.path) + (notes.length ? ' (' + notes.join('; ') + ')' : ''));
  }

  async function exportXlsx() {
    if (!sheet.cells.size && !fmts.size) {
      flash('Nothing to export yet');
      return;
    }
    const cells = [];
    for (const [k, raw] of sheet.cells) {
      const p = parseKey(k);
      if (!p || typeof raw !== 'string' || raw === '') continue;
      const val = sheet.getValue(k);
      const v = val === null ? undefined : val instanceof XlErrorCls ? { error: val.code } : val;
      if (raw[0] === '=') cells.push({ r: p.r, c: p.c, f: raw.slice(1), v });
      else if (raw[0] === "'") cells.push({ r: p.r, c: p.c, v: raw.slice(1) });
      else cells.push({ r: p.r, c: p.c, v });
    }
    const fl = [];
    for (const [k, fmt] of fmts) {
      const p = parseKey(k);
      if (p && fmt && Object.keys(fmt).length) fl.push({ r: p.r, c: p.c, fmt });
    }
    const widths = {};
    colWidths.forEach((w, c) => { if (w !== DEF_W) widths[c] = w; });
    const base = (filePath ? baseName(filePath) : docLabel || 'Untitled').replace(/\.[^.]+$/, '');
    try {
      const bytes = await XL.write({ sheetName: base, cells, fmts: fl, colWidths: widths, rowHeights, merges, defaultColPx: DEF_W, defaultRowPx: ROW_H, resolveColor: (c) => T.resolve(c, themeColors) });
      const p = await api.saveAs({ content: bytes, defaultPath: base + '.xlsx', filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
      if (p) flash('Exported ' + baseName(p) + ' (formulas are recalculated when Excel opens it)');
    } catch (err) {
      flash('Couldn’t export: ' + err.message);
    }
  }

  async function exportCSV() {
    let maxR = -1;
    let maxC = -1;
    for (const k of sheet.cells.keys()) {
      const p = parseKey(k);
      if (p.r > maxR) maxR = p.r;
      if (p.c > maxC) maxC = p.c;
    }
    if (maxR < 0) {
      flash('Nothing to export yet');
      return;
    }
    const rows = [];
    for (let r = 0; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) row.push(H.plainValue(sheet.getValue(key(r, c))));
      rows.push(row);
    }
    try {
      const base = filePath ? baseName(filePath).replace(/\.tally$/i, '') : 'Untitled';
      const p = await api.saveAs({ content: H.toCSV(rows), defaultPath: base + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (p) flash('Exported ' + baseName(p));
    } catch (err) {
      flash('Couldn’t export: ' + err.message);
    }
  }

  /* ---------- formula finder ---------- */

  const FF = window.TallyFormulas;
  const fsearch = $('fsearch');
  const fresults = $('fresults');
  let fItems = [];
  let fActive = -1;

  function fOpen() {
    const r = fsearch.getBoundingClientRect();
    const w = Math.min(460, window.innerWidth - 16);
    fresults.style.width = w + 'px';
    fresults.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    fresults.style.top = r.bottom + 6 + 'px';
    fresults.hidden = false;
    fsearch.setAttribute('aria-expanded', 'true');
  }
  function fClose() {
    fresults.hidden = true;
    fsearch.setAttribute('aria-expanded', 'false');
    fsearch.removeAttribute('aria-activedescendant');
    fActive = -1;
  }

  function fRender() {
    const list = FF.search(fsearch.value);
    fresults.textContent = '';
    fItems = [];
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'fr-empty';
      e.textContent = 'No formula matches “' + fsearch.value.trim() + '”. Try a plain word like total, count, join or date.';
      fresults.appendChild(e);
      fActive = -1;
      return;
    }
    const grouped = !fsearch.value.trim();
    let lastGroup = '';
    for (const f of list) {
      if (grouped && f.group !== lastGroup) {
        lastGroup = f.group;
        const g = document.createElement('div');
        g.className = 'fr-group';
        g.textContent = f.group;
        fresults.appendChild(g);
      }
      const it = document.createElement('div');
      it.className = 'fr-item' + (f.soon ? ' fr-soon' : '');
      it.id = 'fr-' + f.name;
      it.setAttribute('role', 'option');
      const top = document.createElement('div');
      top.className = 'fr-top';
      const nm = document.createElement('span');
      nm.className = 'fr-name';
      nm.textContent = f.name;
      const pu = document.createElement('span');
      pu.className = 'fr-purpose';
      pu.textContent = f.purpose;
      top.append(nm, pu);
      if (f.soon) {
        const b = document.createElement('span');
        b.className = 'fr-badge';
        b.textContent = 'Not in Tally yet';
        top.appendChild(b);
      }
      const code = document.createElement('div');
      code.className = 'fr-code';
      code.textContent = '=' + f.syntax;
      const ex = document.createElement('div');
      ex.className = 'fr-ex';
      ex.textContent = f.example;
      if (f.result !== '' && !f.soon) {
        ex.append('  →  ');
        const rs = document.createElement('b');
        rs.textContent = f.result;
        ex.appendChild(rs);
      }
      it.append(top, code, ex);
      it.addEventListener('mousedown', (e) => {
        e.preventDefault(); // keep focus where it is
        fPick(f);
      });
      fresults.appendChild(it);
      fItems.push({ f, el: it });
    }
    fSetActive(0);
  }

  function fSetActive(i) {
    if (!fItems.length) return;
    fActive = (i + fItems.length) % fItems.length;
    fItems.forEach((x, n) => x.el.setAttribute('aria-selected', n === fActive ? 'true' : 'false'));
    const cur = fItems[fActive].el;
    fsearch.setAttribute('aria-activedescendant', cur.id);
    cur.scrollIntoView({ block: 'nearest' });
  }

  function insertFunction(name) {
    const text = ['PI', 'TODAY', 'NOW'].includes(name) ? name + '()' : name + '(';
    if (!editing) {
      startEdit(anchor.r, anchor.c, '=' + text, 'enter');
      return;
    }
    const el = activeInput();
    if (!el.value.startsWith('=')) {
      el.value = '=' + text;
    } else {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      el.value = el.value.slice(0, a) + text + el.value.slice(b);
      el.setSelectionRange(a + text.length, a + text.length);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }

  function fPick(f) {
    if (f.soon) {
      flash(f.name + ' is not in Tally yet');
      return;
    }
    fsearch.value = '';
    fClose();
    insertFunction(f.name);
    flash(f.name + ': ' + f.purpose.charAt(0).toLowerCase() + f.purpose.slice(1));
  }

  fsearch.addEventListener('focus', () => { fOpen(); fRender(); });
  fsearch.addEventListener('input', () => { fOpen(); fRender(); });
  fsearch.addEventListener('blur', (e) => {
    fClose();
    if (editing && e.relatedTarget !== editor && e.relatedTarget !== bar) commitEdit();
  });
  fsearch.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); fSetActive(fActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); fSetActive(fActive - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (fItems[fActive]) fPick(fItems[fActive].f); }
    else if (e.key === 'Escape') { e.preventDefault(); fsearch.value = ''; fClose(); (editing ? activeInput() : wrap).focus(); }
  });
  document.querySelector('.fx').addEventListener('click', () => fsearch.focus());
  window.addEventListener('resize', () => { if (!fresults.hidden) fOpen(); });

  /* ---------- password protection ---------- */

  // Resolves to { password, remove } or null when cancelled.
  function pwDialog({ title, note, confirm, error, canRemove, okLabel }) {
    return new Promise((resolve) => {
      const mk = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text) e.textContent = text;
        return e;
      };
      const ov = mk('div', 'pwov');
      const box = mk('div', 'pwbox');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', title);
      const field = (placeholder, auto) => {
        const i = mk('input');
        i.type = 'password';
        i.placeholder = placeholder;
        i.autocomplete = auto;
        i.spellcheck = false;
        return i;
      };
      const i1 = field('Password', confirm ? 'new-password' : 'current-password');
      const i2 = confirm ? field('Confirm password', 'new-password') : null;
      const showLbl = mk('label', 'pwshow');
      const showBox = mk('input');
      showBox.type = 'checkbox';
      showLbl.append(showBox, 'Show password');
      showBox.addEventListener('change', () => {
        i1.type = showBox.checked ? 'text' : 'password';
        if (i2) i2.type = i1.type;
      });
      const err = mk('div', 'pwerr', error || '');
      err.setAttribute('role', 'alert');
      const btns = mk('div', 'pwbtns');
      const cancel = mk('button', 'tb', 'Cancel');
      const ok = mk('button', 'tb primary', okLabel || 'OK');
      btns.append(cancel);
      let removeBtn = null;
      if (canRemove) {
        removeBtn = mk('button', 'tb', 'Remove password');
        btns.append(removeBtn);
      }
      btns.append(ok);
      box.append(mk('h3', '', title), mk('p', 'pwnote', note || ''), i1);
      if (i2) box.append(i2);
      box.append(showLbl, err, btns);
      ov.append(box);

      const done = (v) => {
        ov.remove();
        wrap.focus({ preventScroll: true });
        resolve(v);
      };
      const submit = () => {
        if (!i1.value) { err.textContent = 'Type a password.'; i1.focus(); return; }
        if (confirm) {
          if (i1.value.length < C.MIN_LENGTH) { err.textContent = 'Use at least ' + C.MIN_LENGTH + ' characters.'; i1.focus(); return; }
          if (i1.value !== i2.value) { err.textContent = 'The two passwords do not match.'; i2.focus(); return; }
        }
        done({ password: i1.value, remove: false });
      };
      ok.addEventListener('click', submit);
      cancel.addEventListener('click', () => done(null));
      if (removeBtn) removeBtn.addEventListener('click', () => done({ password: null, remove: true }));
      ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(null); });
      ov.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
          e.preventDefault();
          e.stopPropagation();
          submit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          done(null);
        }
      });
      document.body.appendChild(ov);
      i1.focus();
    });
  }

  async function managePassword() {
    const res = await pwDialog({
      title: docPassword ? 'Change or remove password' : 'Protect with a password',
      note: 'The file is encrypted (AES-256) the next time you save. If you forget the password the file cannot be opened; there is no recovery.',
      confirm: true,
      canRemove: !!docPassword,
      okLabel: docPassword ? 'Change password' : 'Set password'
    });
    if (!res) return;
    if (res.remove) {
      docPassword = null;
      flash('Password removed. Save to store the file without one.');
    } else {
      docPassword = res.password;
      flash('Password set. Save to encrypt the file.');
    }
    setDirty(true);
  }

  (function addPasswordButton() {
    const qat = document.querySelector('.qat');
    if (!qat) return;
    const b = document.createElement('button');
    b.className = 'tb fbtn';
    b.id = 'btn-password';
    b.textContent = '🔒 Password';
    b.title = 'Protect this file with a password';
    b.addEventListener('click', managePassword);
    qat.appendChild(b);
    qat.style.flexWrap = 'wrap';
  })();

  api.onMenu((action) => {
    switch (action) {
      case 'new': return newDoc();
      case 'open': return openDoc();
      case 'save': return save(false);
      case 'save-as': return save(true);
      case 'import-csv': return importCSV();
      case 'export-csv': return exportCSV();
      case 'export-xlsx': return exportXlsx();
      case 'password': return managePassword();
      case 'undo': return doUndo();
      case 'redo': return doRedo();
      default:
    }
  });

  let scrollQueued = false;
  wrap.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      syncWindow(false);
    });
  }, { passive: true });
  ctx.onWindowMoved = () => {
    if (editing) positionEditor(editing.r, editing.c);
  };

  /* ---------- boot ---------- */

  buildGrid();
  setSelection({ r: 0, c: 0 }, null, { scroll: false });
  afterChange();
  wrap.focus({ preventScroll: true });
  setDirty(false);

  // Not Object.assign: that would copy the getters' current values instead of keeping them live.
  Object.defineProperties(ctx, Object.getOwnPropertyDescriptors({
    ROWS,
    COLS,
    get sheet() { return sheet; },
    get fmts() { return fmts; },
    get merges() { return merges; },
    get cf() { return cfRules; },
    get anchor() { return anchor; },
    get colWidths() { return colWidths; },
    get rowHeights() { return rowHeights; },
    activeKey: () => key(anchor.r, anchor.c),
    activeFmt: () => fmts.get(key(anchor.r, anchor.c)) || {},
    rect,
    masterOf,
    forEachInSelection,
    transact,
    setRaw,
    setFmt,
    applyFmt,
    toggleFlag,
    applyBorders,
    mergeCells,
    unmergeCells,
    setCF,
    setTheme,
    get theme() { return theme; },
    themeColors: () => themeColors,
    themeFonts: () => themeFonts,
    addChart,
    beginEdit: (text) => { if (!editing) startEdit(anchor.r, anchor.c, text, 'enter'); },
    setView: (showGrid, showHeads) => {
      grid.classList.toggle('no-grid', !showGrid);
      grid.classList.toggle('no-heads', !showHeads);
      placeOverlay();
    },
    refreshLayout: () => {
      placeOverlay();
      scheduleCharts();
    },
    setSelection,
    flash,
    autofitColumn,
    setColWidth,
    setRowHeight,
    copyFormats,
    setPainter: (p) => { painter = p; },
    painterActive: () => !!painter,
    cancelPainter: () => { painter = null; },
    focusGrid: () => wrap.focus({ preventScroll: true }),
    commitIfEditing: () => { if (editing) commitEdit(); },
    isEditing: () => !!editing,
    onSelectionChange: null,
    onContextMenu: null,
    onPainterDone: null,
    onThemeChange: null
  }));

  // Handy for tests and debugging in DevTools.
  window.__tally = { get sheet() { return sheet; }, get fmts() { return fmts; }, get charts() { return charts; }, serialize, loadTally };
})();
