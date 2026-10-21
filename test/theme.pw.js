// Headless test for the ribbon and workbook themes.
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));

  const td = (k) => page.locator(`#grid td[data-r="${+k.slice(1) - 1}"][data-c="${k.charCodeAt(0) - 65}"]`);
  const style = (k, prop) => td(k).evaluate((e, p) => e.style[p], prop);
  const jump = async (ref) => { await page.click('#namebox'); await page.fill('#namebox', ref); await page.keyboard.press('Enter'); };
  const put = async (ref, val) => { await jump(ref); await page.keyboard.type(val); await page.keyboard.press('Enter'); };
  const tab = (name) => page.click(`.rtab:has-text("${name}")`);
  const menuItem = (label) => page.click(`.menu button.item:has-text("${label}")`);

  // ----- ribbon tabs -----
  const names = await page.$$eval('.rtab', (b) => b.map((x) => x.textContent));
  assert.deepStrictEqual(names, ['Format', 'Insert', 'Look', 'Formulas', 'View']);
  assert.strictEqual(await page.isVisible('#btn-bold'), true, 'Home is open first');
  await tab('Insert');
  assert.strictEqual(await page.isVisible('#btn-bold'), false, 'Home hidden');
  assert.strictEqual(await page.isVisible('#btn-chartPie'), true);
  await tab('Format');
  await page.focus('.rtab[aria-selected=true]');
  await page.keyboard.press('ArrowRight');
  assert.strictEqual(await page.getAttribute('.rtab:has-text("Insert")', 'aria-selected'), 'true', 'arrow keys move between tabs');
  await tab('Format');

  // ----- theme colors follow the theme -----
  await put('B2', 'Accent');
  await jump('B2');
  await page.click('#btn-fillCaret');
  await page.click('.palette .pgrid .sw >> nth=4');           // Accent 1
  assert.strictEqual(await page.evaluate(() => window.TallyApp.fmts.get('B2').bg), 't:4:0', 'stored as a theme reference');
  assert.strictEqual(await style('B2', 'backgroundColor'), 'rgb(68, 114, 196)', 'Office accent 1');
  await page.click('#btn-textCaret');
  await page.click('.palette .pgrid .sw >> nth=24');          // Accent 1 lighter-ish row
  await page.keyboard.press('Escape');

  await tab('Look');
  await page.click('#btn-themes');
  await page.click('.themecard:has-text("Ion")');
  assert.strictEqual(await style('B2', 'backgroundColor'), 'rgb(176, 21, 19)', 'cell recolored by the new theme');
  assert.deepStrictEqual(await page.evaluate(() => ({ c: TallyApp.theme.colors, f: TallyApp.theme.fonts })), { c: 'Ion', f: 'Century Gothic' });
  assert.ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cell-font'))).includes('Century Gothic'));

  await page.click('#btn-themeColors');
  await menuItem('Green');
  assert.strictEqual(await style('B2', 'backgroundColor'), 'rgb(84, 158, 57)', 'Green accent 1');
  await page.click('#btn-themeFonts');
  await menuItem('Georgia / Trebuchet MS');
  assert.ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cell-font'))).includes('Trebuchet MS'));

  // undo steps back through the three theme changes
  await page.click('#btn-undo'); await page.click('#btn-undo');
  assert.strictEqual(await style('B2', 'backgroundColor'), 'rgb(176, 21, 19)');
  await page.click('#btn-undo');
  assert.strictEqual(await style('B2', 'backgroundColor'), 'rgb(68, 114, 196)');
  await page.click('#btn-redo');

  // heading font style resolves through the theme
  await tab('Format');
  await put('D2', 'Heading');
  await jump('D2');
  await page.click('#btn-styles');
  await page.click('.styles-grid button:has-text("Heading 1")');
  assert.ok((await style('D2', 'fontFamily')).length > 0 && (await style('D2', 'borderBottom')).includes('3px'), 'heading style');
  const before = await style('D2', 'borderBottomColor');
  await tab('Look');
  await page.click('#btn-themes');
  await page.click('.themecard:has-text("Retrospect")');
  assert.notStrictEqual(await style('D2', 'borderBottomColor'), before, 'heading border follows the theme');
  assert.ok((await style('D2', 'fontFamily')).includes('Calibri Light'), 'heading font from theme: ' + (await style('D2', 'fontFamily')));

  // font select shows theme names
  await tab('Format');
  const opts = await page.$$eval('#sel-font option', (o) => o.slice(0, 2).map((x) => x.textContent));
  assert.deepStrictEqual(opts, ['Calibri (Body)', 'Calibri Light (Headings)']);

  // chart colors come from the theme
  for (let i = 1; i <= 3; i++) await put('G' + i, String(i * 10));
  await jump('G1');
  await tab('Insert');
  await page.click('#btn-chartLine');
  assert.strictEqual(await page.evaluate(() => TallyApp && window.__tally.charts[0].type), 'line');
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/tally-ribbon-insert.png' });

  // ----- View tab -----
  await tab('View');
  await page.uncheck('#rp-view input[data-view=grid]');
  assert.ok(await page.evaluate(() => document.getElementById('grid').classList.contains('no-grid')));
  await page.uncheck('#rp-view input[data-view=heads]');
  assert.strictEqual(await page.isVisible('#grid th.ch >> nth=0'), false, 'headings hidden');
  await page.uncheck('#rp-view input[data-view=formula]');
  assert.strictEqual(await page.isVisible('#formulabar'), false);
  await page.screenshot({ path: '/tmp/tally-view-off.png' });
  await page.check('#rp-view input[data-view=grid]');
  await page.check('#rp-view input[data-view=heads]');
  await page.check('#rp-view input[data-view=formula]');
  assert.strictEqual(await page.isVisible('#formulabar'), true);
  await page.click('#btn-chartsPanel');
  assert.strictEqual(await page.isVisible('#charts'), false, 'charts panel toggled');

  // ----- Formulas tab -----
  await tab('Formulas');
  await jump('H1');
  await page.click('#btn-fnSUM');
  assert.strictEqual(await page.inputValue('#editor'), '=SUM(');
  await page.keyboard.press('Escape');
  await jump('G4');
  await page.click('#btn-fnAutosum');
  assert.strictEqual(await page.evaluate(() => TallyApp.sheet.getRaw('G4')), '=SUM(G1:G3)', 'AutoSum finds the numbers above');
  await jump('G1:G3');
  await tab('Format');
  await page.click('#btn-autosum');
  assert.strictEqual(await page.evaluate(() => TallyApp.sheet.getRaw('G4')), '=SUM(G1:G3)');

  // ----- persistence -----
  const rt = await page.evaluate(() => {
    const s = window.__tally.serialize();
    window.__tally.loadTally(s, '/tmp/t.tally');
    return { c: TallyApp.theme.colors, f: TallyApp.theme.fonts, v: JSON.parse(s).version };
  });
  assert.deepStrictEqual(rt, { c: 'Retrospect', f: 'Office', v: 3 });
  assert.strictEqual(await style('B2', 'backgroundColor'), 'rgb(228, 131, 18)', 'Retrospect accent 1 after reload');
  // a file with an unknown theme falls back to Office
  await page.evaluate(() => {
    const o = JSON.parse(window.__tally.serialize());
    o.theme = { colors: 'Nope', fonts: 'Nope' };
    window.__tally.loadTally(JSON.stringify(o), null);
  });
  assert.strictEqual(await page.evaluate(() => TallyApp.theme.colors), 'Office');

  await tab('Look');
  await page.click('#btn-themes');
  await page.screenshot({ path: '/tmp/tally-ribbon-themes.png' });
  await page.keyboard.press('Escape');
  await tab('Format');
  await page.screenshot({ path: '/tmp/tally-ribbon-home.png' });

  assert.deepStrictEqual(errors, [], 'no console errors');
  console.log('Theme and ribbon test passed');
  await browser.close();
})().catch((e) => { console.error('THEME TEST FAILED:', e.message, (e.stack || '').split('\n').filter((l) => l.includes('theme.pw')).slice(0, 1).join('')); process.exit(1); });
