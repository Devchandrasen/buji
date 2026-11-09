// Isolated, disposable native application for computer-access acceptance tests.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../artifacts/security-upgrade');
fs.mkdirSync(output, { recursive: true });
app.setName('Buji Computer QA');
app.setPath('userData', path.join(output, 'fixture-profile-'+process.pid));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 800, height: 580, show:false, title: 'Buji Computer QA — local test note',
    webPreferences: { preload: path.join(__dirname, 'computer-fixture-preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.setMenu(null);
  window.once('ready-to-show',()=>{window.show();window.focus();});
  window.webContents.on('render-process-gone',(_event,details)=>fs.writeFileSync(path.join(output,'fixture-render-status.json'),JSON.stringify(details)));
  ipcMain.handle('fixture-save', (event, text) => {
    if (event.sender !== window.webContents || typeof text !== 'string' || text.length > 4000) throw new Error('Invalid fixture input.');
    fs.writeFileSync(path.join(output, 'computer-note.txt'), text, 'utf8');
    return 'Saved locally: computer-note.txt';
  });
  await window.loadFile(path.join(__dirname, 'computer-fixture.html'));
  fs.writeFileSync(path.join(output,'fixture-render-status.json'),JSON.stringify({loaded:true,pid:process.pid}));
});
app.on('window-all-closed', () => app.quit());
