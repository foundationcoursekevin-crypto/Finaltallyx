/*
 * Tally formatting UI: toolbar, color palettes, border menu, Format Cells dialog,
 * conditional formatting, cell styles and the format painter.
 * Uses the grid through window.TallyApp (see app.js).
 */
(function () {
  'use strict';

  const A = window.TallyApp;
  const N = window.TallyNumFmt;
  const T = window.TallyTheme;
  const H = window.TallyHelpers;
  const E = window.TallyEngine;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- tiny DOM helpers ---------- */

  function el(tag, props) {
    const e = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') Object.assign(e.style, v);
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') e[k] = v;
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const kids = [].concat(arguments[i]);
      for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return e;
  }

  function icon(inner) {
    const s = el('span', { style: { display: 'inline-flex' } });
    s.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    return s;
  }

  /* ---------- constants ---------- */

  const FONTS = ['Arial', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

  /* ---------- menus ---------- */

  let menuEl = null;
  let menuCleanup = null;

  function closeMenu() {
    if (menuEl) menuEl.remove();
    menuEl = null;
    if (menuCleanup) menuCleanup();
    menuCleanup = null;
  }

  function showMenu(anchor, node) {
    closeMenu();
    const m = el('div', { class: 'menu', role: 'menu' }, node);
    m.style.visibility = 'hidden';
    document.body.append(m);
    menuEl = m;
    let x;
    let y;
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      x = r.left;
      y = r.bottom + 2;
    } else {
      x = anchor.x;
      y = anchor.y;
    }
    x = Math.max(8, Math.min(x, window.innerWidth - m.offsetWidth - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - m.offsetHeight - 8));
    m.style.left = x + 'px';
    m.style.top = y + 'px';
    m.style.visibility = '';
    const onDown = (e) => {
      if (!m.contains(e.target)) closeMenu();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        A.focusGrid();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    menuCleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
    const first = m.querySelector('button');
    if (first && !(anchor instanceof Element)) first.focus({ preventScroll: true });
    return m;
  }

  function itemsNode(items) {
    const box = el('div');
    for (const it of items) {
      if (it.sep) {
        box.append(el('div', { class: 'msep' }));
        continue;
      }
      if (it.head) {
        box.append(el('div', { class: 'mhead', text: it.head }));
        continue;
      }
      const b = el('button', { class: 'item', type: 'button', role: 'menuitem', disabled: !!it.disabled }, el('span', { class: 'check', text: it.checked ? '✓' : '' }), it.swatch ? swatchNode(it.swatch) : null, it.colors ? el('span', { class: 'chips' }, it.colors.map((c) => el('i', { style: { background: c } }))) : null, it.label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        closeMenu();
        if (it.onClick) it.onClick();
      });
      box.append(b);
    }
    return box;
  }

  function swatchNode(c) {
    return el('span', { style: { width: '14px', height: '14px', borderRadius: '3px', border: '1px solid var(--line-strong)', background: c, flex: 'none' } });
  }

  const SLOT_NAMES = ['Background 1', 'Text 1', 'Background 2', 'Text 2', 'Accent 1', 'Accent 2', 'Accent 3', 'Accent 4', 'Accent 5', 'Accent 6'];

  // Theme colors first (they follow the workbook theme), then fixed standard colors.
  function makePalette(onPick, noneLabel, current) {
    const root = el('div', { class: 'palette' });
    const colors = A.themeColors();
    const pick = (c) => () => onPick(c);
    const sw = (value, title) => el('button', { class: 'sw' + (current === value ? ' on' : ''), type: 'button', title, 'aria-label': title, style: { background: T.resolve(value, colors) }, onclick: pick(value) });
    if (noneLabel) root.append(el('button', { class: 'pbtn', type: 'button', text: noneLabel, onclick: pick(null) }));
    const grid = el('div', { class: 'pgrid' });
    for (let i = 0; i < 10; i++) grid.append(sw(T.ref(i, 0), SLOT_NAMES[i]));
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i < 10; i++) {
        const t = T.tintsFor(i)[row];
        grid.append(sw(T.ref(i, t), SLOT_NAMES[i] + ', ' + (t > 0 ? 'lighter ' : 'darker ') + Math.round(Math.abs(t) * 100) + '%'));
      }
    }
    root.append(el('div', { class: 'plabel', text: 'Theme colors' }), grid);
    const std = el('div', { class: 'pgrid' });
    for (const c of STANDARD) std.append(sw(c, c));
    root.append(el('div', { class: 'plabel', text: 'Standard colors' }), std);
    const input = el('input', { type: 'color', class: 'hidden', tabindex: '-1', 'aria-hidden': 'true' });
    input.addEventListener('change', () => onPick(input.value));
    root.append(el('button', { class: 'pbtn', type: 'button', text: 'More colors…', onclick: () => input.click() }), input);
    return root;
  }

  /* ---------- dialogs ---------- */

  function dialog(cls, build) {
    A.commitIfEditing();
    closeMenu();
    const dlg = el('dialog', { class: 'dlg ' + (cls || '') });
    const form = el('form', { method: 'dialog' });
    dlg.append(form);
    build(form, dlg);
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      dlg.remove();
      A.focusGrid();
    });
    dlg.showModal();
    return dlg;
  }

  function footer(dlg, okLabel) {
    return el('div', { class: 'foot' }, el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => dlg.close() }), el('button', { class: 'btn primary', type: 'submit', text: okLabel || 'OK' }));
  }

  // fields: [{ key, type: 'number' | 'text' | 'select' | 'note', label, value, options, min, max, step }]
  function ask(title, fields, okLabel) {
    return new Promise((resolve) => {
      let done = false;
      dialog('', (form, dlg) => {
        const body = el('div', { class: 'body' });
        const inputs = {};
        for (const f of fields) {
          if (f.type === 'note') {
            body.append(el('p', { class: 'note', text: f.label }));
            continue;
          }
          let input;
          if (f.type === 'select') {
            input = el('select', null, f.options.map((o) => el('option', { value: o.value, text: o.label, selected: String(o.value) === String(f.value) })));
          } else {
            input = el('input', { type: f.type === 'number' ? 'number' : 'text', value: f.value === undefined ? '' : String(f.value), min: f.min, max: f.max, step: f.step || 'any', required: f.required !== false && f.type === 'number' });
          }
          inputs[f.key] = input;
          body.append(el('label', { class: 'field' }, f.label, input));
        }
        form.append(el('h2', { text: title }), body, footer(dlg, okLabel));
        form.addEventListener('submit', () => {
          done = true;
          const out = {};
          for (const k of Object.keys(inputs)) out[k] = inputs[k].value;
          resolve(out);
        });
        dlg.addEventListener('close', () => {
          if (!done) resolve(null);
        });
      });
    });
  }

  /* ---------- applying formats ---------- */

  const patchAll = (patch) => A.applyFmt(patch);

  function eachCell(fn) {
    A.transact(() =>
      A.forEachInSelection((k) => {
        const patch = fn(A.fmts.get(k) || {}, k);
        if (patch) A.setFmt(k, patch);
      })
    );
  }

  function setAlign(prop, val) {
    patchAll({ [prop]: A.activeFmt()[prop] === val ? undefined : val });
  }

  function changeIndent(d) {
    const f = A.activeFmt();
    const n = clamp((f.indent || 0) + d, 0, 15);
    patchAll({ indent: n || undefined, align: n > 0 && !f.align ? 'left' : f.align });
  }

  function changeSize(d) {
    const cur = A.activeFmt().size || 11;
    let next;
    if (d > 0) next = SIZES.find((s) => s > cur) || cur;
    else next = SIZES.slice().reverse().find((s) => s < cur) || cur;
    patchAll({ size: next === 11 ? undefined : next });
  }

  function setSize(raw) {
    const n = parseFloat(raw);
    if (!isFinite(n) || n < 1 || n > 409) return false;
    patchAll({ size: n === 11 ? undefined : Math.round(n * 2) / 2 });
    return true;
  }

  function setNumberFormat(code) {
    patchAll({ nf: !code || code === 'General' ? undefined : code });
  }

  function changeDecimals(delta) {
    eachCell((f, k) => {
      const v = A.sheet.getValue(k);
      const next = N.adjustDecimals(f.nf || 'General', delta, v);
      return { nf: next === 'General' ? undefined : next };
    });
  }

  function mergeToggle() {
    const R = A.rect();
    const m = A.masterOf(A.anchor.r, A.anchor.c);
    const isMerged = m && m.r1 === R.r1 && m.r2 === R.r2 && m.c1 === R.c1 && m.c2 === R.c2;
    if (isMerged) A.transact(() => A.unmergeCells());
    else if (R.r1 === R.r2 && R.c1 === R.c2) A.flash('Select two or more cells to merge');
    else A.transact(() => A.mergeCells(true));
  }

  const THIN = { s: 'thin', c: 'auto' };
  const MEDIUM = { s: 'medium', c: 'auto' };
  const THICK = { s: 'thick', c: 'auto' };
  const DOUBLE = { s: 'double', c: 'auto' };
  const borders = (spec) => A.transact(() => A.applyBorders(spec));

  /* ---------- toolbar ---------- */

  const ui = {};
  const last = { text: '#ff0000', fill: '#ffff00' };
  const setBar = (kind) => ui[kind + 'Bar'].style.setProperty('--swatch', T.resolve(last[kind], A.themeColors()));

  function mkBtn(id, title, content, onClick, toggle) {
    const b = el('button', { class: 'tb', type: 'button', id: 'btn-' + id, title, 'aria-label': title, 'aria-pressed': toggle ? 'false' : null });
    if (content) b.append(content);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    ui[id] = b;
    return b;
  }

  function applyColor(kind, color) {
    if (color) {
      last[kind] = color;
      setBar(kind);
    }
    patchAll(kind === 'text' ? { color: color || undefined } : { bg: color || undefined });
  }

  function colorPair(kind, title, glyph) {
    const bar = el('span', { class: 'bar', style: { '--swatch': T.resolve(last[kind], A.themeColors()) } });
    ui[kind + 'Bar'] = bar;
    const main = mkBtn(kind + 'Main', title, null, () => applyColor(kind, last[kind]));
    main.classList.add('color', 'split');
    main.append(glyph, bar);
    const caret = mkBtn(kind + 'Caret', title + ' options', icon('<path d="M4 6l4 4 4-4"/>'), () => {
      const cur = A.activeFmt();
      showMenu(caret, makePalette((c) => {
        closeMenu();
        applyColor(kind, c);
      }, kind === 'text' ? 'Automatic' : 'No fill', kind === 'text' ? cur.color : cur.bg));
    });
    caret.classList.add('caret');
    return [main, caret];
  }

  function bordersMenu(anchor) {
    showMenu(anchor, itemsNode([
      { label: 'Bottom border', onClick: () => borders({ b: THIN }) },
      { label: 'Top border', onClick: () => borders({ t: THIN }) },
      { label: 'Left border', onClick: () => borders({ l: THIN }) },
      { label: 'Right border', onClick: () => borders({ r: THIN }) },
      { sep: true },
      { label: 'No border', onClick: () => borders({ t: null, b: null, l: null, r: null, h: null, v: null }) },
      { label: 'All borders', onClick: () => borders({ t: THIN, b: THIN, l: THIN, r: THIN, h: THIN, v: THIN }) },
      { label: 'Outside borders', onClick: () => borders({ t: THIN, b: THIN, l: THIN, r: THIN }) },
      { label: 'Thick outside borders', onClick: () => borders({ t: THICK, b: THICK, l: THICK, r: THICK }) },
      { sep: true },
      { label: 'Bottom double border', onClick: () => borders({ b: DOUBLE }) },
      { label: 'Thick bottom border', onClick: () => borders({ b: THICK }) },
      { label: 'Medium bottom border', onClick: () => borders({ b: MEDIUM }) },
      { label: 'Top and bottom border', onClick: () => borders({ t: THIN, b: THIN }) },
      { label: 'Top and thick bottom border', onClick: () => borders({ t: THIN, b: THICK }) },
      { label: 'Top and double bottom border', onClick: () => borders({ t: THIN, b: DOUBLE }) },
      { sep: true },
      { label: 'More borders…', onClick: () => openFormatCells('Border') }
    ]));
  }

  /* ---------- cell styles ---------- */

  const boxBd = (c) => ({ t: { s: 'thin', c }, r: { s: 'thin', c }, b: { s: 'thin', c }, l: { s: 'thin', c } });
  const STYLES = [
    ['Normal', null],
    ['Good', { bg: '#c6efce', color: '#006100' }],
    ['Bad', { bg: '#ffc7ce', color: '#9c0006' }],
    ['Neutral', { bg: '#ffeb9c', color: '#9c5700' }],
    ['Input', { bg: '#ffcc99', color: '#3f3f76', bd: boxBd('#7f7f7f') }],
    ['Calculation', { bg: '#f2f2f2', color: '#fa7d00', b: true, bd: boxBd('#7f7f7f') }],
    ['Check cell', { bg: '#a5a5a5', color: '#ffffff', b: true, bd: { t: DOUBLE, r: DOUBLE, b: DOUBLE, l: DOUBLE } }],
    ['Note', { bg: '#ffffcc', color: '#000000', bd: boxBd('#b2b2b2') }],
    ['Warning', { color: '#ff0000' }],
    ['Title', { size: 18, b: true, color: 't:3:0', font: 'theme:heading' }],
    ['Heading 1', { size: 15, b: true, color: 't:3:0', font: 'theme:heading', bd: { b: { s: 'thick', c: 't:4:0' } } }],
    ['Heading 2', { size: 13, b: true, color: 't:3:0', font: 'theme:heading', bd: { b: { s: 'thick', c: 't:4:0.6' } } }],
    ['Heading 3', { b: true, color: 't:3:0', font: 'theme:heading', bd: { b: { s: 'medium', c: 't:4:0.4' } } }],
    ['Total', { b: true, bd: { t: { s: 'thin', c: 't:4:0' }, b: { s: 'double', c: 't:4:0' } } }],
    ['Comma', { nf: N.COMMA_STYLE }],
    ['Currency', { nf: '$#,##0.00' }],
    ['Percent', { nf: '0%' }]
  ];

  function applyStyle(style) {
    A.transact(() =>
      A.forEachInSelection((k) => {
        if (!style) A.setFmt(k, null, true);
        else A.setFmt(k, style);
      })
    );
  }

  function stylesMenu(anchor) {
    const grid = el('div', { class: 'styles-grid' });
    for (const [name, st] of STYLES) {
      const b = el('button', { type: 'button', text: name, title: name });
      if (st) {
        if (st.bg) b.style.background = T.resolve(st.bg, A.themeColors());
        if (st.color) b.style.color = T.resolve(st.color, A.themeColors());
        if (st.b) b.style.fontWeight = '700';
        if (st.size) b.style.fontSize = Math.min(st.size, 15) * (4 / 3) + 'px';
      }
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        closeMenu();
        applyStyle(st);
      });
      grid.append(b);
    }
    showMenu(anchor, el('div', null, el('div', { class: 'styles-head', text: 'Cell styles' }), grid));
  }

  /* ---------- conditional formatting ---------- */

  const HL = [
    ['Light red fill with dark red text', { bg: '#ffc7ce', color: '#9c0006' }],
    ['Yellow fill with dark yellow text', { bg: '#ffeb9c', color: '#9c5700' }],
    ['Green fill with dark green text', { bg: '#c6efce', color: '#006100' }],
    ['Light red fill', { bg: '#ffc7ce' }],
    ['Red text', { color: '#9c0006' }],
    ['Bold red text', { color: '#c00000', b: true }]
  ];
  const fmtField = { key: 'fmt', type: 'select', label: 'Format with', options: HL.map((h, i) => ({ value: i, label: h[0] })) };

  const cfRange = () => {
    const R = A.rect();
    return { r1: R.r1, c1: R.c1, r2: R.r2, c2: R.c2 };
  };
  const newId = () => String(Date.now()) + Math.floor(Math.random() * 1e4);
  const addRule = (rule) => A.transact(() => A.setCF(A.cf.concat([Object.assign({ id: newId(), range: cfRange() }, rule)])));

  async function highlight(type, title, fields) {
    const v = await ask(title, fields.concat([fmtField]), 'OK');
    if (!v) return;
    addRule({ type, v1: v.v1, v2: v.v2, text: v.text, fmt: HL[+v.fmt][1] });
  }

  function describeRule(r) {
    switch (r.type) {
      case 'gt': return 'Cell value > ' + r.v1;
      case 'lt': return 'Cell value < ' + r.v1;
      case 'eq': return 'Cell value = ' + r.v1;
      case 'between': return 'Cell value between ' + r.v1 + ' and ' + r.v2;
      case 'contains': return 'Text contains “' + r.text + '”';
      case 'duplicate': return 'Duplicate values';
      case 'scale': return (r.colors.length === 3 ? '3' : '2') + '-color scale';
      case 'databar': return 'Data bar';
      default: return r.type;
    }
  }

  function manageRules() {
    dialog('', (form, dlg) => {
      const list = el('div', { class: 'rules' });
      const draw = () => {
        list.textContent = '';
        if (!A.cf.length) list.append(el('p', { class: 'note', text: 'No conditional formatting rules yet.' }));
        for (const r of A.cf) {
          const sw = el('span', { class: 'rsw' });
          if (r.fmt && r.fmt.bg) sw.style.background = r.fmt.bg;
          if (r.colors) sw.style.background = r.colors.length > 1 ? 'linear-gradient(90deg,' + r.colors.join(',') + ')' : r.colors[0];
          list.append(el('div', { class: 'rule' }, sw, el('div', { class: 'grow' }, describeRule(r), el('div', { class: 'note', text: 'Applies to ' + H.rangeLabel(r.range) })), el('button', {
            class: 'btn',
            type: 'button',
            text: 'Delete',
            onclick: () => {
              A.transact(() => A.setCF(A.cf.filter((x) => x !== r)));
              draw();
            }
          })));
        }
      };
      draw();
      form.append(el('h2', { text: 'Conditional formatting rules' }), el('div', { class: 'body' }, list), el('div', { class: 'foot' }, el('button', { class: 'btn primary', type: 'submit', text: 'Done' })));
    });
  }

  function cfMenu(anchor) {
    const scale = (name, colors) => ({ label: name, swatch: 'linear-gradient(90deg,' + colors.join(',') + ')', onClick: () => addRule({ type: 'scale', colors }) });
    const bar = (name, color) => ({ label: name, swatch: color, onClick: () => addRule({ type: 'databar', colors: [color] }) });
    showMenu(anchor, itemsNode([
      { head: 'Highlight cells' },
      { label: 'Greater than…', onClick: () => highlight('gt', 'Greater than', [{ key: 'v1', type: 'number', label: 'Format cells greater than' }]) },
      { label: 'Less than…', onClick: () => highlight('lt', 'Less than', [{ key: 'v1', type: 'number', label: 'Format cells less than' }]) },
      { label: 'Between…', onClick: () => highlight('between', 'Between', [{ key: 'v1', type: 'number', label: 'Between' }, { key: 'v2', type: 'number', label: 'and' }]) },
      { label: 'Equal to…', onClick: () => highlight('eq', 'Equal to', [{ key: 'v1', type: 'text', label: 'Format cells equal to' }]) },
      { label: 'Text that contains…', onClick: () => highlight('contains', 'Text that contains', [{ key: 'text', type: 'text', label: 'Format cells that contain' }]) },
      { label: 'Duplicate values…', onClick: () => highlight('duplicate', 'Duplicate values', []) },
      { head: 'Color scales' },
      scale('Green – yellow – red', ['#63be7b', '#ffeb84', '#f8696b']),
      scale('Red – yellow – green', ['#f8696b', '#ffeb84', '#63be7b']),
      scale('Blue – white – red', ['#5a8ac6', '#ffffff', '#f8696b']),
      scale('White – green', ['#ffffff', '#63be7b']),
      scale('White – red', ['#ffffff', '#f8696b']),
      { head: 'Data bars' },
      bar('Blue', '#638ec6'),
      bar('Green', '#63c384'),
      bar('Red', '#ff555a'),
      bar('Orange', '#ffb628'),
      { sep: true },
      {
        label: 'Clear rules from selected cells',
        onClick: () => {
          const R = A.rect();
          const hit = (g) => g.r1 <= R.r2 && g.r2 >= R.r1 && g.c1 <= R.c2 && g.c2 >= R.c1;
          A.transact(() => A.setCF(A.cf.filter((r) => !hit(r.range))));
        }
      },
      { label: 'Clear rules from entire sheet', onClick: () => A.transact(() => A.setCF([])) },
      { label: 'Manage rules…', onClick: manageRules }
    ]));
  }

  /* ---------- Format Cells dialog ---------- */

  const CATS = ['General', 'Number', 'Currency', 'Accounting', 'Date', 'Time', 'Percentage', 'Fraction', 'Scientific', 'Text', 'Custom'];
  const CUSTOM_CODES = ['General', '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '$#,##0.00', 'mm/dd/yy', 'h:mm', 'h:mm AM/PM', '@', '0.0,"K"', '[Red][<0]0;0', '000-00-0000', '(###) ###-####'];

  function openFormatCells(startTab) {
    A.commitIfEditing();
    const k = A.activeKey();
    const f = A.fmts.get(k) || {};
    const v = A.sheet.getValue(k);
    const R = A.rect();
    const mm = A.masterOf(A.anchor.r, A.anchor.c);
    const merged = !!mm && mm.r1 === R.r1 && mm.r2 === R.r2 && mm.c1 === R.c1 && mm.c2 === R.c2;
    const multiRows = R.r2 > R.r1;
    const multiCols = R.c2 > R.c1;
    const st = { nf: f.nf || 'General', align: f.align || '', va: f.va || 'bottom', indent: f.indent || 0, wrap: !!f.wrap, merge: merged, font: f.font || '', b: !!f.b, i: !!f.i, size: f.size || 11, u: f.u || '', s: !!f.s, color: f.color || '', bg: f.bg || '' };
    const init = Object.assign({}, st);
    const bdSpec = {};
    const tabs = ['Number', 'Alignment', 'Font', 'Border', 'Fill'];
    const panes = {};

    /* ----- Number ----- */
    (function () {
      const d = N.detectCategory(st.nf);
      let cat = d.cat;
      const o = Object.assign({ decimals: 2, thousands: false, neg: 0, symbol: '$' }, d.o);
      const sample = el('div', { class: 'sample' });
      const opts = el('div', { class: 'col' });
      const list = el('select', { class: 'catlist', size: CATS.length, 'aria-label': 'Category' }, CATS.map((c) => el('option', { value: c, text: c, selected: c === cat })));
      const code = () => (cat === 'Custom' ? o.code || 'General' : N.buildCode(cat, o));
      const sampleValue = () => {
        if (cat === 'Text') return typeof v === 'string' ? v : 'Sample text';
        if (typeof v === 'number') return v;
        return cat === 'Date' || cat === 'Time' ? 45000.75 : 1234.5678;
      };
      const show = (c, val) => N.format(val, c).text.split(N.FILL).join('   ');
      function refresh() {
        const c = code();
        st.nf = c;
        sample.replaceChildren(el('b', { text: 'Sample' }), show(c, sampleValue()));
      }
      const num = (label, key, min, max) =>
        el('label', { class: 'field' }, label, el('input', {
          type: 'number', min, max, step: 1, value: String(o[key]),
          oninput: (e) => {
            const n = parseInt(e.target.value, 10);
            if (isFinite(n)) o[key] = clamp(n, min, max);
            refresh();
            if (cat === 'Number' || cat === 'Currency') renderNegatives();
          }
        }));
      let negBox = null;
      function renderNegatives() {
        if (!negBox) return;
        const sel = negBox.querySelector('select');
        [...sel.options].forEach((opt, i) => {
          opt.textContent = show(N.buildCode(cat, Object.assign({}, o, { neg: i })), -1234.1);
        });
      }
      function negField() {
        negBox = el('label', { class: 'field' }, 'Negative numbers', el('select', { onchange: (e) => { o.neg = +e.target.value; refresh(); } }, [0, 1, 2, 3].map((i) => el('option', { value: i, selected: o.neg === i, text: '' }))));
        renderNegatives();
        return negBox;
      }
      const typeList = (codes, key) => {
        const s = el('select', { size: 8, 'aria-label': 'Type', onchange: (e) => { o[key] = e.target.value; refresh(); } },
          codes.map((c) => el('option', { value: c, selected: code() === c, text: show(c, typeof v === 'number' ? v : 45000.75) })));
        return el('label', { class: 'field' }, 'Type', s);
      };
      function renderOpts() {
        opts.textContent = '';
        negBox = null;
        switch (cat) {
          case 'General':
            opts.append(el('p', { class: 'note', text: 'General cells show numbers as you typed them. Use another category to control decimals, symbols, dates and more.' }));
            break;
          case 'Number':
            opts.append(num('Decimal places', 'decimals', 0, 30), el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!o.thousands, onchange: (e) => { o.thousands = e.target.checked; refresh(); } }), 'Use 1000 separator (,)'), negField());
            break;
          case 'Currency':
            opts.append(num('Decimal places', 'decimals', 0, 30), symbolField(), negField());
            break;
          case 'Accounting':
            opts.append(num('Decimal places', 'decimals', 0, 30), symbolField());
            break;
          case 'Percentage':
          case 'Scientific':
            opts.append(num('Decimal places', 'decimals', 0, 30));
            break;
          case 'Date':
            opts.append(typeList(N.DATE_TYPES, 'type'));
            break;
          case 'Time':
            opts.append(typeList(N.TIME_TYPES, 'type'));
            break;
          case 'Fraction':
            opts.append(typeList(N.FRACTION_TYPES, 'type'));
            break;
          case 'Text':
            opts.append(el('p', { class: 'note', text: 'Text cells show what you typed, even numbers. Formulas in text cells are not calculated.' }));
            break;
          default: {
            const input = el('input', { type: 'text', value: o.code || 'General', spellcheck: 'false', 'aria-label': 'Format code', oninput: (e) => { o.code = e.target.value; refresh(); } });
            const known = el('select', { size: 7, 'aria-label': 'Existing formats', onchange: (e) => { o.code = e.target.value; input.value = o.code; refresh(); } }, CUSTOM_CODES.map((c) => el('option', { value: c, text: c })));
            opts.append(el('label', { class: 'field' }, 'Format code', input), el('label', { class: 'field' }, 'Examples', known), el('p', { class: 'note', text: '0 # ? are digit placeholders. Use [Red] for color, "text" for literal text, yyyy mm dd h:mm for dates and times.' }));
          }
        }
        refresh();
      }
      function symbolField() {
        const syms = N.SYMBOLS.map((s) => (s === '' ? { v: '', t: 'None' } : { v: s, t: s }));
        if (o.symbol && !N.SYMBOLS.includes(o.symbol)) syms.push({ v: o.symbol, t: o.symbol });
        return el('label', { class: 'field' }, 'Symbol', el('select', { onchange: (e) => { o.symbol = e.target.value; refresh(); if (cat === 'Currency') renderNegatives(); } }, syms.map((s) => el('option', { value: s.v, text: s.t, selected: s.v === o.symbol }))));
      }
      list.addEventListener('change', () => {
        const prev = code();
        cat = list.value;
        if (cat === 'Custom') o.code = prev;
        if (cat === 'Date' && !N.DATE_TYPES.includes(o.type)) o.type = N.DATE_TYPES[0];
        if (cat === 'Time' && !N.TIME_TYPES.includes(o.type)) o.type = N.TIME_TYPES[0];
        if (cat === 'Fraction' && !N.FRACTION_TYPES.includes(o.type)) o.type = N.FRACTION_TYPES[0];
        renderOpts();
      });
      renderOpts();
      panes.Number = el('div', { class: 'pane' }, sample, el('div', { class: 'row' }, list, opts));
    })();

    /* ----- Alignment ----- */
    (function () {
      const sel = (label, key, options) => el('label', { class: 'field' }, label, el('select', { onchange: (e) => { st[key] = e.target.value; } }, options.map((o) => el('option', { value: o[0], text: o[1], selected: st[key] === o[0] }))));
      const mergeBox = el('input', { type: 'checkbox', checked: st.merge, disabled: !multiRows && !multiCols && !merged, onchange: (e) => { st.merge = e.target.checked; } });
      panes.Alignment = el('div', { class: 'pane' }, el('div', { class: 'col' },
        sel('Horizontal', 'align', [['', 'General'], ['left', 'Left (indent)'], ['center', 'Center'], ['right', 'Right (indent)'], ['justify', 'Justify']]),
        sel('Vertical', 'va', [['top', 'Top'], ['middle', 'Center'], ['bottom', 'Bottom']]),
        el('label', { class: 'field' }, 'Indent', el('input', { type: 'number', min: 0, max: 15, step: 1, value: String(st.indent), oninput: (e) => { st.indent = clamp(parseInt(e.target.value, 10) || 0, 0, 15); } })),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: st.wrap, onchange: (e) => { st.wrap = e.target.checked; } }), 'Wrap text'),
        el('label', { class: 'check' }, mergeBox, 'Merge cells')
      ));
    })();

    /* ----- Font ----- */
    (function () {
      const preview = el('div', { class: 'fontpreview', text: 'AaBbCcYyZz' });
      const styleOf = () => (st.b && st.i ? 'Bold Italic' : st.b ? 'Bold' : st.i ? 'Italic' : 'Regular');
      function paint() {
        preview.style.fontFamily = st.font ? '"' + T.resolveFont(st.font, A.themeFonts()) + '", var(--font)' : '';
        preview.style.fontWeight = st.b ? '700' : '';
        preview.style.fontStyle = st.i ? 'italic' : '';
        preview.style.fontSize = Math.min(st.size, 40) * (4 / 3) + 'px';
        preview.style.color = st.color || '';
        preview.style.textDecorationLine = [st.u ? 'underline' : '', st.s ? 'line-through' : ''].join(' ').trim();
        preview.style.textDecorationStyle = st.u === 'double' ? 'double' : '';
      }
      const fontList = el('select', { size: 7, 'aria-label': 'Font', onchange: (e) => { st.font = e.target.value; paint(); } },
        [el('option', { value: '', text: 'Default (body font)', selected: st.font === '' }), el('option', { value: 'theme:heading', text: 'Headings font', selected: st.font === 'theme:heading' })].concat((FONTS.includes(st.font) || !st.font || st.font.indexOf('theme:') === 0 ? FONTS : FONTS.concat([st.font])).map((n) => el('option', { value: n, text: n, selected: st.font === n, style: { fontFamily: '"' + n + '"' } }))));
      const colorInput = el('input', { type: 'color', value: st.color || '#000000', 'aria-label': 'Font color', oninput: (e) => { st.color = e.target.value; auto.checked = false; paint(); } });
      const auto = el('input', { type: 'checkbox', checked: !st.color, onchange: (e) => { if (e.target.checked) st.color = ''; else st.color = colorInput.value; paint(); } });
      panes.Font = el('div', { class: 'pane' }, el('div', { class: 'row' },
        el('div', { class: 'col' },
          el('label', { class: 'field' }, 'Font', fontList),
          el('label', { class: 'field' }, 'Underline', el('select', { onchange: (e) => { st.u = e.target.value; paint(); } }, [['', 'None'], ['single', 'Single'], ['double', 'Double']].map((o) => el('option', { value: o[0], text: o[1], selected: (st.u === true ? 'single' : st.u) === o[0] }))))),
        el('div', { class: 'col' },
          el('label', { class: 'field' }, 'Font style', el('select', { onchange: (e) => { const x = e.target.value; st.b = x === 'Bold' || x === 'Bold Italic'; st.i = x === 'Italic' || x === 'Bold Italic'; paint(); } }, ['Regular', 'Italic', 'Bold', 'Bold Italic'].map((n) => el('option', { value: n, text: n, selected: styleOf() === n })))),
          el('label', { class: 'field' }, 'Size', el('input', { type: 'number', min: 1, max: 409, step: 0.5, value: String(st.size), oninput: (e) => { const n = parseFloat(e.target.value); if (isFinite(n) && n >= 1 && n <= 409) { st.size = n; paint(); } } })),
          el('div', { class: 'field' }, 'Color', el('div', { class: 'row', style: { alignItems: 'center' } }, colorInput, el('label', { class: 'check' }, auto, 'Automatic'))),
          el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: st.s, onchange: (e) => { st.s = e.target.checked; paint(); } }), 'Strikethrough'))),
        el('div', { class: 'field', style: { marginTop: '14px' } }, 'Preview', preview));
      paint();
    })();

    /* ----- Border ----- */
    (function () {
      const style = { s: 'thin', c: 'auto' };
      const cur = () => ({ s: style.s, c: style.c });
      const preview = el('div', { class: 'bdpreview', role: 'img', 'aria-label': 'Border preview' });
      const ph = el('div', { class: 'h' });
      const pv = el('div', { class: 'v' });
      preview.append(ph, pv);
      const css = (b) => {
        const col = !b.c || b.c === 'auto' ? 'var(--ink)' : b.c;
        const w = b.s === 'thick' ? 3 : b.s === 'medium' ? 2 : b.s === 'double' ? 3 : 1;
        return w + 'px ' + (b.s === 'double' ? 'double' : b.s === 'dashed' ? 'dashed' : b.s === 'dotted' ? 'dotted' : 'solid') + ' ' + col;
      };
      const guide = '1px dashed var(--line-strong)';
      const sides = [['t', 'Top', true], ['b', 'Bottom', true], ['l', 'Left', true], ['r', 'Right', true], ['h', 'Inside horizontal', multiRows], ['v', 'Inside vertical', multiCols]];
      const btns = {};
      function paint() {
        const g = (s) => (bdSpec[s] ? css(bdSpec[s]) : guide);
        preview.style.borderTop = g('t');
        preview.style.borderBottom = g('b');
        preview.style.borderLeft = g('l');
        preview.style.borderRight = g('r');
        ph.style.borderTop = bdSpec.h ? css(bdSpec.h) : multiRows ? guide : 'none';
        pv.style.borderLeft = bdSpec.v ? css(bdSpec.v) : multiCols ? guide : 'none';
        for (const [s] of sides) btns[s].setAttribute('aria-pressed', String(!!bdSpec[s]));
      }
      for (const [s, label, enabled] of sides) {
        btns[s] = el('button', { class: 'btn bdbtn', type: 'button', text: label, disabled: !enabled, 'aria-pressed': 'false', onclick: () => { bdSpec[s] = bdSpec[s] ? null : cur(); paint(); } });
      }
      const preset = (label, fn) => el('button', { class: 'btn', type: 'button', text: label, onclick: () => { fn(); paint(); } });
      const colorInput = el('input', { type: 'color', value: '#000000', 'aria-label': 'Border color', oninput: (e) => { style.c = e.target.value; auto.checked = false; } });
      const auto = el('input', { type: 'checkbox', checked: true, onchange: (e) => { style.c = e.target.checked ? 'auto' : colorInput.value; } });
      const styleSel = el('select', { 'aria-label': 'Line style', onchange: (e) => { style.s = e.target.value; } }, [['thin', 'Thin'], ['medium', 'Medium'], ['thick', 'Thick'], ['dotted', 'Dotted'], ['dashed', 'Dashed'], ['double', 'Double']].map((o) => el('option', { value: o[0], text: o[1] })));
      panes.Border = el('div', { class: 'pane' }, el('div', { class: 'row' },
        el('div', { class: 'col' },
          el('label', { class: 'field' }, 'Line style', styleSel),
          el('div', { class: 'field' }, 'Color', el('div', { class: 'row', style: { alignItems: 'center' } }, colorInput, el('label', { class: 'check' }, auto, 'Automatic'))),
          el('div', { class: 'field' }, 'Presets', el('div', { class: 'row' },
            preset('None', () => { for (const [s] of sides) bdSpec[s] = null; }),
            preset('Outline', () => { for (const s of ['t', 'b', 'l', 'r']) bdSpec[s] = cur(); }),
            preset('Inside', () => { if (multiRows) bdSpec.h = cur(); if (multiCols) bdSpec.v = cur(); })))),
        el('div', { class: 'col' }, el('div', { class: 'field' }, 'Border', el('div', { class: 'bdgrid' }, sides.map((s) => btns[s[0]])), preview))),
        el('p', { class: 'note', style: { marginTop: '12px' }, text: 'Choose a line style and color, then click the sides to add or remove. Sides you do not touch stay as they are.' }));
      paint();
    })();

    /* ----- Fill ----- */
    (function () {
      const big = el('div', { class: 'bigsw', style: { background: st.bg || 'transparent' } });
      const pal = makePalette((c) => { st.bg = c || ''; big.style.background = c || 'transparent'; }, 'No color', st.bg);
      panes.Fill = el('div', { class: 'pane' }, el('div', { class: 'row' }, el('div', { class: 'col' }, pal), el('div', { class: 'col', style: { maxWidth: '140px' } }, el('div', { class: 'field' }, 'Sample', big))));
    })();

    function apply() {
      const patch = {};
      const diff = (key) => st[key] !== init[key];
      if (diff('nf')) patch.nf = st.nf === 'General' ? undefined : st.nf;
      if (diff('align')) patch.align = st.align || undefined;
      if (diff('va')) patch.va = st.va === 'bottom' ? undefined : st.va;
      if (diff('indent')) patch.indent = st.indent || undefined;
      if (diff('wrap')) patch.wrap = st.wrap || undefined;
      if (diff('font')) patch.font = st.font || undefined;
      if (diff('b')) patch.b = st.b || undefined;
      if (diff('i')) patch.i = st.i || undefined;
      if (diff('size')) patch.size = st.size === 11 ? undefined : st.size;
      if (diff('u') && !(init.u === true && st.u === 'single')) patch.u = st.u || undefined;
      if (diff('s')) patch.s = st.s || undefined;
      if (diff('color')) patch.color = st.color || undefined;
      if (diff('bg')) patch.bg = st.bg || undefined;
      const touched = Object.keys(bdSpec).length > 0;
      if (Object.keys(patch).length || touched) {
        A.transact(() => {
          if (Object.keys(patch).length) A.forEachInSelection((key) => A.setFmt(key, patch));
          if (touched) A.applyBorders(bdSpec);
        });
      }
      if (st.merge !== init.merge) A.transact(() => (st.merge ? A.mergeCells(false) : A.unmergeCells()));
    }

    dialog('fc', (form, dlg) => {
      const tabRow = el('div', { class: 'tabs', role: 'tablist' });
      const body = el('div');
      const select = (name) => {
        for (const t of tabs) {
          panes[t].hidden = t !== name;
          tabBtns[t].setAttribute('aria-selected', String(t === name));
          tabBtns[t].tabIndex = t === name ? 0 : -1;
        }
      };
      const tabBtns = {};
      tabs.forEach((t, idx) => {
        tabBtns[t] = el('button', {
          type: 'button', role: 'tab', text: t, 'aria-selected': 'false',
          onclick: () => select(t),
          onkeydown: (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            select(next);
            tabBtns[next].focus();
          }
        });
        tabRow.append(tabBtns[t]);
        body.append(panes[t]);
      });
      form.append(el('h2', { text: 'Format cells' }), tabRow, body, footer(dlg, 'OK'));
      select(tabs.includes(startTab) ? startTab : 'Number');
      form.addEventListener('submit', apply);
    });
  }

  /* ---------- row/column size prompts ---------- */

  async function columnWidth() {
    const R = A.rect();
    const px = A.colWidths[R.c1];
    const v = await ask('Column width', [{ key: 'w', type: 'number', label: 'Width (characters)', value: Math.round(((px - 5) / 7) * 100) / 100, min: 1, max: 140 }]);
    if (!v) return;
    const w = Math.round(parseFloat(v.w) * 7 + 5);
    for (let c = R.c1; c <= R.c2; c++) A.setColWidth(c, w);
  }

  async function rowHeight() {
    const R = A.rect();
    const px = A.rowHeights[R.r1] || 24;
    const v = await ask('Row height', [{ key: 'h', type: 'number', label: 'Height (points)', value: Math.round(px * 0.75 * 100) / 100, min: 9, max: 409 }]);
    if (!v) return;
    for (let r = R.r1; r <= R.r2; r++) A.setRowHeight(r, parseFloat(v.h) / 0.75);
  }

  /* ---------- context menu ---------- */

  function contextMenu(x, y, kind) {
    const R = A.rect();
    const m = A.masterOf(A.anchor.r, A.anchor.c);
    const isMerged = !!m && m.r1 === R.r1 && m.r2 === R.r2 && m.c1 === R.c1 && m.c2 === R.c2;
    const items = [];
    if (kind === 'col') {
      items.push({ label: 'Column width…', onClick: columnWidth }, { label: 'AutoFit column width', onClick: () => { for (let c = R.c1; c <= R.c2; c++) A.autofitColumn(c); } }, { sep: true });
    } else if (kind === 'row') {
      items.push({ label: 'Row height…', onClick: rowHeight }, { label: 'Reset row height', onClick: () => { for (let r = R.r1; r <= R.r2; r++) A.setRowHeight(r, null); } }, { sep: true });
    }
    items.push({ label: 'Format cells…  (Ctrl+1)', onClick: () => openFormatCells() });
    if (kind === 'cell') {
      items.push({ label: isMerged ? 'Unmerge cells' : 'Merge and center', disabled: !isMerged && R.r1 === R.r2 && R.c1 === R.c2, onClick: mergeToggle });
      items.push({ label: 'Column width…', onClick: columnWidth }, { label: 'Row height…', onClick: rowHeight });
    }
    items.push({ sep: true }, { label: 'Clear formats', onClick: () => applyStyle(null) }, { label: 'Clear contents', onClick: () => A.transact(() => A.forEachInSelection((key) => A.setRaw(key, ''))) });
    showMenu({ x, y }, itemsNode(items));
  }

  /* ---------- themes ---------- */

  const chips = (arr) => el('span', { class: 'chips' }, arr.map((c) => el('i', { style: { background: c } })));
  const applyThemePart = (part) => A.transact(() => A.setTheme(Object.assign({}, A.theme, part)));

  function themesMenu(anchor) {
    const grid = el('div', { class: 'themecards' });
    for (const th of T.THEMES) {
      const cs = T.colorSet(th.colors);
      const fs = T.fontSet(th.fonts);
      const on = A.theme.colors === th.colors && A.theme.fonts === th.fonts;
      const card = el('button', { class: 'themecard' + (on ? ' on' : ''), type: 'button', title: th.name },
        el('strong', { text: th.name }),
        chips(cs.c.slice(4)),
        el('span', { class: 'sample', text: fs.heading + ' / ' + fs.body, style: { fontFamily: '"' + fs.body + '", var(--font)' } }));
      card.addEventListener('mousedown', (e) => e.preventDefault());
      card.addEventListener('click', () => {
        closeMenu();
        applyThemePart({ colors: th.colors, fonts: th.fonts });
      });
      grid.append(card);
    }
    showMenu(anchor, el('div', null, el('div', { class: 'styles-head', text: 'Built-in themes' }), grid));
  }

  function colorsMenu(anchor) {
    showMenu(anchor, itemsNode(T.COLOR_SETS.map((cs) => ({ label: cs.name, colors: cs.c.slice(2, 10), checked: A.theme.colors === cs.name, onClick: () => applyThemePart({ colors: cs.name }) }))));
  }

  function fontsMenu(anchor) {
    showMenu(anchor, itemsNode(T.FONT_SETS.map((fs) => ({ label: fs.heading + ' / ' + fs.body, checked: A.theme.fonts === fs.name, onClick: () => applyThemePart({ fonts: fs.name }) }))));
  }

  /* ---------- editing helpers for the Formulas tab ---------- */

  function autoSum() {
    const R = A.rect();
    const num = (r, c) => typeof A.sheet.getValue(E.key(r, c)) === 'number';
    const single = R.r1 === R.r2 && R.c1 === R.c2;
    if (!single) {
      if (R.r2 + 1 >= A.ROWS) {
        A.flash('There is no row below the selection for the total');
        return;
      }
      A.transact(() => {
        for (let c = R.c1; c <= R.c2; c++) A.setRaw(E.key(R.r2 + 1, c), '=SUM(' + E.key(R.r1, c) + ':' + E.key(R.r2, c) + ')');
      });
      return;
    }
    let r = R.r1 - 1;
    while (r >= 0 && num(r, R.c1)) r--;
    if (r < R.r1 - 1) {
      A.transact(() => A.setRaw(E.key(R.r1, R.c1), '=SUM(' + E.key(r + 1, R.c1) + ':' + E.key(R.r1 - 1, R.c1) + ')'));
      return;
    }
    let c = R.c1 - 1;
    while (c >= 0 && num(R.r1, c)) c--;
    if (c < R.c1 - 1) {
      A.transact(() => A.setRaw(E.key(R.r1, R.c1), '=SUM(' + E.key(R.r1, c + 1) + ':' + E.key(R.r1, R.c1 - 1) + ')'));
      return;
    }
    A.beginEdit('=SUM(');
  }

  /* ---------- build the ribbon ---------- */

  const view = { grid: true, heads: true, formula: true };
  const viewChecks = [];

  function viewCheck(key, label) {
    const input = el('input', { type: 'checkbox', checked: view[key] });
    input.addEventListener('change', () => {
      view[key] = input.checked;
      applyView();
    });
    input.dataset.view = key;
    viewChecks.push(input);
    return el('label', { class: 'rcheck' }, input, label);
  }

  function applyView() {
    for (const i of viewChecks) i.checked = view[i.dataset.view];
    A.setView(view.grid, view.heads);
    $('formulabar').hidden = !view.formula;
    A.refreshLayout();
  }

  function groupBox(label, ...rows) {
    return el('div', { class: 'rgroup', role: 'group', 'aria-label': label },
      el('div', { class: 'rrows' }, rows.map((r) => el('div', { class: 'rrow' }, r))),
      el('div', { class: 'rlabel', text: label }));
  }

  const big = (b) => {
    b.classList.add('rbig');
    return b;
  };

  function buildRibbon(panels) {
    const tabs = $('rtabs');
    const body = $('rbody');
    tabs.textContent = ''; // rebuild from scratch so a re-run never stacks a second ribbon
    body.textContent = '';
    const names = Object.keys(panels);
    const btns = {};
    const select = (name) => {
      closeMenu();
      for (const n of names) {
        panels[n].hidden = n !== name;
        btns[n].setAttribute('aria-selected', String(n === name));
        btns[n].tabIndex = n === name ? 0 : -1;
      }
    };
    names.forEach((n, idx) => {
      panels[n].hidden = true;
      panels[n].setAttribute('role', 'tabpanel');
      btns[n] = el('button', {
        class: 'rtab', type: 'button', role: 'tab', text: n, 'aria-selected': 'false',
        onclick: () => select(n),
        onkeydown: (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          e.preventDefault();
          const next = names[(idx + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length];
          select(next);
          btns[next].focus();
        }
      });
      btns[n].addEventListener('mousedown', (e) => e.preventDefault());
      tabs.append(btns[n]);
      body.append(panels[n]);
    });
    select(names[0]);
  }

  function build() {
    const txt = (t) => el('span', { class: 'txt', text: t });

    const painter = mkBtn('painter', 'Format painter: copy formats to other cells', icon('<path d="M9.5 2.5l4 4-5.500 5.500-4-4z"/><path d="M4 8.500 2.500 13.500l5-1.500"/>'), () => {
      if (A.painterActive()) {
        A.cancelPainter();
        painter.setAttribute('aria-pressed', 'false');
        return;
      }
      A.setPainter(A.copyFormats());
      painter.setAttribute('aria-pressed', 'true');
      A.flash('Click the cells to paint the format onto (Esc cancels)');
    }, true);
    painter.append(txt('Format Painter'));
    A.onPainterDone = () => painter.setAttribute('aria-pressed', 'false');

    const fontSel = el('select', { class: 'tb wide', id: 'sel-font', title: 'Font', 'aria-label': 'Font' },
      [el('option', { value: '', text: 'Body font' }), el('option', { value: 'theme:heading', text: 'Headings font' })].concat(FONTS.map((n) => el('option', { value: n, text: n }))));
    fontSel.addEventListener('change', () => {
      patchAll({ font: fontSel.value || undefined });
      A.focusGrid();
    });
    ui.font = fontSel;

    const sizeIn = el('input', { class: 'tb size', id: 'in-size', type: 'text', inputmode: 'decimal', list: 'size-list', title: 'Font size', 'aria-label': 'Font size' });
    sizeIn.addEventListener('change', () => {
      if (!setSize(sizeIn.value)) sync();
    });
    sizeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (setSize(sizeIn.value)) A.focusGrid();
      } else if (e.key === 'Escape') {
        sync();
        A.focusGrid();
      }
    });
    ui.size = sizeIn;
    const sizeList = el('datalist', { id: 'size-list' }, SIZES.map((s) => el('option', { value: String(s) })));

    const bordersBtn = mkBtn('borders', 'Borders', null, () => bordersMenu(ui.borders));
    bordersBtn.append(icon('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M8 2.5v11M2.5 8h11"/>'), icon('<path d="M4 6l4 4 4-4"/>'));
    ui.borders.querySelectorAll('svg')[1].setAttribute('width', '8');

    const nfSel = el('select', { class: 'tb', id: 'sel-nf', title: 'Number format', 'aria-label': 'Number format' },
      N.QUICK.map((q) => el('option', { value: q[0], text: q[0] })).concat([el('option', { value: 'Custom', text: 'Custom', hidden: true }), el('option', { value: '__more', text: 'More number formats…' })]));
    nfSel.addEventListener('change', () => {
      const val = nfSel.value;
      if (val === '__more') {
        sync();
        openFormatCells('Number');
        return;
      }
      const q = N.QUICK.find((x) => x[0] === val);
      if (q) setNumberFormat(q[1]);
      A.focusGrid();
    });
    ui.nf = nfSel;

    const cfBtn = mkBtn('cf', 'Conditional formatting', null, () => cfMenu(ui.cf));
    cfBtn.append(icon('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 6.500h11M2.5 10h11M7 2.500v11"/><path d="M3.500 4.500h2" stroke-width="2.500"/>'), txt('Conditional formatting'));
    const stylesBtn = mkBtn('styles', 'Cell styles', null, () => stylesMenu(ui.styles));
    stylesBtn.append(icon('<path d="M3 13l1-3.500L11.500 2l2.500 2.500L6.500 12z"/><path d="M9.500 4l2.500 2.500"/>'), txt('Cell styles'));
    const fcBtn = mkBtn('formatCells', 'Format cells (Ctrl+1)', null, () => openFormatCells());
    fcBtn.append(txt('Format cells…'));
    const clearBtn = mkBtn('clear', 'Clear formats', null, () => applyStyle(null));
    clearBtn.append(txt('Clear formats'));
    const sumBtn = big(mkBtn('autosum', 'AutoSum', null, autoSum));
    sumBtn.append(el('span', { class: 'txt', text: 'Σ', style: { fontSize: '22px', lineHeight: '24px', fontWeight: '500' } }), txt('AutoSum'));

    const home = el('div', { class: 'rpanel', id: 'rp-home' },
      groupBox('Clipboard', [big(painter)]),
      groupBox('Font',
        [fontSel, sizeIn, sizeList, mkBtn('grow', 'Increase font size', txt('A▴'), () => changeSize(1)), mkBtn('shrink', 'Decrease font size', txt('A▾'), () => changeSize(-1))],
        [mkBtn('bold', 'Bold (Ctrl+B)', el('b', { text: 'B' }), () => A.toggleFlag('b'), true),
          mkBtn('italic', 'Italic (Ctrl+I)', el('i', { text: 'I', style: { fontFamily: 'Georgia, serif' } }), () => A.toggleFlag('i'), true),
          mkBtn('underline', 'Underline (Ctrl+U)', el('u', { text: 'U' }), () => A.toggleFlag('u'), true),
          mkBtn('strike', 'Strikethrough (Ctrl+5)', el('s', { text: 'S' }), () => A.toggleFlag('s'), true),
          bordersBtn,
          ...colorPair('fill', 'Fill color', icon('<path d="M3 9.500 8 4.500l4.500 4.500L8 13.500z"/><path d="M13 11c.8 1 1.200 1.600 1.200 2.100a1.200 1.200 0 0 1-2.400 0c0-.5.4-1.100 1.200-2.100z" fill="currentColor"/>')),
          ...colorPair('text', 'Text color', el('span', { class: 'glyph', text: 'A', style: { fontWeight: '700' } }))]),
      groupBox('Alignment',
        [mkBtn('vtop', 'Align top', icon('<path d="M2 2.500h12M4 6h8M4 9.500h8"/>'), () => setAlign('va', 'top'), true),
          mkBtn('vmid', 'Align middle', icon('<path d="M4 4h8M2 8h12M4 12h8"/>'), () => setAlign('va', 'middle'), true),
          mkBtn('vbot', 'Align bottom', icon('<path d="M4 6.500h8M4 10h8M2 13.500h12"/>'), () => setAlign('va', 'bottom'), true),
          mkBtn('wrap', 'Wrap text', txt('Wrap text'), () => A.toggleFlag('wrap'), true)],
        [mkBtn('left', 'Align left', icon('<path d="M2 3h12M2 6.500h8M2 10h12M2 13.500h8"/>'), () => setAlign('align', 'left'), true),
          mkBtn('center', 'Align center', icon('<path d="M2 3h12M4 6.500h8M2 10h12M4 13.500h8"/>'), () => setAlign('align', 'center'), true),
          mkBtn('right', 'Align right', icon('<path d="M2 3h12M6 6.500h8M2 10h12M6 13.500h8"/>'), () => setAlign('align', 'right'), true),
          mkBtn('outdent', 'Decrease indent', icon('<path d="M2 3h12M7 6.500h7M7 10h7M2 13.500h12M5 6 2 8.200 5 10.500z"/>'), () => changeIndent(-1)),
          mkBtn('indent', 'Increase indent', icon('<path d="M2 3h12M7 6.500h7M7 10h7M2 13.500h12M2 6l3 2.200L2 10.500z"/>'), () => changeIndent(1)),
          mkBtn('merge', 'Merge and center', txt('Merge & center'), mergeToggle, true)]),
      groupBox('Number',
        [nfSel],
        [mkBtn('acct', 'Accounting format', txt('$'), () => setNumberFormat(N.ACCOUNTING('$', 2))),
          mkBtn('pct', 'Percent style', txt('%'), () => setNumberFormat('0%')),
          mkBtn('comma', 'Comma style', txt(','), () => setNumberFormat(N.COMMA_STYLE)),
          mkBtn('decUp', 'Increase decimal places', txt('.0→'), () => changeDecimals(1)),
          mkBtn('decDown', 'Decrease decimal places', txt('←.0'), () => changeDecimals(-1))]),
      groupBox('Styles', [cfBtn], [stylesBtn]),
      groupBox('Cells', [fcBtn], [clearBtn]),
      groupBox('Editing', [sumBtn]));

    const chartBtn = (id, title, label, type, path) => {
      const b = big(mkBtn(id, title, icon(path), () => A.addChart(type)));
      b.append(txt(label));
      return b;
    };
    const insert = el('div', { class: 'rpanel', id: 'rp-insert' },
      groupBox('Charts', [
        chartBtn('chart', 'Insert a column chart from the selected cells', 'Column', 'bar', '<path d="M3.500 13V8.500M8 13V3M12.500 13V6"/>'),
        chartBtn('chartLine', 'Insert a line chart from the selected cells', 'Line', 'line', '<path d="M2 12l3.500-4 3 2L14 3.500"/>'),
        chartBtn('chartPie', 'Insert a pie chart from the selected cells', 'Pie', 'pie', '<circle cx="8" cy="8" r="5.500"/><path d="M8 8V2.500M8 8l4 4"/>')]));

    const themesBtn = big(mkBtn('themes', 'Themes', icon('<rect x="2.500" y="2.500" width="4.500" height="4.500" rx="1"/><rect x="9" y="2.500" width="4.500" height="4.500" rx="1"/><rect x="2.500" y="9" width="4.500" height="4.500" rx="1"/><rect x="9" y="9" width="4.500" height="4.500" rx="1"/>'), () => themesMenu(ui.themes)));
    themesBtn.append(txt('Themes'));
    const colorsBtn = big(mkBtn('themeColors', 'Theme colors', null, () => colorsMenu(ui.themeColors)));
    ui.themeChips = chips(T.colorSet(A.theme.colors).c.slice(4, 8));
    colorsBtn.append(ui.themeChips, txt('Colors'));
    const fontsBtn = big(mkBtn('themeFonts', 'Theme fonts', null, () => fontsMenu(ui.themeFonts)));
    ui.themeFontSample = el('span', { class: 'txt', text: 'Aa', style: { fontSize: '20px', lineHeight: '22px', fontWeight: '500' } });
    fontsBtn.append(ui.themeFontSample, txt('Fonts'));
    const layout = el('div', { class: 'rpanel', id: 'rp-layout' },
      groupBox('Themes', [themesBtn, colorsBtn, fontsBtn]),
      groupBox('Sheet options', [viewCheck('grid', 'Show gridlines')], [viewCheck('heads', 'Show headings')]));

    const fn = (label, text, tip) => mkBtn('fn' + label, tip || label, txt(label), () => A.beginEdit(text));
    const sumBtn2 = big(mkBtn('fnAutosum', 'AutoSum', null, autoSum));
    sumBtn2.append(el('span', { class: 'txt', text: 'Σ', style: { fontSize: '22px', lineHeight: '24px', fontWeight: '500' } }), txt('AutoSum'));
    const formulas = el('div', { class: 'rpanel', id: 'rp-formulas' },
      groupBox('AutoSum', [sumBtn2]),
      groupBox('Function library', [fn('SUM', '=SUM(', 'Add numbers'), fn('AVERAGE', '=AVERAGE(', 'Average of numbers'), fn('COUNT', '=COUNT(', 'Count numbers'), fn('MAX', '=MAX(', 'Largest number'), fn('MIN', '=MIN(', 'Smallest number')],
        [fn('IF', '=IF(', 'Choose between two results'), fn('ROUND', '=ROUND(', 'Round a number'), fn('COUNTIF', '=COUNTIF(', 'Count cells that match'), fn('SUMIF', '=SUMIF(', 'Add cells that match'), fn('CONCAT', '=CONCAT(', 'Join text')]),
      groupBox('Date & time', [fn('TODAY', '=TODAY()', 'Today’s date'), fn('NOW', '=NOW()', 'Current date and time')], [fn('DATE', '=DATE(', 'Build a date'), fn('YEAR', '=YEAR(', 'Year of a date')]));

    const chartsToggle = big(mkBtn('chartsPanel', 'Show or hide the charts panel', icon('<path d="M3.500 13V8.500M8 13V3M12.500 13V6"/>'), () => {
      $('charts').hidden = !$('charts').hidden;
      A.refreshLayout();
    }));
    chartsToggle.append(txt('Charts panel'));
    const viewTab = el('div', { class: 'rpanel', id: 'rp-view' },
      groupBox('Show', [viewCheck('grid', 'Gridlines'), viewCheck('heads', 'Headings')], [viewCheck('formula', 'Formula bar')]),
      groupBox('Panels', [chartsToggle]));

    buildRibbon({ Format: home, Insert: insert, Look: layout, Formulas: formulas, View: viewTab });
  }

  function refreshThemeUI() {
    if (!ui.themeChips) return;
    const cs = T.colorSet(A.theme.colors).c;
    [...ui.themeChips.children].forEach((i, n) => (i.style.background = cs[4 + n]));
    const fs = A.themeFonts();
    ui.themeFontSample.style.fontFamily = '"' + fs.heading + '", var(--font)';
    ui.font.options[0].text = fs.body + ' (Body)';
    ui.font.options[1].text = fs.heading + ' (Headings)';
    setBar('text');
    setBar('fill');
  }

  /* ---------- keep the toolbar in step with the selection ---------- */

  const press = (b, on) => b.setAttribute('aria-pressed', String(!!on));

  function sync() {
    if (!ui.bold) return;
    const f = A.activeFmt();
    const R = A.rect();
    const m = A.masterOf(A.anchor.r, A.anchor.c);
    press(ui.bold, f.b);
    press(ui.italic, f.i);
    press(ui.underline, f.u);
    press(ui.strike, f.s);
    press(ui.wrap, f.wrap);
    press(ui.left, f.align === 'left');
    press(ui.center, f.align === 'center');
    press(ui.right, f.align === 'right');
    press(ui.vtop, f.va === 'top');
    press(ui.vmid, f.va === 'middle');
    press(ui.vbot, !f.va || f.va === 'bottom');
    press(ui.merge, !!m && m.r1 === R.r1 && m.r2 === R.r2 && m.c1 === R.c1 && m.c2 === R.c2);
    if (document.activeElement !== ui.font) {
      if (f.font && !FONTS.includes(f.font) && ![...ui.font.options].some((o) => o.value === f.font)) ui.font.append(el('option', { value: f.font, text: f.font }));
      ui.font.value = f.font || '';
    }
    if (document.activeElement !== ui.size) ui.size.value = String(f.size || 11);
    const code = f.nf || 'General';
    const q = N.QUICK.find((x) => x[1] === code);
    ui.nf.value = q ? q[0] : 'Custom';
  }

  A.onSelectionChange = sync;
  A.onThemeChange = refreshThemeUI;
  A.onContextMenu = contextMenu;
  A.openFormatCells = openFormatCells;

  /* ---------- Excel shortcuts ---------- */

  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body && e.target.id !== 'grid-wrap') return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const key = e.key;
    if (key === '1') {
      e.preventDefault();
      openFormatCells();
    } else if (key === 'u' || key === 'U') {
      e.preventDefault();
      A.toggleFlag('u');
    } else if (key === '5') {
      e.preventDefault();
      A.toggleFlag('s');
    } else if (e.shiftKey) {
      const map = { $: '$#,##0.00_);($#,##0.00)', '%': '0%', '!': '#,##0.00', '#': 'd-mmm-yy', '@': 'h:mm AM/PM', '^': '0.00E+00', '~': 'General' };
      if (map[key]) {
        e.preventDefault();
        setNumberFormat(map[key]);
      } else if (key === '&') {
        e.preventDefault();
        borders({ t: THIN, b: THIN, l: THIN, r: THIN });
      } else if (key === '_') {
        e.preventDefault();
        borders({ t: null, b: null, l: null, r: null, h: null, v: null });
      }
    }
  });

  build();
  refreshThemeUI();
  sync();

  window.TallyFormatUI = { openFormatCells, showMenu, closeMenu };
})();
