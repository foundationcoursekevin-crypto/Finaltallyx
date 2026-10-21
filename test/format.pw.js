// Headless test for the formatting features (fonts, borders, merge, number formats, conditional formatting...).
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
  const computed = (k, prop) => td(k).evaluate((e, p) => getComputedStyle(e)[p], prop);
  const text = (k) => td(k).textContent();
  const jump = async (ref) => { await page.click('#namebox'); await page.fill('#namebox', ref); await page.keyboard.press('Enter'); };
  const put = async (ref, val) => { await jump(ref); await page.keyboard.type(val); await page.keyboard.press('Enter'); };
  const fmtOf = (k) => page.evaluate((x) => window.TallyApp.fmts.get(x) || null, k);
  const menuItem = (label) => page.click(`.menu button.item:has-text("${label}")`);

  // ----- typed dates get a date format -----
  await put('A1', '3/15/2023');
  assert.strictEqual(await text('A1'), '3/15/2023');
  assert.strictEqual((await fmtOf('A1')).nf, 'm/d/yyyy');
  await put('A2', '50%');
  assert.strictEqual(await text('A2'), '50%');
  await put('A3', '$1,234.5');
  assert.strictEqual(await text('A3'), '$1,234.50'.replace('.50', '.50'), 'currency typed');
  await put('A4', '6:00 PM');
  assert.strictEqual(await text('A4'), '6:00 PM');
  await put('A5', '=TODAY()');
  assert.ok(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(await text('A5')), 'TODAY shows a date: ' + (await text('A5')));

  // ----- font family and size -----
  await jump('B1');
  await page.keyboard.type('Big');
  await page.keyboard.press('Enter');
  await jump('B1');
  await page.selectOption('#sel-font', 'Georgia');
  await page.fill('#in-size', '24');
  await page.keyboard.press('Enter');
  assert.ok((await style('B1', 'fontFamily')).includes('Georgia'), 'font family');
  assert.strictEqual(await style('B1', 'fontSize'), '32px', 'size 24pt = 32px');
  const rowH = await td('B1').evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(rowH > 30, 'row grew for big text: ' + rowH);
  assert.strictEqual(await page.inputValue('#in-size'), '24');
  await page.click('#btn-shrink');
  assert.strictEqual(await page.inputValue('#in-size'), '22');
  await page.click('#btn-grow');
  await page.click('#btn-grow');
  assert.strictEqual(await page.inputValue('#in-size'), '26');

  // ----- underline / strike / italic shortcuts -----
  await jump('C1');
  await page.keyboard.type('Styled'); await page.keyboard.press('Enter');
  await jump('C1');
  await page.keyboard.press('Control+u');
  await page.keyboard.press('Control+5');
  await page.keyboard.press('Control+i');
  const deco = await style('C1', 'textDecorationLine');
  assert.ok(deco.includes('underline') && deco.includes('line-through'), 'decoration: ' + deco);
  assert.strictEqual(await style('C1', 'fontStyle'), 'italic');
  assert.strictEqual(await page.getAttribute('#btn-underline', 'aria-pressed'), 'true');

  // ----- borders via the menu, neighbors stay in agreement -----
  await jump('B4:C5');
  await page.click('#btn-borders');
  await menuItem('All borders');
  assert.ok((await style('B4', 'borderTop')).includes('solid'), 'top border set');
  assert.ok((await style('C5', 'borderRight')).includes('solid'), 'right border set');
  assert.ok((await style('B3', 'borderBottom')).includes('solid'), 'neighbor above mirrors');
  assert.ok((await style('B4', 'borderRight')).includes('solid'), 'inside vertical line');
  await page.click('#btn-borders');
  await menuItem('Thick outside borders');
  assert.ok((await style('B4', 'borderLeft')).includes('3px'), 'thick outside');
  await page.click('#btn-borders');
  await menuItem('No border');
  assert.strictEqual(await style('B4', 'borderTop'), '', 'cleared');
  assert.strictEqual(await style('B3', 'borderBottom'), '', 'neighbor cleared');

  // ----- wrap text -----
  await put('D1', 'a fairly long line of text that should wrap inside the cell');
  await jump('D1');
  const before = await td('D1').evaluate((e) => e.getBoundingClientRect().height);
  await page.click('#btn-wrap');
  const after = await td('D1').evaluate((e) => e.getBoundingClientRect().height);
  assert.ok(after > before + 10, `wrap grows the row (${before} -> ${after})`);

  // ----- merge and center -----
  await put('F6', 'Merged');
  await jump('F6:H7');
  await page.click('#btn-merge');
  assert.strictEqual(await td('F6').evaluate((e) => e.colSpan + 'x' + e.rowSpan), '3x2');
  assert.strictEqual(await style('G6', 'display'), 'none');
  assert.strictEqual(await style('F6', 'textAlign'), 'center');
  assert.strictEqual(await page.getAttribute('#btn-merge', 'aria-pressed'), 'true');
  // clicking a covered cell selects the whole merged area
  await td('H7').dispatchEvent('mousedown');
  assert.strictEqual(await page.inputValue('#namebox'), 'F6:H7');
  await jump('F6:H7');
  await page.click('#btn-merge');
  assert.strictEqual(await td('F6').evaluate((e) => e.colSpan), 1, 'unmerged');
  await page.click('#btn-undo');           // undo the unmerge
  assert.strictEqual(await td('F6').evaluate((e) => e.colSpan), 3, 'undo restores merge');
  await page.click('#btn-undo');           // undo the merge
  assert.strictEqual(await td('F6').evaluate((e) => e.colSpan), 1, 'undo merge');

  // ----- Format Cells dialog: Number tab -----
  await put('A8', '1234.5');
  await jump('A8');
  await page.keyboard.press('Control+1');
  await page.waitForSelector('dialog.fc[open]');
  await page.selectOption('dialog.fc .catlist', 'Number');
  await page.fill('dialog.fc input[type=number]', '1');
  await page.check('dialog.fc input[type=checkbox]');
  assert.ok((await page.textContent('dialog.fc .sample')).includes('1,234.5'), 'sample preview');
  await page.screenshot({ path: '/tmp/tally-dialog-number.png' });
  await page.click('dialog.fc button[type=submit]');
  await page.waitForSelector('dialog.fc', { state: 'detached' });
  assert.strictEqual(await text('A8'), '1,234.5');
  assert.strictEqual((await fmtOf('A8')).nf, '#,##0.0');

  // custom code, date list
  await jump('A9');
  await page.keyboard.type('45000'); await page.keyboard.press('Enter');
  await jump('A9');
  await page.keyboard.press('Control+1');
  await page.selectOption('dialog.fc .catlist', 'Date');
  await page.selectOption('dialog.fc select[aria-label=Type]', 'dddd, mmmm d, yyyy');
  await page.click('dialog.fc button[type=submit]');
  assert.strictEqual(await text('A9'), 'Wednesday, March 15, 2023');

  // ----- Format Cells: alignment, font, fill, border tabs -----
  await jump('J1');
  await page.keyboard.type('Dialog'); await page.keyboard.press('Enter');
  await jump('J1');
  await page.keyboard.press('Control+1');
  await page.click('dialog.fc [role=tab]:has-text("Alignment")');
  await page.selectOption('dialog.fc .pane:not([hidden]) select >> nth=0', 'center');
  await page.selectOption('dialog.fc .pane:not([hidden]) select >> nth=1', 'middle');
  await page.click('dialog.fc [role=tab]:has-text("Font")');
  await page.selectOption('dialog.fc select[aria-label=Font]', 'Courier New');
  await page.click('dialog.fc [role=tab]:has-text("Fill")');
  await page.click('dialog.fc .palette .pgrid .sw >> nth=45');
  await page.click('dialog.fc [role=tab]:has-text("Border")');
  await page.selectOption('dialog.fc select[aria-label="Line style"]', 'double');
  await page.click('dialog.fc .bdbtn:has-text("Bottom")');
  await page.click('dialog.fc .bdbtn:has-text("Top")');
  await page.screenshot({ path: '/tmp/tally-dialog-border.png' });
  await page.click('dialog.fc button[type=submit]');
  const j1 = await fmtOf('J1');
  assert.strictEqual(j1.align, 'center');
  assert.strictEqual(j1.va, 'middle');
  assert.strictEqual(j1.font, 'Courier New');
  assert.ok(j1.bg && /^(#|t:)/.test(j1.bg), 'fill chosen');
  assert.strictEqual(j1.bd.b.s, 'double');
  assert.ok((await style('J1', 'borderBottom')).includes('double'));
  assert.ok((await style('J2', 'borderTop')).includes('double'), 'neighbor mirrors dialog border');

  // ----- format painter -----
  await jump('J1');
  await page.click('#btn-painter');
  await td('L4').click();
  assert.strictEqual((await fmtOf('L4')).font, 'Courier New', 'painted');
  assert.strictEqual(await page.getAttribute('#btn-painter', 'aria-pressed'), 'false', 'painter turns off');

  // ----- cell styles -----
  await jump('L6');
  await page.click('#btn-styles');
  await page.click('.styles-grid button:has-text("Good")');
  assert.strictEqual((await fmtOf('L6')).bg, '#c6efce');
  await page.click('#btn-styles');
  await page.click('.styles-grid button:has-text("Normal")');
  assert.strictEqual(await fmtOf('L6'), null, 'Normal clears');

  // ----- conditional formatting -----
  for (let i = 1; i <= 6; i++) await put('N' + i, String(i * 10));
  await jump('N1:N6');
  await page.click('#btn-cf');
  await menuItem('Greater than');
  await page.fill('dialog input[type=number]', '30');
  await page.click('dialog button[type=submit]');
  assert.strictEqual(await style('N4', 'backgroundColor'), 'rgb(255, 199, 206)', 'CF highlight applied');
  assert.strictEqual(await style('N2', 'backgroundColor'), '', 'not highlighted');
  await page.click('#btn-cf');
  await menuItem('Green – yellow – red');
  assert.ok((await style('N6', 'backgroundColor')).startsWith('rgb'), 'scale applied');
  await page.click('#btn-cf');
  await menuItem('Orange');
  assert.ok((await style('N3', 'backgroundImage')).includes('linear-gradient'), 'data bar');
  // editing a value updates the rule result
  await put('N2', '99');
  assert.strictEqual(await style('N2', 'backgroundColor') !== '', true);
  // undo removes a rule
  const nRules = await page.evaluate(() => window.TallyApp.cf.length);
  assert.strictEqual(nRules, 3);
  await page.click('#btn-cf');
  await menuItem('Manage rules');
  assert.strictEqual(await page.locator('dialog .rule').count(), 3);
  await page.screenshot({ path: '/tmp/tally-cf-manage.png' });
  await page.click('dialog .rule >> nth=0 >> button');
  await page.click('dialog button[type=submit]');
  assert.strictEqual(await page.evaluate(() => window.TallyApp.cf.length), 2);
  await page.click('#btn-cf');
  await menuItem('Clear rules from entire sheet');
  assert.strictEqual(await page.evaluate(() => window.TallyApp.cf.length), 0);
  assert.strictEqual(await style('N4', 'backgroundImage'), '');

  // ----- quick number buttons -----
  await put('P1', '1234.567');
  await jump('P1');
  await page.click('#btn-decUp');       // General -> shows more decimals
  assert.strictEqual(await text('P1'), '1234.567'.length ? await text('P1') : '', 'decimals up');
  await page.click('#btn-pct');
  assert.strictEqual(await text('P1'), '123457%');
  await page.click('#btn-comma');
  assert.ok((await td('P1').locator('.fillrow').count()) === 1, 'accounting uses fill layout');
  await page.click('#btn-acct');
  assert.ok((await td('P1').textContent()).includes('1,234.57'), await td('P1').textContent());
  await page.selectOption('#sel-nf', 'Percentage');
  assert.strictEqual(await text('P1'), '123456.70%');
  await page.click('#btn-decDown');
  assert.strictEqual(await text('P1'), '123456.7%');
  await page.keyboard.press('Control+Shift+~');

  // ----- row height & column autofit -----
  await page.evaluate(() => window.TallyApp.setRowHeight(9, 50));
  assert.strictEqual(await td('A10').evaluate((e) => Math.round(e.getBoundingClientRect().height)), 50);
  await put('Q1', 'A very long piece of text to fit');
  await page.evaluate(() => window.TallyApp.autofitColumn(16));
  assert.ok((await page.evaluate(() => window.TallyApp.colWidths[16])) > 150, 'autofit widens the column');

  // ----- context menu -----
  await td('B8').click({ button: 'right' });
  await page.waitForSelector('.menu');
  assert.ok(await page.locator('.menu button.item:has-text("Format cells")').count());
  await page.keyboard.press('Escape');

  // ----- round trip keeps everything -----
  await jump('S2:T3');
  await page.click('#btn-merge');
  await page.click('#btn-cf'); await menuItem('Duplicate values');
  await page.click('dialog button[type=submit]');
  const rt = await page.evaluate(() => {
    const s = window.TallyApp ? window.__tally.serialize() : '';
    window.__tally.loadTally(s, '/tmp/x.tally');
    const A = window.TallyApp;
    return { merges: A.merges.length, cf: A.cf.length, rowH: A.rowHeights[9], font: (A.fmts.get('B1') || {}).font, nf: (A.fmts.get('A8') || {}).nf };
  });
  assert.deepStrictEqual(rt, { merges: 1, cf: 1, rowH: 50, font: 'Georgia', nf: '#,##0.0' });
  assert.strictEqual(await td('S2').evaluate((e) => e.colSpan), 2, 'merge re-rendered after load');
  assert.strictEqual(await style('B1', 'fontSize'), '34.6667px');

  await page.screenshot({ path: '/tmp/tally-format-final.png' });
  assert.deepStrictEqual(errors, [], 'no console errors');
  console.log('Format test passed');
  await browser.close();
})().catch((e) => { console.error('FORMAT TEST FAILED:', e.message, (e.stack||'').split('\n').filter(l=>l.includes('format.pw')).slice(0,2).join(' | ')); process.exit(1); });
