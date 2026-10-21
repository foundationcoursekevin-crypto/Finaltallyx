# Tally

A desktop spreadsheet: grid, formulas, formatting and charts. Electron + plain JavaScript, no build step.

## Run it

```
npm install
npm start
```

## Run it in a browser

Open `src/index.html` in Chrome or Edge. Save, Open and the CSV buttons work there too (Chrome and Edge overwrite the same file on every Save; other browsers download a new copy each time). No install needed.

Package an installer for your OS with `npm run dist`.

Run the tests with `npm test` (formula engine, CSV, chart data).

## What it does

- **Grid:** 1326 columns (A to AXZ) × 5,000 rows = 6.6 million cells (only the columns near the screen are drawn, so it stays fast), click or drag to select, resize columns, full keyboard navigation
- **Formulas:** `+ - * / ^ & %`, comparisons, ranges (`A1:B5`), absolute refs (`$A$1`), automatic recalculation, `#CIRC!` detection
- **Functions:** SUM, AVERAGE, MIN, MAX, MEDIAN, PRODUCT, COUNT, COUNTA, COUNTIF, SUMIF, IF, IFERROR, ISERROR, ISNUMBER, ISTEXT, ISBLANK, AND, OR, NOT, ROUND, ABS, SQRT, POWER, MOD, INT, PI, CONCAT, CONCATENATE, UPPER, LOWER, LEN, TRIM, LEFT, RIGHT, MID
- **Fonts:** font family and size, bold, italic, underline (single or double), strikethrough, text color, grow/shrink font
- **Fill and borders:** fill color palette, borders menu (all, outside, thick, double, top/bottom...), per-side line style and color, merge and center
- **Alignment:** horizontal, vertical, indent, wrap text, row heights that grow with the content, drag-resize rows and columns, double-click a column edge to AutoFit
- **Number formats:** General, Number, Currency, Accounting, Date, Time, Percentage, Fraction, Scientific, Text and Custom codes (`0.00`, `#,##0`, `[Red]`, `dddd, mmmm d`, `0.0,"K"`...), increase/decrease decimals, dates/percents/currency typed in get the right format automatically
- **Format Cells dialog (Ctrl+1):** Number, Alignment, Font, Border and Fill tabs with live preview, also on the right-click menu
- **Conditional formatting:** greater/less/between/equal, text contains, duplicates, color scales, data bars, manage and clear rules
- **Ribbon:** Home, Insert, Page Layout, Formulas and View tabs (arrow keys move between tabs)
- **Workbook themes:** 10 built-in themes (Office, Facet, Integral, Ion, Organic, Retrospect, Slice, Wisp...) plus separate color sets and font sets under Page Layout. Fills, text colors, borders, heading styles and charts follow the theme, so switching themes recolors the whole sheet (and undo works)
- **View options:** show/hide gridlines, headings and the formula bar
- **Formulas tab:** AutoSum and one-click starters for common functions
- **Cell styles** (Good, Bad, Neutral, Input, Title, Heading 1-3, Total...) and a **format painter**
- **Charts:** bar, line and pie from any range; they update live as the data changes
- **Formula finder:** the search box at the right of the formula bar finds any formula by plain words ("total", "how many", "join", "paid unpaid"). Each result shows what it is for, how to write it and a worked example with its answer; pick one (click or Enter) and it is typed into the cell, or into the formula you are writing. 43 formulas work today; 27 popular ones (VLOOKUP, SUMIFS...) are listed as "Not in Tally yet". The catalog is `src/formulas.js`, and its tests check every example against the engine.
- **Excel:** Open (Ctrl+O) reads `.xlsx` and `.xlsm` files: values, formulas, dates, number formats, bold/italic/colours, borders, merged cells, column widths and row heights. Only the first visible sheet is opened; charts, pictures and macros are not. **Export Excel** writes an `.xlsx` that Excel and Google Sheets open.
- **Files:** save/open `.tally`, import/export CSV, unsaved-changes warning, file name shown at the top
- **Look:** its own ink-indigo design (light and dark), pill tabs (Format, Insert, Look, Formulas, View), a default "Tally" colour set and font, and a live tally chip: select numbers and Sum, Count and Average hang off the corner of the selection. The old Office-style themes are still in the Look tab.
- **Password protection:** the 🔒 Password button (File > Password… in the desktop app) encrypts the file with AES-256-GCM (key from PBKDF2-SHA256, 600,000 rounds) the next time you save. Opening it asks for the password. A forgotten password cannot be recovered.
- **Editing:** undo/redo, copy/paste (formulas shift their references, works with Excel/Sheets), fill down/right, click cells to build formulas

## Shortcuts

| Key | Action |
| --- | --- |
| Arrows, Tab, Enter | Move (Shift extends the selection) |
| Ctrl+Arrow | Jump to the edge of the data |
| F2 or double-click | Edit the cell |
| Esc | Cancel an edit |
| Delete | Clear contents |
| Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+5 | Bold / italic / underline / strikethrough |
| Ctrl+1 | Format Cells dialog |
| Ctrl+Shift+$ % ! # @ ^ ~ | Currency / percent / comma / date / time / scientific / general |
| Ctrl+Shift+& / Ctrl+Shift+_ | Outside border / remove borders |
| Ctrl+D / Ctrl+R | Fill down / right |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+S / Ctrl+O / Ctrl+N | Save / open / new |

## Layout

```
main.js          Electron main process: window, menu, file dialogs
preload.js       The small bridge the page can use (save, open, confirm)
src/engine.js    Tokenizer, parser, evaluator, dependency graph
src/numfmt.js    Excel-style number format codes, dates, typed-value parsing
src/helpers.js   Display formatting, CSV, chart data
src/theme.js     Workbook themes: color sets, font sets, theme color references
src/format-ui.js Ribbon, palettes, Format Cells dialog, conditional formatting
src/charts.js    Canvas chart drawing
src/app.js       Grid, editing, selection, clipboard, undo, files
test/            Node tests and a headless-browser smoke test
```

## Not built yet

Insert/delete rows and columns, multiple sheets, sorting and filtering, XLSX import/export, a grid larger than 200 rows (needs virtualized rendering), freeze panes, text rotation, shrink to fit, pattern and gradient fills, custom themes, Format as Table, top/bottom-N conditional rules, and cell protection.
