'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let win = null;
let dirty = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'Tally',
    backgroundColor: '#f2f4f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Ask before closing a window that has unsaved changes.
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Discard changes'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsaved changes.',
      detail: 'Closing now will discard them.'
    });
    if (choice === 0) e.preventDefault();
  });
  win.on('closed', () => {
    win = null;
  });

  // The app never navigates away or opens new windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (action) => () => win && win.webContents.send('menu', action);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { label: 'Password…', click: send('password') },
        { type: 'separator' },
        { label: 'Import CSV…', click: send('import-csv') },
        { label: 'Export CSV…', click: send('export-csv') },
        { label: 'Export Excel…', click: send('export-xlsx') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Only the app's own window may talk to these handlers.
const fromApp = (e) => win && e.sender === win.webContents;

ipcMain.handle('file:save-as', async (e, { content, defaultPath, filters }) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, content, typeof content === 'string' ? 'utf8' : undefined);
  return r.filePath;
});

ipcMain.handle('file:write', async (e, { path: p, content }) => {
  if (!fromApp(e)) return null;
  await fs.promises.writeFile(p, content, typeof content === 'string' ? 'utf8' : undefined);
  return p;
});

ipcMain.handle('file:open', async (e, { filters }) => {
  if (!fromApp(e)) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  if (/\.(xlsx|xlsm)$/i.test(p)) return { path: p, bytes: new Uint8Array(await fs.promises.readFile(p)) };
  return { path: p, content: await fs.promises.readFile(p, 'utf8') };
});

ipcMain.handle('dialog:confirm', async (e, { message, detail, ok }) => {
  if (!fromApp(e)) return false;
  const r = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Cancel', ok || 'OK'],
    defaultId: 0,
    cancelId: 0,
    message,
    detail
  });
  return r.response === 1;
});

ipcMain.on('doc:dirty', (e, v) => {
  if (fromApp(e)) dirty = !!v;
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
