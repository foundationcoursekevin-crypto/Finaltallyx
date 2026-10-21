/*
 * Tally charts: draws bar, line and pie charts onto a <canvas>.
 * Colors and fonts come from the CSS variables in styles.css.
 */
(function () {
  'use strict';

  let PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
  const colorAt = (i) => (i < PALETTE.length ? PALETTE[i] : 'hsl(' + ((i * 47) % 360) + ' 55% 50%)');

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  function niceNum(x, round) {
    const exp = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }

  function ticks(min, max, target) {
    if (min === max) {
      if (min === 0) max = 1;
      else {
        const d = Math.abs(min) * 0.1;
        min -= d;
        max += d;
      }
    }
    const range = niceNum(max - min, false);
    const step = niceNum(range / (target - 1), true);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const n = Math.round((hi - lo) / step);
    const out = [];
    for (let i = 0; i <= n; i++) out.push(+(lo + i * step).toFixed(12));
    return out;
  }

  function fit(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function message(ctx, w, h, text) {
    ctx.fillStyle = css('--ink-muted');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }

  function legendLayout(ctx, items, w) {
    const lines = [[]];
    let x = 0;
    const maxW = w - 24;
    for (const it of items) {
      const iw = 14 + ctx.measureText(it.text).width + 14;
      if (x + iw > maxW && lines[lines.length - 1].length) {
        lines.push([]);
        x = 0;
      }
      lines[lines.length - 1].push({ it, x, w: iw });
      x += iw;
    }
    return lines;
  }

  function drawLegend(ctx, lines, w, top) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, li) => {
      const total = line.reduce((s, e) => s + e.w, 0) - 14;
      let x0 = Math.max(12, (w - total) / 2);
      const y = top + li * 16 + 8;
      for (const e of line) {
        ctx.fillStyle = e.it.color;
        ctx.fillRect(x0 + e.x - line[0].x, y - 4, 8, 8);
        ctx.fillStyle = css('--ink');
        ctx.fillText(e.it.text, x0 + e.x - line[0].x + 12, y);
      }
    });
  }

  function draw(canvas, data, type) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px ' + css('--font');

    const mute = css('--ink-muted');
    const grid = css('--line');
    const paper = css('--paper');

    if (!data || !data.series.length) {
      message(ctx, w, h, 'Select cells that contain numbers');
      return;
    }

    /* ----- pie ----- */
    if (type === 'pie') {
      const vals = data.series[0].values.map((v) => (v !== null && v > 0 ? v : 0));
      const total = vals.reduce((a, b) => a + b, 0);
      if (total <= 0) {
        message(ctx, w, h, 'Pie charts need positive numbers');
        return;
      }
      const items = data.cats.map((c, i) => ({
        text: c + ' ' + Math.round((vals[i] / total) * 100) + '%',
        color: colorAt(i)
      }));
      const lines = legendLayout(ctx, items, w);
      const legendH = lines.length * 16 + 6;
      const cx = w / 2;
      const cy = (h - legendH) / 2 + 2;
      const rad = Math.max(10, Math.min(w - 24, h - legendH - 16) / 2);
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        if (v <= 0) return;
        const a1 = a0 + (v / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, rad, a0, a1);
        ctx.closePath();
        ctx.fillStyle = colorAt(i);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = paper;
        ctx.stroke();
        a0 = a1;
      });
      drawLegend(ctx, lines, w, h - legendH);
      return;
    }

    /* ----- bar & line ----- */
    const showLegend = data.series.length > 1;
    const lines = showLegend ? legendLayout(ctx, data.series.map((s, i) => ({ text: s.name, color: colorAt(i) })), w) : [];
    const legendH = showLegend ? lines.length * 16 + 6 : 0;

    let min = Infinity;
    let max = -Infinity;
    for (const s of data.series) {
      for (const v of s.values) {
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (type === 'bar') {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    const tk = ticks(min, max, 5);
    const lo = tk[0];
    const hi = tk[tk.length - 1];
    const labelW = Math.max.apply(null, tk.map((t) => ctx.measureText(compact.format(t)).width));

    const plot = { l: Math.ceil(labelW) + 18, t: 10, r: w - 12, b: h - legendH - 24 };
    const pw = plot.r - plot.l;
    const ph = plot.b - plot.t;
    if (pw < 20 || ph < 20) return;
    const yOf = (v) => plot.b - ((v - lo) / (hi - lo)) * ph;

    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of tk) {
      const y = Math.round(yOf(t)) + 0.5;
      ctx.strokeStyle = t === 0 ? mute : grid;
      ctx.beginPath();
      ctx.moveTo(plot.l, y);
      ctx.lineTo(plot.r, y);
      ctx.stroke();
      ctx.fillStyle = mute;
      ctx.fillText(compact.format(t), plot.l - 6, y);
    }

    const n = data.cats.length;
    const catW = pw / n;
    // Skip category labels that would collide.
    const maxLabel = Math.max.apply(null, data.cats.map((c) => Math.min(ctx.measureText(c).width, 80)));
    const every = Math.max(1, Math.ceil((maxLabel + 8) / catW));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = mute;
    data.cats.forEach((c, i) => {
      if (i % every) return;
      ctx.fillText(fit(ctx, c, Math.min(catW * every - 6, 90)), plot.l + (i + 0.5) * catW, plot.b + 6);
    });

    if (type === 'bar') {
      const ns = data.series.length;
      const groupW = Math.min(catW * 0.78, ns * 44);
      const barW = groupW / ns;
      const y0 = yOf(0);
      data.series.forEach((s, si) => {
        ctx.fillStyle = colorAt(si);
        s.values.forEach((v, i) => {
          if (v === null) return;
          const x = plot.l + i * catW + (catW - groupW) / 2 + si * barW;
          const y = yOf(v);
          ctx.fillRect(x + 0.5, Math.min(y, y0), Math.max(1, barW - 1), Math.abs(y0 - y));
        });
      });
    } else {
      data.series.forEach((s, si) => {
        const color = colorAt(si);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null) {
            pen = false;
            return;
          }
          const x = plot.l + (i + 0.5) * catW;
          const y = yOf(v);
          if (pen) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          pen = true;
        });
        ctx.stroke();
        ctx.fillStyle = color;
        s.values.forEach((v, i) => {
          if (v === null) return;
          ctx.beginPath();
          ctx.arc(plot.l + (i + 0.5) * catW, yOf(v), 3, 0, Math.PI * 2);
          ctx.fill();
        });
      });
    }

    if (showLegend) drawLegend(ctx, lines, w, h - legendH);
  }

  window.TallyCharts = {
    draw,
    setPalette: (p) => {
      if (p && p.length) PALETTE = p.slice();
    }
  };
})();
