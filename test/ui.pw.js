// Headless UI smoke test (runs the real index.html in Chromium; the Electron bridge is stubbed).
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '../src/index.html'));

  const cell = (k) => page.locator(`#grid td[data-r="${+k.slice(1) - 1}"][data-c="${k.charCodeAt(0) - 65}"]`);
  const text = async (k) => (await cell(k).textContent());
  const type = async (s) => { await page.keyboard.type(s); await page.keyboard.press('Enter'); };

  // typing + formulas
  await cell('A1').click();
  await type('10'); await type('20'); await type('=SUM(A1:A2)');
  assert.strictEqual(await text('A3'), '30', 'SUM');
  assert.strictEqual(await page.inputValue('#namebox'), 'A4', 'cursor moved down');

  // recalculation
  await cell('A1').click();
  await type('15');
  assert.strictEqual(await text('A3'), '35', 'recalc');

  // formula bar shows raw
  await cell('A3').click();
  assert.strictEqual(await page.inputValue('#bar'), '=SUM(A1:A2)');

  // bold via shortcut + undo
  await page.keyboard.press('Control+b');
  assert.strictEqual(await cell('A3').evaluate((e) => getComputedStyle(e).fontWeight), '700', 'bold');
  await page.click('#btn-undo');
  assert.notStrictEqual(await cell('A3').evaluate((e) => getComputedStyle(e).fontWeight), '700', 'undo bold');
  await page.click('#btn-redo');
  assert.strictEqual(await cell('A3').evaluate((e) => getComputedStyle(e).fontWeight), '700', 'redo bold');

  // number format
  await page.selectOption('#sel-nf', 'Currency');
  assert.strictEqual(await text('A3'), '$35.00', 'currency');

  // point mode: click cells while building a formula
  await cell('C1').click();
  await page.keyboard.type('=');
  await cell('A1').click();
  await page.keyboard.type('*2');
  await page.keyboard.press('Enter');
  assert.strictEqual(await text('C1'), '30', 'point mode result');
  await cell('C1').click();
  assert.strictEqual(await page.inputValue('#bar'), '=A1*2', 'point mode text');

  // drag selection + status bar aggregates
  await cell('A1').hover();
  await page.mouse.down();
  await cell('A2').hover();
  await page.mouse.up();
  assert.strictEqual(await page.inputValue('#namebox'), 'A1:A2');
  const agg = await page.textContent('#status-agg');
  assert.ok(/Sum 35/.test(agg) && /Count 2/.test(agg) && /Average 17.5/.test(agg), 'aggregates: ' + agg);

  // copy/paste formula keeps relative refs
  await cell('A3').click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    window.__dt = dt;
  });
  await cell('B3').click();
  await page.evaluate(() => {
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: window.__dt, bubbles: true, cancelable: true }));
  });
  assert.strictEqual(await page.evaluate(() => window.__tally.sheet.getRaw('B3')), '=SUM(B1:B2)', 'paste shifts refs');

  // fill down (Ctrl+D)
  await cell('C1').click();
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.up('Shift');
  await page.keyboard.press('Control+d');
  assert.strictEqual(await page.evaluate(() => window.__tally.sheet.getRaw('C3')), '=A3*2', 'fill down');

  // delete clears
  await cell('C3').click();
  await page.keyboard.press('Delete');
  assert.strictEqual(await text('C3'), '', 'delete');

  // Ctrl+Arrow jumps to edge of data
  await cell('A1').click();
  await page.keyboard.press('Control+ArrowDown');
  assert.strictEqual(await page.inputValue('#namebox'), 'A3', 'ctrl+down');
  await page.keyboard.press('Control+ArrowDown');
  assert.strictEqual(await page.inputValue('#namebox'), 'A200', 'ctrl+down again');
  await page.keyboard.press('Control+Home');

  // errors render
  await cell('E1').click();
  await type('=1/0');
  assert.strictEqual(await text('E1'), '#DIV/0!');
  assert.strictEqual(await cell('E1').getAttribute('class'), 'error');

  // named jump
  await page.click('#namebox');
  await page.fill('#namebox', 'D10');
  await page.keyboard.press('Enter');
  assert.strictEqual(await page.inputValue('#namebox'), 'D10');

  // chart from a data block
  await cell('G1').click();
  await page.evaluate(() => {
    const rows = [['Month', 'Sales', 'Cost'], ['Jan', '120', '80'], ['Feb', '150', '90'], ['Mar', '90', '70'], ['Apr', '200', '110']];
    rows.forEach((row, i) => row.forEach((v, j) => window.__tally.sheet.setRaw(String.fromCharCode(71 + j) + (i + 1), v)));
  });
  await cell('G1').click();            // single cell inside the block -> current region
  await page.click('.rtab:has-text("Insert")');
  await page.click('#btn-chart');
  await page.waitForTimeout(200);
  const painted = await page.evaluate(() => {
    const c = document.querySelector('.chart-card canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  assert.ok(painted > 2000, 'bar chart painted pixels: ' + painted);
  assert.strictEqual(await page.evaluate(() => window.__tally.charts.length), 1);
  assert.strictEqual(await page.evaluate(() => window.__tally.charts[0].range.c2), 8, 'chart range G1:I5');
  await page.screenshot({ path: '/tmp/tally-chart.png' });
  await page.click('.chart-card .seg button:nth-child(2)'); // line
  await page.waitForTimeout(150);
  await page.click('.chart-card .seg button:nth-child(3)'); // pie
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/tally-pie.png' });

  // serialize / load round trip
  const roundTrip = await page.evaluate(() => {
    const s = window.__tally.serialize();
    window.__tally.loadTally(s, '/tmp/x.tally');
    return { b3: window.__tally.sheet.getRaw('B3'), charts: window.__tally.charts.length, title: document.title, boldA3: !!(window.__tally.fmts.get('A3') || {}).b };
  });
  assert.strictEqual(roundTrip.b3, '=SUM(B1:B2)');
  assert.strictEqual(roundTrip.charts, 1);
  assert.strictEqual(roundTrip.boldA3, true);
  assert.ok(roundTrip.title.startsWith('x.tally'), 'title ' + roundTrip.title);

  await page.screenshot({ path: '/tmp/tally-final.png' });

  assert.deepStrictEqual(errors, [], 'no console errors');
  console.log('UI smoke test passed');
  await browser.close();
})().catch((e) => { console.error('UI TEST FAILED:', e.message); process.exit(1); });
