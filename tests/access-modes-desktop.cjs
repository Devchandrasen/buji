'use strict';
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const output = path.resolve(__dirname, '../../../outputs/BujiV2-Router');
const executablePath = path.join(output, 'app/BujiV2.exe');

async function main() {
  const artifacts = path.join(__dirname, '../artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifacts, 'access-modes-'));
  const profile = path.join(root, 'profile');
  const project = path.join(root, 'project');
  const outside = path.join(root, 'outside');
  const marker = path.join(outside, 'marker.txt');
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.writeFile(marker, 'OUTSIDE_TEST_ONLY');
  await fs.writeFile(path.join(project, 'inside.txt'), 'INSIDE_TEST_ONLY');
  await fs.link(marker, path.join(project, 'linked.txt'));
  await fs.symlink(outside, path.join(project, 'linked-dir'), 'junction');
  const env = { ...process.env, BUJI_DATA_DIR: profile, BUJI_TEST_PROJECT: project, BUJI_HEADLESS: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => electron.launch({ executablePath, args: [], env, timeout: 45000 });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getName()), 'Buji V2');
    const snapshot = await page.evaluate(() => window.buji.bootstrap());
    assert.equal(snapshot.settings.accessMode, 'sandbox');
    assert.equal(snapshot.health.model, 'buji-v2-routed');
    const projectId = snapshot.projects[0].id;
    const outsideRead = `Get-Content -LiteralPath '${marker.replaceAll("'", "''")}'`;
    await assert.rejects(page.evaluate(({ projectId, command }) => window.buji.terminal({ projectId, command }),
      { projectId, command: outsideRead }), /PowerShell is disabled in Sandbox/);
    await assert.rejects(page.evaluate(settings => window.buji.saveSettings({ ...settings, accessMode: 'unexpected' }),
      snapshot.settings), /Choose Sandbox or Full local access/);
    assert.equal(await page.getByRole('button', { name: 'Toggle terminal' }).isDisabled(), true);

    for (const file of [marker, '../outside/marker.txt', 'linked.txt', 'linked-dir/marker.txt', 'inside.txt:stream', 'NUL.txt']) {
      await assert.rejects(page.evaluate(({ projectId, file }) => window.buji.readFile(projectId, file), { projectId, file }));
    }
    const tree = await page.evaluate(projectId => window.buji.tree(projectId), projectId);
    assert.deepEqual(tree.map(file => file.name), ['inside.txt']);
    const thread = await page.evaluate(async projectId => {
      const { id } = await window.buji.createThread(projectId);
      await window.buji.send({ threadId: id, text: 'Create a file named router-smoke.txt containing exactly ROUTER_SMOKE_OK followed by a newline.',
        mode: 'agent', contextFiles: [], attachments: [] });
      return window.buji.getThread(id);
    }, projectId);
    assert.ok(thread.messages.some(message => message.name === 'write_file' && message.status === 'done'));
    assert.equal(await fs.readFile(path.join(project, 'router-smoke.txt'), 'utf8'), 'ROUTER_SMOKE_OK\n');
    await assert.rejects(page.evaluate(threadId => window.buji.saveFile(threadId, 'linked.txt', 'CHANGED'), thread.id));
    assert.equal(await fs.readFile(marker, 'utf8'), 'OUTSIDE_TEST_ONLY');
    console.log('Sandbox blocked escapes and PowerShell while the local model wrote a project file.');

    await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
    await page.getByRole('combobox', { name: 'Access mode' }).selectOption('full');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByRole('button', { name: 'Full local access', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Toggle terminal' }).isEnabled(), true);
    const run = await page.evaluate(({ projectId, command }) => window.buji.terminal({ projectId, command }),
      { projectId, command: outsideRead });
    assert.equal(run.exitCode, 0);
    assert.match(run.output, /OUTSIDE_TEST_ONLY/);
    console.log('Full local access enabled PowerShell with access outside the project.');

    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Full local access', exact: true }).waitFor();
    const restored = await page.evaluate(() => window.buji.bootstrap());
    assert.equal(restored.settings.accessMode, 'full');
    assert.equal(restored.settings.approveCommands, true);
    await page.getByRole('button', { name: 'Full local access', exact: true }).click();
    await page.getByRole('combobox', { name: 'Access mode' }).selectOption('sandbox');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByRole('button', { name: 'Sandbox', exact: true }).waitFor();
    await assert.rejects(page.evaluate(({ projectId, command }) => window.buji.terminal({ projectId, command }),
      { projectId, command: outsideRead }), /PowerShell is disabled in Sandbox/);
    console.log('Access mode persisted across restart and Sandbox took effect again after switching.');
  } finally {
    await app.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
