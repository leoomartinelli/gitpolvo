'use strict';

// Converte assets/icon.svg em assets/icon.png (512px) usando o Chromium do Electron.
// Uso: electron build/render-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'assets', 'icon.svg'), 'utf8');
const SIZE = 512;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 150));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.writeFileSync(path.join(root, 'assets', 'icon.png'), img.resize({ width: SIZE, height: SIZE }).toPNG());
  win.destroy();
  app.quit();
});
