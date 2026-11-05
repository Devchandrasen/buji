// Real local-model acceptance test. No scripted provider responses.
const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const runRoot = path.join(root, 'artifacts', 'actions-desktop-' + Date.now());
const project = path.join(runRoot, 'tic-tac-toe');
const state = path.join(runRoot, 'state');
let app;
(async () => {
  await fs.mkdir(project, { recursive: true });
  const env = { ...process.env, BUJI_DATA_DIR: state, BUJI_TEST_PROJECT: project, BUJI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.BUJI_EXECUTABLE ? { executablePath: process.env.BUJI_EXECUTABLE, args: [] } : { args: [root] }), env, timeout: 45000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  await app.evaluate(({ BrowserWindow, shell }) => {
    BrowserWindow.getAllWindows()[0].show();
    shell.openPath = async folder => { global.bujiOpenedFolder = folder; return ''; };
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('.statusbar').getByText('Qwen3 Personal WSP · local inference', { exact: true }).waitFor({ timeout: 150000 });
  await page.getByRole('textbox', { name: 'Message Buji' }).fill('can you help me build me a tic tac toe using python for the command line');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  let approvals = 0;
  for (let step = 0; step < 20; step++) {
    await page.waitForFunction(() => document.querySelector('[data-testid="command-approval"]') || !document.querySelector('.send-button.stop'), undefined, { timeout: 150000 });
    const approval = page.getByTestId('command-approval');
    if (!await approval.count()) break;
    console.log('APPROVE_TEST_COMMAND', await approval.locator('pre').first().innerText());
    await approval.getByRole('button', { name: 'Run command', exact: true }).click(); approvals++;
    await approval.waitFor({ state: 'detached' });
  }
  const summary = page.getByTestId('execution-summary').last();
  await summary.filter({ hasText: 'Completed on your PC' }).waitFor({ timeout: 30000 });
  const saved = JSON.parse(await fs.readFile(path.join(state, 'workspace.json'), 'utf8'));
  const thread = saved.threads.find(t => t.messages.some(m => m.work));
  const work = thread.messages.findLast(m => m.work).work;
  assert.equal(work.status, 'completed'); assert.equal(work.verification, 'passed'); assert.ok(approvals > 0);
  const files = work.files.filter(f => f.endsWith('.py')); assert.ok(files.length > 0);
  for (const filename of files) {
    await fs.access(path.join(project, filename));
    await run('python', ['-m', 'py_compile', path.join(project, filename)], { timeout: 10000, windowsHide: true });
  }
  const main = files.find(f => !/test/i.test(path.basename(f))) || files[0];
  const smoke = [
    'import subprocess,sys',
    'ok=False',
    'for moves in ["1\\n4\\n2\\n5\\n3\\nn\\n", "0\\n3\\n1\\n4\\n2\\nn\\n"]:',
    ' try:',
    '  r=subprocess.run([sys.executable,sys.argv[1]],input=moves,text=True,capture_output=True,timeout=5)',
    '  if r.returncode==0 and any(x in r.stdout.lower() for x in ["wins", "winner", "won"]): ok=True;break',
    ' except subprocess.TimeoutExpired: pass',
    'assert ok, "Independent scripted gameplay did not finish a winning game"',
    'print("BUJI_TIC_TAC_TOE_GAMEPLAY_OK")'
  ].join('\n');
  const played = await run('python', ['-c', smoke, path.join(project, main)], { timeout: 15000, windowsHide: true });
  assert.match(played.stdout, /BUJI_TIC_TAC_TOE_GAMEPLAY_OK/);
  await summary.locator('.work-folder').click();
  assert.equal(await app.evaluate(() => global.bujiOpenedFolder), project);
  assert.equal(await page.getByRole('button', { name: /^Changes/ }).count(), 1);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(runRoot, 'built-on-pc.png') });
  const report = { passed: true, backend: 'real Qwen3 Personal WSP', prompt: 'ordinary build request without a tool-use instruction',
    createdPythonFiles: files, commandApprovals: approvals, agentVerification: 'passed', independentPythonCompilation: 'passed',
    independentScriptedGameplay: 'passed', nativeFolderAction: 'passed', rendererErrors: errors };
  await fs.writeFile(path.join(root, 'artifacts', 'game-desktop-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await app.close(); app = null;
})().catch(async error => { console.error(error); if (app) await app.close(); process.exitCode = 1; });
