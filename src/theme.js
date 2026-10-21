/*
 * Tally workbook themes, modeled on Excel's: a color set (10 colors in Excel's order)
 * plus a font set (headings and body). Cells can store theme color references like
 * "t:4:0.4" (accent 1, lighter 40%) so changing the theme recolors them.
 * Pure logic, no DOM. The theme values are approximations of Excel's built-in themes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TallyTheme = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Order matches Excel's palette columns:
  // 0 Background 1, 1 Text 1, 2 Background 2, 3 Text 2, 4-9 Accent 1-6
  const COLOR_SETS = [
    { name: 'Tally', c: ['#ffffff', '#1b1a3a', '#f1effb', '#2d2b66', '#4b33e8', '#ffb400', '#12a594', '#e5484d', '#3b8eea', '#8b5cf6'] },
    { name: 'Office', c: ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'] },
    { name: 'Office 2007–2010', c: ['#ffffff', '#000000', '#eeece1', '#1f497d', '#4f81bd', '#c0504d', '#9bbb59', '#8064a2', '#4bacc6', '#f79646'] },
    { name: 'Facet', c: ['#ffffff', '#000000', '#eeeeee', '#2c3c43', '#90c226', '#54a021', '#e6b91e', '#e76618', '#c42f1a', '#918655'] },
    { name: 'Integral', c: ['#ffffff', '#000000', '#dfe3e5', '#335b74', '#1cade4', '#2683c6', '#27ced7', '#42ba97', '#3e8853', '#62a39f'] },
    { name: 'Ion', c: ['#ffffff', '#000000', '#e9eceb', '#1e5155', '#b01513', '#ea6312', '#e6b729', '#6aac90', '#54849a', '#9e5e9b'] },
    { name: 'Ion Boardroom', c: ['#ffffff', '#000000', '#dadada', '#3e3d2d', '#b31166', '#e33d6f', '#e45f3c', '#e9943a', '#9b6bf2', '#d53dd0'] },
    { name: 'Organic', c: ['#ffffff', '#000000', '#dcd9c8', '#212121', '#83992a', '#3c9770', '#44709d', '#a23c33', '#d97828', '#deb340'] },
    { name: 'Retrospect', c: ['#ffffff', '#000000', '#ccdde2', '#637052', '#e48312', '#bd582c', '#865640', '#9b8357', '#c2bc80', '#94a088'] },
    { name: 'Slice', c: ['#ffffff', '#000000', '#a7bfde', '#052f61', '#052f61', '#a50e82', '#14967c', '#6a9e1f', '#e87d37', '#c62324'] },
    { name: 'Wisp', c: ['#ffffff', '#000000', '#fbeec9', '#4e3b30', '#a53010', '#de7e18', '#9f8351', '#728653', '#92aa4c', '#6aac91'] },
    { name: 'Blue', c: ['#ffffff', '#000000', '#dbf5f9', '#17406d', '#0f6fc6', '#009dd9', '#0bd0d9', '#10cf9b', '#7cca62', '#a5c249'] },
    { name: 'Green', c: ['#ffffff', '#000000', '#e3ded1', '#455f51', '#549e39', '#8ab833', '#c0cf3a', '#029676', '#4ab5c4', '#0989b1'] },
    { name: 'Orange', c: ['#ffffff', '#000000', '#f6efe6', '#4d3b2c', '#f09415', '#c1b56b', '#4baf73', '#5aa6c0', '#d17df9', '#fa7e5c'] },
    { name: 'Violet', c: ['#ffffff', '#000000', '#e4d9ed', '#632e62', '#92278f', '#9b57d3', '#755dd9', '#665eb8', '#45a5ed', '#5982db'] },
    { name: 'Grayscale', c: ['#ffffff', '#000000', '#e6e6e6', '#3f3f3f', '#dddddd', '#b2b2b2', '#969696', '#808080', '#5f5f5f', '#4d4d4d'] }
  ];

  const FONT_SETS = [
    { name: 'Tally', heading: 'Bahnschrift SemiBold', body: 'Bahnschrift' },
    { name: 'Office', heading: 'Calibri Light', body: 'Calibri' },
    { name: 'Office 2007–2010', heading: 'Cambria', body: 'Calibri' },
    { name: 'Arial', heading: 'Arial', body: 'Arial' },
    { name: 'Cambria', heading: 'Cambria', body: 'Cambria' },
    { name: 'Century Gothic', heading: 'Century Gothic', body: 'Century Gothic' },
    { name: 'Corbel', heading: 'Corbel', body: 'Corbel' },
    { name: 'Georgia – Trebuchet', heading: 'Georgia', body: 'Trebuchet MS' },
    { name: 'Segoe UI', heading: 'Segoe UI Semibold', body: 'Segoe UI' },
    { name: 'Tahoma', heading: 'Tahoma', body: 'Tahoma' },
    { name: 'Times New Roman', heading: 'Times New Roman', body: 'Times New Roman' },
    { name: 'Trebuchet MS', heading: 'Trebuchet MS', body: 'Trebuchet MS' },
    { name: 'Verdana', heading: 'Verdana', body: 'Verdana' }
  ];

  const THEMES = [
    { name: 'Tally', colors: 'Tally', fonts: 'Tally' },
    { name: 'Office', colors: 'Office', fonts: 'Office' },
    { name: 'Office 2007–2010', colors: 'Office 2007–2010', fonts: 'Office 2007–2010' },
    { name: 'Facet', colors: 'Facet', fonts: 'Trebuchet MS' },
    { name: 'Integral', colors: 'Integral', fonts: 'Tahoma' },
    { name: 'Ion', colors: 'Ion', fonts: 'Century Gothic' },
    { name: 'Ion Boardroom', colors: 'Ion Boardroom', fonts: 'Century Gothic' },
    { name: 'Organic', colors: 'Organic', fonts: 'Georgia – Trebuchet' },
    { name: 'Retrospect', colors: 'Retrospect', fonts: 'Office' },
    { name: 'Slice', colors: 'Slice', fonts: 'Corbel' },
    { name: 'Wisp', colors: 'Wisp', fonts: 'Century Gothic' }
  ];

  const DEFAULT = { colors: 'Tally', fonts: 'Tally' };

  const colorSet = (name) => COLOR_SETS.find((s) => s.name === name) || COLOR_SETS.find((s) => s.name === DEFAULT.colors);
  const fontSet = (name) => FONT_SETS.find((s) => s.name === name) || FONT_SETS.find((s) => s.name === DEFAULT.fonts);
  const hasColors = (name) => COLOR_SETS.some((s) => s.name === name);
  const hasFonts = (name) => FONT_SETS.some((s) => s.name === name);

  // t > 0 mixes toward white, t < 0 toward black.
  function tintHex(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const target = t > 0 ? 255 : 0;
    const a = Math.min(1, Math.abs(t));
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (target - x) * a));
    return '#' + ch.map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // The five shades Excel shows under each theme color, top to bottom.
  function tintsFor(idx) {
    if (idx === 0) return [-0.05, -0.15, -0.25, -0.35, -0.5];
    if (idx === 1) return [0.5, 0.35, 0.25, 0.15, 0.05];
    return [0.8, 0.6, 0.4, -0.25, -0.5];
  }

  const REF = /^t:([0-9]):(-?\d*\.?\d+)$/;

  const ref = (idx, tint) => 't:' + idx + ':' + (tint || 0);
  const isRef = (c) => typeof c === 'string' && REF.test(c);

  // A stored color is a hex string or a theme reference; returns a CSS color.
  function resolve(c, colors) {
    if (!c) return '';
    const m = REF.exec(c);
    if (!m) return c;
    const base = colors[+m[1]];
    if (!base) return '';
    const t = parseFloat(m[2]);
    return t ? tintHex(base, t) : base;
  }

  function resolveFont(f, fonts) {
    if (f === 'theme:heading') return fonts.heading;
    if (f === 'theme:body') return fonts.body;
    return f;
  }

  return { COLOR_SETS, FONT_SETS, THEMES, DEFAULT, colorSet, fontSet, hasColors, hasFonts, tintHex, tintsFor, ref, isRef, resolve, resolveFont };
});
