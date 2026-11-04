const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Store, id, migrateLegacyData } = require('./core/store.cjs');
const files = require('./core/workspace.cjs');
const model = require('./core/model.cjs');
const { Agent } = require('./core/agent.cjs');
const { runCommand } = require('./core/commands.cjs');
const execFileAsync = promisify(execFile);
app.setName('Buji V1');
const dataDirectory = process.env.BUJI_DATA_DIR || path.join(app.getPath('appData'), 'BujiV1');
if (!process.env.BUJI_DATA_DIR && process.env.BUJI_MIGRATE_LEGACY !== '0') {
  try { migrateLegacyData(dataDirectory, path.join(app.getPath('appData'), 'QwenDesk')); }
  catch (error) { console.error('Workspace migration:', error.message); }
}
app.setPath('userData', dataDirectory);
app.setAppUserModelId('local.buji.desktop');
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) { app.quit(); }
let win, store, agent;
const approvals = new Map(), terminals = new Map();
const emit = event => { if (win && !win.isDestroyed()) win.webContents.send('buji:event', event); };
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    throw new Error('Untrusted application frame.');
}
function handle(name, callback) {
  ipcMain.handle('buji:' + name, async (event, ...args) => { trusted(event); return callback(...args); });
}
async function approve(threadId, command, cwd, signal) {
  if (signal.aborted) return false;
  return new Promise(resolve => {
    const approvalId = id();
    const finish = allowed => {
      signal.removeEventListener('abort', abort); approvals.delete(approvalId);
      emit({ type: 'approval-closed', approvalId }); resolve(allowed);
    };
    const abort = () => finish(false);
    approvals.set(approvalId, { finish, threadId });
    signal.addEventListener('abort', abort, { once: true });
    emit({ type: 'approval', approval: { id: approvalId, threadId, command, cwd } });
  });
}
async function bootstrap() {
  return { ...store.snapshot(), health: await model.health(store.data.settings),
    version: app.getVersion(), dataDirectory };
}
async function chooseProject() {
  const result = await dialog.showOpenDialog(win, { title: 'Open a project folder', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  const project = store.addProject(result.filePaths[0]); emit({ type: 'snapshot', snapshot: store.snapshot() }); return project;
}
function register() {
  handle('bootstrap', bootstrap);
  handle('choose-project', chooseProject);
  handle('create-thread', projectId => store.createThread(projectId));
  handle('get-thread', threadId => store.thread(threadId));
  handle('rename-thread', (threadId, title) => {
    if (typeof title !== 'string' || !title.trim()) throw new Error('Enter a chat title.');
    const thread = store.thread(threadId); thread.title = title.trim().slice(0, 120); store.save(); return thread;
  });
  handle('archive-thread', threadId => {
    if (agent.active.has(threadId)) throw new Error('Stop this reply before archiving the chat.');
    store.thread(threadId).archived = true; store.save(); return store.snapshot();
  });
  handle('archived-threads', () => store.data.threads.filter(thread => thread.archived).map(thread => ({
    id: thread.id, title: thread.title, projectId: thread.projectId, updatedAt: thread.updatedAt })));
  handle('restore-thread', threadId => {
    store.thread(threadId).archived = false; store.save(); return store.snapshot();
  });
  handle('send', async payload => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid message.');
    if (!['chat', 'agent'].includes(payload.mode)) throw new Error('Choose Chat or Agent mode.');
    if (!Array.isArray(payload.contextFiles) || payload.contextFiles.length > 3) throw new Error('Attach up to three project files.');
    if (!Array.isArray(payload.attachments) || payload.attachments.length > 1) throw new Error('Attach one image at a time.');
    for (const image of payload.attachments) {
      if (typeof image.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image.dataUrl) || image.dataUrl.length > 3000000)
        throw new Error('Invalid image attachment.');
    }
    await agent.send(payload); return true;
  });
  handle('cancel', threadId => { agent.cancel(threadId); return true; });
  handle('approval', (approvalId, allowed) => {
    const request = approvals.get(approvalId); if (!request) throw new Error('This command request has expired.');
    request.finish(allowed === true); return true;
  });
  handle('tree', projectId => files.listFiles(store.project(projectId).root, '.', 4, 600));
  handle('read-file', (projectId, relative) => files.fullFile(store.project(projectId).root, relative));
  handle('save-file', async (threadId, relative, content, expectedHash) => {
    const thread = store.thread(threadId); if (!thread.projectId) throw new Error('Select a project first.');
    const change = await files.writeFile(store.project(thread.projectId).root, relative, content, expectedHash);
    thread.changes.push(change); store.save(); emit({ type: 'change', threadId, change }); return change;
  });
  handle('create-file', async (threadId, relative) => {
    const thread = store.thread(threadId); if (!thread.projectId) throw new Error('Select a project first.');
    const change = await files.writeFile(store.project(thread.projectId).root, relative, '', undefined, true);
    thread.changes.push(change); store.save(); emit({ type: 'change', threadId, change }); return change;
  });
  handle('undo-change', async (threadId, changeId) => {
    const thread = store.thread(threadId), project = store.project(thread.projectId);
    const change = thread.changes.find(c => c.id === changeId);
    if (!change || change.reverted) throw new Error('This change is already reverted.');
    await files.undoChange(project.root, change); change.reverted = true; store.save();
    emit({ type: 'thread', thread }); return change;
  });
  handle('search', (projectId, query) => files.searchText(store.project(projectId).root, query));
  handle('git-status', async projectId => {
    try {
      const root = store.project(projectId).root;
      const [branch, status] = await Promise.all([
        execFileAsync('git', ['branch', '--show-current'], { cwd: root, windowsHide: true, timeout: 5000 }),
        execFileAsync('git', ['status', '--porcelain'], { cwd: root, windowsHide: true, timeout: 5000 })]);
      return { branch: branch.stdout.trim() || 'detached', changed: status.stdout.split('\n').filter(Boolean).length };
    } catch { return { branch: 'workspace', changed: 0 }; }
  });
  handle('terminal', async ({ projectId, command, cwd = '.' }) => {
    const project = store.project(projectId), terminalId = id(), controller = new AbortController();
    terminals.set(terminalId, controller);
    emit({ type: 'terminal-start', terminalId, projectId, command, cwd });
    try {
      const result = await runCommand(project.root, command, { cwd, signal: controller.signal,
        onOutput: (text, stream) => emit({ type: 'terminal-output', terminalId, projectId, text, stream }) });
      emit({ type: 'terminal-end', terminalId, projectId, result }); return result;
    } finally { terminals.delete(terminalId); }
  });
  handle('cancel-terminal', terminalId => { terminals.get(terminalId)?.abort(); return true; });
  handle('choose-image', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Attach an image', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return null;
    const filename = result.filePaths[0];
    if ((await fsp.stat(filename)).size > 12 * 1024 * 1024) throw new Error('Choose an image below 12 MiB.');
    let image = nativeImage.createFromPath(filename);
    if (image.isEmpty()) throw new Error('Could not open that image.');
    const size = image.getSize(), scale = Math.min(1, 1024 / Math.max(size.width, size.height));
    if (scale < 1) image = image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) });
    return { name: path.basename(filename), dataUrl: 'data:image/jpeg;base64,' + image.toJPEG(85).toString('base64') };
  });
  handle('choose-backend-script', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose your model launcher', properties: ['openFile'], filters: [{ name: 'PowerShell script', extensions: ['ps1'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('save-settings', values => {
    model.endpointUrl(values.endpoint);
    if (typeof values.model !== 'string' || !values.model.trim() || values.model.length > 120) throw new Error('Enter a model ID.');
    if (values.backendScript && (!fs.existsSync(values.backendScript) || path.extname(values.backendScript).toLowerCase() !== '.ps1'))
      throw new Error('Choose an existing PowerShell model launcher.');
    store.data.settings = { ...store.data.settings, endpoint: values.endpoint.replace(/\/$/, ''),
      model: values.model.trim(), backendScript: values.backendScript || '',
      approveCommands: values.approveCommands !== false, autoStartModel: values.autoStartModel !== false,
      theme: ['light', 'dark'].includes(values.theme) ? values.theme : 'light' };
    store.save(); return store.data.settings;
  });
  handle('health', () => model.health(store.data.settings));
  handle('start-model', async () => {
    const result = await model.startBackend(store.data.settings, value => emit({ type: 'health', value }));
    emit({ type: 'health', value: result }); return result;
  });
  handle('open-data-folder', () => shell.openPath(dataDirectory));
  handle('window', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
  handle('external', value => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only web links can be opened.');
    return shell.openExternal(url.toString());
  });
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  store = new Store(dataDirectory);
  if (!store.data.settings.backendScript) store.data.settings.backendScript = model.findBackend(app.getAppPath(), process.execPath);
  if (!store.data.projects.length) {
    const starter = process.env.BUJI_TEST_PROJECT || path.join(dataDirectory, 'projects', 'getting-started');
    fs.mkdirSync(starter, { recursive: true });
    if (!process.env.BUJI_TEST_PROJECT) {
      fs.writeFileSync(path.join(starter, 'README.md'), '# Your local workspace\n\nAsk Buji V1 to explain, write, edit, and run code here.\n\nUse Open project to work with an existing folder.\n', 'utf8');
      fs.writeFileSync(path.join(starter, 'hello.py'), 'def greet(name):\n    return f"Hello, {name}!"\n\nif __name__ == "__main__":\n    print(greet("Buji V1"))\n', 'utf8');
    }
    const project = store.addProject(starter); store.createThread(project.id);
  }
  store.save(); agent = new Agent(store, emit, approve); register();
  win = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 680,
    title: 'Buji V1', frame: false, show: !process.env.BUJI_HEADLESS,
    backgroundColor: '#faf9f7', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
  win.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
  win.on('close', () => { for (const id of agent.active.keys()) agent.cancel(id); for (const controller of terminals.values()) controller.abort(); });
  win.webContents.on('console-message', details => {
    if (details.level === 'error') fs.appendFileSync(path.join(dataDirectory, 'renderer-errors.log'), details.message + '\n');
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (store.data.settings.autoStartModel) {
    model.startBackend(store.data.settings, value => emit({ type: 'health', value }))
      .then(value => emit({ type: 'health', value }))
      .catch(error => emit({ type: 'health', value: { online: false, message: error.message } }));
  }
});
app.on('window-all-closed', () => app.quit());
