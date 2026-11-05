const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const artifacts = path.join(ROOT, 'artifacts');
const runRoot = path.join(artifacts, 'desktop-run-' + Date.now());
const workspace = path.join(runRoot, 'buji-demo');
const state = path.join(runRoot, 'state');
const results = [];
let application, page;
async function capture(name) {
  if (!process.env.BUJI_CAPTURE_DEMO) return;
  await fs.mkdir(path.join(artifacts, 'demo'), { recursive: true });
  await page.screenshot({ path: path.join(artifacts, 'demo', name + '.png') });
}
async function launch() {
  const env = { ...process.env, BUJI_DATA_DIR: state, BUJI_TEST_PROJECT: workspace, BUJI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ ...(process.env.BUJI_EXECUTABLE
    ? { executablePath: process.env.BUJI_EXECUTABLE, args: [] } : { args: [ROOT] }), env, timeout: 45000 });
  page = await application.firstWindow(); page.setDefaultTimeout(15000);
  if (process.env.BUJI_EXECUTABLE)
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  page.on('pageerror', error => console.error('RENDERER_ERROR', error.message));
  await page.getByRole('textbox', { name: 'Message Buji' }).waitFor();
  await page.locator('.statusbar').getByText('Qwen3 Personal WSP · local inference', { exact: true }).waitFor({ timeout: 30000 });
}
async function mark(name, detail) { results.push({ name, passed: true, detail }); console.log('PASS', name, detail || ''); }
(async () => {
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Desktop test project\nA disposable workspace for the Buji V1 integration test.\n');
  await launch();
  await page.screenshot({ path: path.join(artifacts, 'welcome.png') });
  await capture('01-welcome');
  await mark('desktop boot and local model connection');
  const prompt = "Create hello_buji.py containing exactly print('HELLO_BUJI') followed by a newline. Then run it using python hello_buji.py and report the output. Use the file and command tools to do the work.";
  await page.getByRole('textbox', { name: 'Message Buji' }).fill(prompt);
  await capture('02-task');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByTestId('command-approval').waitFor({ timeout: 120000 });
  await capture('03-command-review');
  assert.match(await fs.readFile(path.join(workspace, 'hello_buji.py'), 'utf8'), /print\(['"]HELLO_BUJI['"]\)/);
  await mark('real model created a project file');
  await page.getByRole('button', { name: 'Run command', exact: true }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor({ timeout: 120000 });
  assert.match(await page.getByLabel('Terminal output').innerText(), /HELLO_BUJI/);
  const saved = JSON.parse(await fs.readFile(path.join(state, 'workspace.json'), 'utf8'));
  const commandResult = saved.threads.flatMap(t => t.messages).find(m => m.role === 'tool' && m.name === 'run_command' && m.result?.exitCode === 0);
  assert.ok(commandResult); await mark('approved command ran with exit code 0');
  await capture('04-result');
  await page.getByTestId('execution-summary').filter({ hasText: 'Completed on your PC' }).waitFor();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.locator('.file-tree').getByRole('button', { name: 'hello_buji.py', exact: true }).click();
  const editor = page.locator('.cm-content');
  await editor.click(); await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText("print('EDITOR_SAVE_OK')\n");
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved hello_buji.py' }).waitFor();
  assert.equal(await fs.readFile(path.join(workspace, 'hello_buji.py'), 'utf8'), "print('EDITOR_SAVE_OK')\n");
  await mark('editor saved real file contents');
  await page.getByRole('button', { name: /^Changes/ }).click();
  await page.getByRole('button', { name: 'Undo edit to hello_buji.py', exact: true }).last().click();
  await page.waitForFunction(() => document.querySelectorAll('.change-card').length === 1);
  assert.match(await fs.readFile(path.join(workspace, 'hello_buji.py'), 'utf8'), /HELLO_BUJI/);
  await mark('review diff and undo restored original agent edit');
  await page.screenshot({ path: path.join(artifacts, 'agent-workspace.png') });
  await capture('05-review');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.settings-modal select').selectOption('dark');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.locator('.settings-modal').waitFor({ state: 'detached' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await application.close(); application = null;
  await launch();
  // The prior chat is restored, so a welcome status is not expected after restart.
  await page.locator('.user-bubble').filter({ hasText: 'Create hello_buji.py' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await mark('chat history and settings survived app restart');
  const snapshot = await page.evaluate(() => window.buji.bootstrap());
  assert.match(path.basename(snapshot.settings.backendScript), /^Start-(?:Qwen3|Model)\.ps1$/i);
  await fs.access(snapshot.settings.backendScript);
  await mark('packaged app resolves the installed model launcher');
  const originalChat = snapshot.threads.find(thread => thread.title.startsWith('Create hello_buji.py'));
  await page.locator('.thread-row').filter({ hasText: originalChat.title }).hover();
  await page.getByRole('button', { name: 'Options for ' + originalChat.title, exact: true }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.locator('.user-bubble').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('.archived-chats summary').click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.buji.archivedThreads())).length, 0);
  assert.ok((await page.evaluate(() => window.buji.bootstrap())).threads.some(thread => thread.id === originalChat.id));
  await mark('archived chats can be restored without losing history');
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const imagePath = path.join(runRoot, 'red.png');
  const imageBytes = await application.evaluate(({ nativeImage, dialog }, filename) => {
    const pixels = Buffer.alloc(64 * 64 * 4);
    for (let index = 0; index < pixels.length; index += 4) pixels.writeUInt32LE(0xfff00f0f, index);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    return nativeImage.createFromBitmap(pixels, { width: 64, height: 64 }).toPNG().toString('base64');
  }, imagePath);
  await fs.writeFile(imagePath, Buffer.from(imageBytes, 'base64'));
  await page.getByRole('button', { name: 'New general chat', exact: true }).click();
  await page.getByRole('button', { name: 'Attach image', exact: true }).click();
  await page.locator('.composer-attachments').getByText('red.png', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Message Buji', exact: true }).fill('What is the dominant color of this image? Reply with one English color word.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Send message', exact: true }).waitFor({ timeout: 60000 });
  const color = await page.locator('.message.assistant .markdown').last().innerText();
  assert.equal(color.trim().toLowerCase().replace(/[.!]/g, ''), 'red');
  await mark('native image attachment reaches the real vision model');
  await application.close(); application = null;
  await fs.writeFile(path.join(artifacts, 'desktop-checks.json'), JSON.stringify({ allPassed: true, backend: 'real Qwen3 Personal WSP', results }, null, 2));
  console.log('All desktop checks passed.');
})().catch(async error => {
  console.error(error);
  if (page) { try { await page.screenshot({ path: path.join(artifacts, 'failure.png') }); } catch {} }
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, 'desktop-checks.json'), JSON.stringify({ allPassed: false, results, error: error.message }, null, 2));
  if (application) await application.close(); process.exitCode = 1;
});
