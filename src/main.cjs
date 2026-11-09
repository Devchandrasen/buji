const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, safeStorage, desktopCapturer, globalShortcut } = require('electron');
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
const { addLesson } = require('./core/lessons.cjs');
const { Voice } = require('./core/voice.cjs');
const { ComputerAccess } = require('./core/computer.cjs');
const { SecurityLog } = require('./core/security.cjs');
const { VisionModel, findVisionConfig } = require('./core/vision.cjs');
const execFileAsync = promisify(execFile);
const v2 = app.getName() === 'Buji V2';
const appName = v2 ? 'Buji V2' : 'Buji V1';
app.setName(appName);
const dataDirectory = process.env.BUJI_DATA_DIR || path.join(app.getPath('appData'), v2 ? 'BujiV2' : 'BujiV1');
const jevKeyFile = path.join(dataDirectory, 'typesafe-key.bin');
if (!v2 && !process.env.BUJI_DATA_DIR && process.env.BUJI_MIGRATE_LEGACY !== '0') {
  try { migrateLegacyData(dataDirectory, path.join(app.getPath('appData'), 'QwenDesk')); }
  catch (error) { console.error('Workspace migration:', error.message); }
}
app.setPath('userData', dataDirectory);
app.setAppUserModelId(v2 ? 'local.buji.v2.desktop' : 'local.buji.desktop');
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) { app.quit(); }
if (process.env.BUJI_RELEASE_ASSETS) process.env.BUJI_RELEASE_PARENT_PID = String(process.pid);
let win, store, agent, voice, computer, audit, vision;
let emergencyShortcutReady = false;
const approvals = new Map(), terminals = new Map();
const sandbox = () => store.data.settings.accessMode === 'sandbox';
const emit = event => { if (win && !win.isDestroyed()) win.webContents.send('buji:event', event); };
function trusted(event) {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    throw new Error('Untrusted application frame.');
}
function handle(name, callback) {
  ipcMain.handle('buji:' + name, async (event, ...args) => { trusted(event); return callback(...args); });
}
async function approve(threadId, command, cwd, signal, input = '') {
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
    emit({ type: 'approval', approval: { id: approvalId, threadId, command, cwd, input } });
  });
}
async function approveComputer(threadId, details, signal) {
  if (signal.aborted) return false;
  return new Promise(resolve => {
    const approvalId = id();
    let settled = false;
    const previousAlwaysOnTop = win?.isAlwaysOnTop() || false;
    const finish = allowed => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', abort); approvals.delete(approvalId);
      if (win && !win.isDestroyed()) { win.setAlwaysOnTop(previousAlwaysOnTop); win.flashFrame(false); }
      emit({ type: 'approval-closed', approvalId }); resolve(allowed);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 120000);
    approvals.set(approvalId, { finish, threadId }); signal.addEventListener('abort', abort, { once: true });
    const intent = store.thread(threadId).messages.findLast(message => message.role === 'user')?.content.slice(0,350) || '';
    emit({ type: 'approval', approval: { id: approvalId, threadId, ...details, intent, expiresAt: Date.now() + 120000 } });
    if (win?.isMinimized()) win.restore();
    if (win && !win.isDestroyed()) { win.setAlwaysOnTop(true); win.show(); win.moveTop(); win.focus(); win.flashFrame(true); }
  });
}
function emergencyStop() {
  for (const threadId of agent?.active.keys() || []) agent.cancel(threadId);
  for (const request of approvals.values()) request.finish(false);
  for (const controller of terminals.values()) controller.abort();
  computer?.stop('emergency-stop'); vision?.stop(); voice?.cancel(); voice?.cancelSpeech();
  audit?.record('emergency-stop', 'stopped'); emit({ type: 'emergency-stop' });
  return true;
}
async function computerImage(window) {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1000, height: 700 }, fetchWindowIcons: false });
  const source = sources.find(source => Number(source.id.split(':')[1]) === window.id);
  if (source && !source.thumbnail.isEmpty()) return source.thumbnail.toDataURL();
  return (await computer.worker.request('capture', { window })).image || null;
}
async function bootstrap() {
  return { ...store.snapshot(), health: await model.health(store.data.settings),
    version: app.getVersion(), dataDirectory, jevConfigured: v2 && fs.existsSync(jevKeyFile), voice: v2 ? await voice.status() : null, computer: computer?.status() };
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
  handle('get-thread', threadId => { if (computer?.session && computer.session.threadId !== threadId) { agent.cancel(computer.session.threadId); computer.stop('chat-changed'); } return store.thread(threadId); });
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
    if (payload.web !== undefined && typeof payload.web !== 'boolean') throw new Error('Invalid Web research option.');
    if (payload.jev !== undefined && typeof payload.jev !== 'boolean') throw new Error('Invalid Jev option.');
    if (payload.replyLanguage !== undefined && !['auto', 'hi', 'hinglish', 'en'].includes(payload.replyLanguage)) throw new Error('Choose a voice reply language.');
    if (!Array.isArray(payload.contextFiles) || payload.contextFiles.length > 3) throw new Error('Attach up to three project files.');
    if (!Array.isArray(payload.attachments) || payload.attachments.length > 1) throw new Error('Attach one image at a time.');
    for (const image of payload.attachments) {
      if (typeof image.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image.dataUrl) || image.dataUrl.length > 3000000)
        throw new Error('Invalid image attachment.');
    }
    let jevKey;
    if (payload.jev) {
      if (!v2 || !payload.web || !fs.existsSync(jevKeyFile)) throw new Error('Configure a TypeSafe key and enable Web before using Jev.');
      try { ({ result: jevKey } = await safeStorage.decryptStringAsync(fs.readFileSync(jevKeyFile))); }
      catch { throw new Error('Could not open the saved TypeSafe key. Save it again in Settings.'); }
    }
    await agent.send(payload, { jevKey }); return true;
  });
  handle('save-jev-key', async value => {
    if (!v2 || process.platform !== 'win32') throw new Error('TypeSafe key storage is available in the Windows Buji V2 app.');
    const key = typeof value === 'string' ? value.trim() : '';
    if (!/^[\x21-\x7e]{8,512}$/.test(key)) throw new Error('Enter a valid TypeSafe API key.');
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Windows key encryption is unavailable.');
    const encrypted = await safeStorage.encryptStringAsync(key);
    const temporary = jevKeyFile + '.tmp';
    fs.writeFileSync(temporary, encrypted);
    fs.renameSync(temporary, jevKeyFile);
    return true;
  });
  handle('remove-jev-key', () => {
    if (!v2) throw new Error('TypeSafe key storage is available in Buji V2.');
    if (fs.existsSync(jevKeyFile)) fs.unlinkSync(jevKeyFile);
    return false;
  });
  handle('lessons', () => v2 ? store.data.lessons : []);
  handle('save-lesson', (threadId, messageId, text) => {
    if (!v2) throw new Error('Saved lessons are available in Buji V2.');
    const thread = store.thread(threadId);
    if (!thread.messages.some(message => message.id === messageId && message.role === 'assistant' && message.content && !message.streaming)) {
      throw new Error('Choose a completed reply to teach Buji.');
    }
    store.data.lessons = addLesson(store.data.lessons, thread.projectId, text);
    store.save();
    return store.data.lessons;
  });
  handle('remove-lesson', lessonId => {
    if (!v2) throw new Error('Saved lessons are available in Buji V2.');
    store.data.lessons = store.data.lessons.filter(lesson => lesson.id !== lessonId);
    store.save();
    return store.data.lessons;
  });
  handle('cancel', threadId => { agent.cancel(threadId); if (computer?.allowed(threadId)) computer.stop('task-cancelled'); return true; });
  handle('security-status', () => ({ events: audit.recent(), computer: computer.status(),
    vision:vision.status(), credentialFileProtection: true, researchEnabled: store.data.settings.webEnabled !== false, emergencyShortcut: emergencyShortcutReady ? 'Ctrl+Alt+Shift+S' : null }));
  handle('emergency-stop', emergencyStop);
  handle('computer-windows', () => computer.windows());
  handle('computer-preview', threadId => { if (agent.active.size) throw new Error('Wait for the active reply to finish.'); return computer.observe(threadId); });
  handle('computer-grant', async (threadId, windowId, mode = 'accessible') => {
    if (!v2 || sandbox()) throw new Error('Computer access requires Full local access.');
    if (agent.active.size || terminals.size) throw new Error('Stop active work before granting computer access.');
    store.thread(threadId);
    if (!Number.isSafeInteger(windowId)) throw new Error('Choose one listed app window.');
    return computer.grant(threadId, windowId,mode);
  });
  handle('computer-stop', () => { for (const threadId of agent.active.keys()) agent.cancel(threadId); return computer.stop(); });
  handle('transcribe-voice', (bytes, language) => {
    if (!v2) throw new Error('Voice input is available in Buji V2.');
    return voice.transcribe(bytes, language);
  });
  handle('cancel-transcription', () => { voice?.cancel(); return true; });
  handle('synthesize-voice', text => {
    if (!v2) throw new Error('Hindi voice is available in Buji V2.');
    return voice.synthesize(text);
  });
  handle('cancel-speech', async () => { voice?.cancelSpeech(); await voice?.speechFinished; return true; });
  handle('approval', (approvalId, allowed) => {
    const request = approvals.get(approvalId); if (!request) throw new Error('This command request has expired.');
    request.finish(allowed === true); return true;
  });
  handle('tree', projectId => files.listFiles(store.project(projectId).root, '.', 4, 600, sandbox()));
  handle('read-file', (projectId, relative) => files.fullFile(store.project(projectId).root, relative, sandbox()));
  handle('save-file', async (threadId, relative, content, expectedHash) => {
    const thread = store.thread(threadId); if (!thread.projectId) throw new Error('Select a project first.');
    const change = await files.writeFile(store.project(thread.projectId).root, relative, content, expectedHash, false, sandbox());
    thread.changes.push(change); store.save(); emit({ type: 'change', threadId, change }); return change;
  });
  handle('create-file', async (threadId, relative) => {
    const thread = store.thread(threadId); if (!thread.projectId) throw new Error('Select a project first.');
    const change = await files.writeFile(store.project(thread.projectId).root, relative, '', undefined, true, sandbox());
    thread.changes.push(change); store.save(); emit({ type: 'change', threadId, change }); return change;
  });
  handle('undo-change', async (threadId, changeId) => {
    const thread = store.thread(threadId), project = store.project(thread.projectId);
    const change = thread.changes.find(c => c.id === changeId);
    if (!change || change.reverted) throw new Error('This change is already reverted.');
    await files.undoChange(project.root, change, sandbox()); change.reverted = true; store.save();
    emit({ type: 'thread', thread }); return change;
  });
  handle('search', (projectId, query) => files.searchText(store.project(projectId).root, query, '.', sandbox()));
  handle('git-status', async projectId => {
    if (sandbox()) return { branch: 'workspace', changed: 0 };
    try {
      const root = store.project(projectId).root;
      const [branch, status] = await Promise.all([
        execFileAsync('git', ['branch', '--show-current'], { cwd: root, windowsHide: true, timeout: 5000 }),
        execFileAsync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--ignore-submodules=all'], { cwd: root, windowsHide: true, timeout: 5000 })]);
      return { branch: branch.stdout.trim() || 'detached', changed: status.stdout.split('\n').filter(Boolean).length };
    } catch { return { branch: 'workspace', changed: 0 }; }
  });
  handle('terminal', async ({ projectId, command, cwd = '.' }) => {
    if (sandbox()) throw new Error('PowerShell is disabled in Sandbox.');
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
    const accessMode = values.accessMode ?? store.data.settings.accessMode;
    if (v2 && values.webEnabled !== undefined && (values.webEnabled !== false) !== (store.data.settings.webEnabled !== false) && agent.active.size)
      throw new Error('Finish or stop active work before changing public web access.');
    if (v2 && !['sandbox', 'full'].includes(accessMode)) throw new Error('Choose Sandbox or Full local access.');
    if (v2 && accessMode !== store.data.settings.accessMode && (agent.active.size || terminals.size)) {
      throw new Error('Finish or stop active work before changing access mode.');
    }
    const voiceLanguage = values.voiceLanguage ?? store.data.settings.voiceLanguage;
    if (v2 && !['auto', 'en', 'hi'].includes(voiceLanguage)) throw new Error('Choose a speech input language.');
    if (v2 && (typeof values.voiceURI !== 'string' || values.voiceURI.length > 300)) throw new Error('Choose a local speech voice.');
    const voiceReplyLanguage = values.voiceReplyLanguage ?? store.data.settings.voiceReplyLanguage;
    if (v2 && !['auto', 'hi', 'hinglish', 'en'].includes(voiceReplyLanguage)) throw new Error('Choose a voice reply language.');
    store.data.settings = { ...store.data.settings, endpoint: values.endpoint.replace(/\/$/, ''),
      model: values.model.trim(), backendScript: values.backendScript || '',
      ...(v2 ? { accessMode, voiceLanguage, voiceReplyLanguage, voiceURI: values.voiceURI, voiceConversation: values.voiceConversation !== false, webEnabled: values.webEnabled !== false } : {}),
      approveCommands: values.approveCommands !== false, autoStartModel: values.autoStartModel !== false,
      theme: ['light', 'dark'].includes(values.theme) ? values.theme : 'light' };
    if (accessMode === 'sandbox') computer?.stop('sandbox-selected');
    store.save(); return store.data.settings;
  });
  handle('health', () => model.health(store.data.settings));
  handle('start-model', async () => {
    const result = await model.startBackend(store.data.settings, value => emit({ type: 'health', value }));
    emit({ type: 'health', value: result }); return result;
  });
  handle('open-data-folder', () => shell.openPath(dataDirectory));
  handle('open-project-folder', projectId => shell.openPath(store.project(projectId).root));
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
  store = new Store(dataDirectory, { v2 });
  if (!store.data.settings.backendScript) {
    store.data.settings.backendScript = v2 ? path.resolve(path.dirname(process.execPath), '..', 'Start-Buji-V2-Backend.ps1')
      : model.findBackend(app.getAppPath(), process.execPath);
  }
  if (v2) {
    const candidates = [path.resolve(path.dirname(process.execPath), '..', 'voice'), path.join(path.dirname(store.data.settings.backendScript), 'voice')];
    const directory = candidates.find(directory => fs.existsSync(path.join(directory, 'ggml-small-q5_1.bin'))) || candidates[0];
    voice = new Voice(directory, path.join(dataDirectory, 'voice-tmp'));
  }
  if (!store.data.projects.length) {
    const starter = process.env.BUJI_TEST_PROJECT || path.join(dataDirectory, 'projects', 'getting-started');
    fs.mkdirSync(starter, { recursive: true });
    if (!process.env.BUJI_TEST_PROJECT) {
      fs.writeFileSync(path.join(starter, 'README.md'), `# Your local workspace\n\nAsk ${appName} to explain, write, and edit code here.\n\nUse Open project to work with an existing folder.\n`, 'utf8');
      fs.writeFileSync(path.join(starter, 'hello.py'), `def greet(name):\n    return f"Hello, {name}!"\n\nif __name__ == "__main__":\n    print(greet("${appName}"))\n`, 'utf8');
    }
    const project = store.addProject(starter); store.createThread(project.id);
  }
  store.save(); audit = new SecurityLog(dataDirectory);
  vision = new VisionModel(findVisionConfig(app.getAppPath(),path.dirname(process.execPath)));
  computer = new ComputerAccess({ approve: approveComputer, emit, audit, capture: computerImage, vision, onStop: session=>{agent?.cancel(session.threadId);vision?.stop();} });
  agent = new Agent(store, emit, approve, { computer, audit, vision }); register();
  emergencyShortcutReady = globalShortcut.register('CommandOrControl+Alt+Shift+S', emergencyStop);
  const expiryCheck = setInterval(() => computer.status(), 15000); expiryCheck.unref();
  win = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 680,
    title: appName, frame: false, show: !process.env.BUJI_HEADLESS,
    backgroundColor: '#faf9f7', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false, backgroundThrottling: false } });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
  if (v2) {
    const session = win.webContents.session;
    const trustedContents = contents => contents === win.webContents && contents.getURL() === entry;
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(trustedContents(contents) && (permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.isMainFrame !== false && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio')));
    });
    session.setPermissionCheckHandler((contents, permission, _origin, details) => trustedContents(contents) &&
      (permission === 'clipboard-sanitized-write' || (permission === 'media' && details.isMainFrame !== false && details.mediaType === 'audio')));
  }
  win.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
  win.on('close', () => { computer?.stop('app-closed'); voice?.cancel(); for (const id of agent.active.keys()) agent.cancel(id); for (const controller of terminals.values()) controller.abort(); });
  win.webContents.on('console-message', details => {
    if (details.level === 'error') fs.appendFileSync(path.join(dataDirectory, 'renderer-errors.log'), details.message + '\n');
  });
  win.on('page-title-updated', event => event.preventDefault());
  await win.loadFile(path.join(__dirname, 'index.html'));
  if (store.data.settings.autoStartModel) {
    model.startBackend(store.data.settings, value => emit({ type: 'health', value }))
      .then(value => emit({ type: 'health', value }))
      .catch(error => emit({ type: 'health', value: { online: false, message: error.message } }));
  }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { computer?.stop('app-quit'); vision?.stop(); globalShortcut.unregisterAll(); });
app.on('before-quit', event => {
  if (voice?.active || voice?.synthesis) {
    event.preventDefault();
    voice.cancel();
    Promise.all([voice.finished, voice.speechFinished]).then(() => app.quit());
  }
});
