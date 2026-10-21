'use strict';
/*
 * Browser fallback for the desktop bridge.
 * In the Electron app, preload.js defines window.tally and this file does nothing.
 * In a plain browser (Chrome, Edge, Firefox...) it provides Save / Save As / Open /
 * CSV import-export through downloads and file pickers, and stops Ctrl+S from
 * triggering the browser's own "Save page as" (which saved a duplicate page + folder).
 */
(function () {
  if (window.tally) return;

  const handles = new Map(); // file name -> FileSystemFileHandle (Chrome/Edge: lets Save overwrite in place)
  let menuCb = null;

  const MIME = { csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12' };
  const isExcel = (n) => /\.(xlsx|xlsm)$/i.test(n);
  // Excel files are binary; everything else is text.
  const readFile = async (file) => (isExcel(file.name) ? { path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : { path: file.name, content: await file.text() });

  function pickerTypes(filters) {
    return (filters || []).map((f) => {
      const accept = {};
      for (const ext of f.extensions) {
        const m = MIME[ext] || 'application/json';
        (accept[m] = accept[m] || []).push('.' + ext);
      }
      return { description: f.name, accept };
    });
  }

  function leaf(p) {
    return String(p || 'Untitled').split(/[\\/]/).pop();
  }

  function download(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: typeof content === 'string' ? 'text/plain;charset=utf-8' : 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function writeHandle(h, content) {
    const w = await h.createWritable();
    await w.write(content);
    await w.close();
  }

  async function saveAs({ content, defaultPath, filters }) {
    const name = leaf(defaultPath);
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: name, types: pickerTypes(filters) });
        await writeHandle(h, content);
        handles.set(h.name, h);
        return h.name;
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        // any other failure: fall through to a plain download
      }
    }
    download(name, content);
    return name;
  }

  async function write(path, content) {
    const h = handles.get(path);
    if (h) {
      try {
        await writeHandle(h, content);
        return path;
      } catch (e) {
        handles.delete(path);
      }
    }
    download(leaf(path), content);
    return path;
  }

  function openViaInput(filters) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = (filters || []).flatMap((f) => f.extensions.map((x) => '.' + x)).join(',');
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        input.remove();
        resolve(file ? await readFile(file) : null);
      });
      input.addEventListener('cancel', () => {
        input.remove();
        resolve(null);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function open({ filters }) {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({ types: pickerTypes(filters) });
        const file = await h.getFile();
        if (/\.tally$/i.test(file.name)) handles.set(file.name, h);
        return await readFile(file);
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
      }
    }
    return openViaInput(filters);
  }

  window.tally = {
    saveAs,
    write,
    open,
    confirm: async ({ message, detail }) => window.confirm(message + (detail ? '\n\n' + detail : '')),
    setDirty: (v) => {
      window.onbeforeunload = v ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
    },
    onMenu: (cb) => {
      menuCb = cb;
    }
  };

  // Keyboard shortcuts that the desktop menu normally provides.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !menuCb) return;
      if (e.target.closest && e.target.closest('.pwov')) return;
      const k = e.key.toLowerCase();
      const inField = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      let action = null;
      if (k === 's') action = e.shiftKey ? 'save-as' : 'save';
      else if (k === 'o' && !e.shiftKey) action = 'open';
      else if ((k === 'z' || k === 'y') && !inField) action = k === 'y' || e.shiftKey ? 'redo' : 'undo';
      if (!action) return;
      e.preventDefault();
      menuCb(action);
    },
    true
  );

  // A small File group next to undo/redo, since there is no native menu bar.
  const qat = document.querySelector('.qat');
  if (qat) {
    [['New', 'new', 'New sheet'], ['Open', 'open', 'Open a Tally or Excel file (Ctrl+O)'], ['Save', 'save', 'Save (Ctrl+S)'], ['Save as', 'save-as', 'Save as (Ctrl+Shift+S)'], ['Import CSV', 'import-csv', 'Import a CSV file'], ['Export CSV', 'export-csv', 'Export as CSV'], ['Export Excel', 'export-xlsx', 'Export as an Excel (.xlsx) file']].forEach(([label, action, title]) => {
      const b = document.createElement('button');
      b.className = 'tb fbtn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => menuCb && menuCb(action));
      qat.appendChild(b);
    });
    qat.style.flexWrap = 'wrap';
  }
})();
