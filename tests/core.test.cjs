const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Store, migrateLegacyData } = require('../src/core/store.cjs');
const files = require('../src/core/workspace.cjs');
const { endpointUrl, compactMessages, health } = require('../src/core/model.cjs');
const { runCommand } = require('../src/core/commands.cjs');

const parent = path.resolve(__dirname, '../artifacts/unit-workspaces');
async function fixture(callback) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  try { await callback(root); }
  finally {
    const actual = await fs.realpath(root);
    assert.ok(actual.toLowerCase().startsWith(parent.toLowerCase() + path.sep));
    await fs.rm(actual, { recursive: true });
  }
}
test('paths stay within the selected project, including junctions', () => fixture(async root => {
  await assert.rejects(files.safePath(root, '../outside.txt'), /outside/);
  await assert.rejects(files.safePath(root, 'C:\\Windows\\win.ini'), /relative/);
  const outside = await fs.mkdtemp(path.join(parent, 'outside-'));
  try {
    await fs.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(files.safePath(root, 'escape/new.txt'), /outside/);
  } finally {
    const resolved = await fs.realpath(outside); assert.ok(resolved.startsWith(parent + path.sep));
    await fs.rm(resolved, { recursive: true });
  }
}));
test('new files are exclusive and edits can be undone without losing original bytes', () => fixture(async root => {
  await fs.writeFile(path.join(root, 'hello.py'), 'print("before")\n');
  await assert.rejects(files.writeFile(root, 'hello.py', '', undefined, true), /already exists/);
  const change = await files.replaceText(root, 'hello.py', 'before', 'after');
  assert.match(await fs.readFile(path.join(root, 'hello.py'), 'utf8'), /after/);
  assert.equal(change.additions, 1); assert.equal(change.deletions, 1);
  await files.undoChange(root, change);
  assert.equal(await fs.readFile(path.join(root, 'hello.py'), 'utf8'), 'print("before")\n');
  const created = await files.writeFile(root, 'nested/new.txt', 'new');
  await files.undoChange(root, created);
  await assert.rejects(fs.stat(path.join(root, 'nested/new.txt')), { code: 'ENOENT' });
}));
test('stale saves and stale undo cannot overwrite an external edit', () => fixture(async root => {
  const first = await files.writeFile(root, 'data.txt', 'first');
  await fs.writeFile(path.join(root, 'data.txt'), 'external');
  await assert.rejects(files.writeFile(root, 'data.txt', 'lost', first.afterHash), /changed on disk/);
  await assert.rejects(files.undoChange(root, first), /changed after/);
  assert.equal(await fs.readFile(path.join(root, 'data.txt'), 'utf8'), 'external');
}));
test('search returns real paths and line numbers', () => fixture(async root => {
  await fs.mkdir(path.join(root, 'src')); await fs.writeFile(path.join(root, 'src/test.py'), 'first\nneedle value\nlast\n');
  const matches = await files.searchText(root, 'NEEDLE');
  assert.deepEqual(matches, [{ path: 'src/test.py', line: 2, text: 'needle value' }]);
}));
test('projects, chat messages and preferences survive a store restart', () => fixture(async root => {
  const statePath = path.join(root, 'state'); const first = new Store(statePath);
  const project = first.addProject(root); const thread = first.createThread(project.id);
  thread.messages.push({ role: 'user', content: 'saved message' }); first.data.settings.theme = 'dark'; first.save();
  const second = new Store(statePath);
  assert.equal(second.thread(thread.id).messages[0].content, 'saved message');
  assert.equal(second.data.settings.theme, 'dark'); assert.equal(second.project(project.id).root, root);
}));
test('model endpoints stay local and compacted history keeps tool-call pairs valid', () => {
  assert.equal(endpointUrl('http://127.0.0.1:8088/v1', '/models'), 'http://127.0.0.1:8088/v1/models');
  assert.throws(() => endpointUrl('https://example.com/v1'), /localhost/);
  const history = [{ role: 'user', content: 'Make a file.' }];
  for (let i = 0; i < 8; i++) history.push(
    { role: 'assistant', content: null, tool_calls: [{ id: 'call-' + i, type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call-' + i, content: 'x'.repeat(7000) });
  const compact = compactMessages(history, 5000), pending = new Set();
  for (const message of compact) {
    for (const call of message.tool_calls || []) pending.add(call.id);
    if (message.role === 'tool') { assert.ok(pending.has(message.tool_call_id)); pending.delete(message.tool_call_id); }
  }
  assert.equal(pending.size, 0); assert.ok(JSON.stringify(compact).length < 10000);
});
test('commands report real output and nonzero exits', () => fixture(async root => {
  const command = process.platform === 'win32' ? "Write-Output 'BUJI_CORE_OK'; exit 7" : "printf 'BUJI_CORE_OK'; exit 7";
  const result = await runCommand(root, command);
  assert.match(result.output, /BUJI_CORE_OK/); assert.equal(result.exitCode, 7);
}));
test('long commands are terminated at the timeout', () => fixture(async root => {
  const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 20' : 'sleep 20';
  const result = await runCommand(root, command, { timeout: 1000 }); assert.equal(result.timedOut, true);
}));
test('legacy migration preserves old data and never overwrites current history', () => fixture(async root => {
  const legacy = path.join(root, 'legacy'), current = path.join(root, 'current');
  const previous = new Store(legacy); const thread = previous.createThread();
  thread.messages.push({ role: 'user', content: 'preserved chat' }); previous.save();
  assert.equal(migrateLegacyData(current, legacy), true);
  assert.equal(new Store(current).thread(thread.id).messages[0].content, 'preserved chat');
  const state = new Store(current); state.thread(thread.id).title = 'Current title'; state.save();
  assert.equal(migrateLegacyData(current, legacy), false);
  assert.equal(new Store(current).thread(thread.id).title, 'Current title');
  assert.equal(new Store(legacy).thread(thread.id).title, 'New chat');
}));
test('model transport refuses HTTP redirects before reaching another endpoint', async () => {
  const http = require('node:http'); let forwarded = 0;
  const receiver = http.createServer((_request, response) => { forwarded++; response.end('{"data":[]}'); });
  await new Promise(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const redirector = http.createServer((_request, response) => {
    response.writeHead(307, { location: `http://127.0.0.1:${receiver.address().port}/v1/models` }); response.end();
  });
  await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve));
  try {
    const result = await health({ endpoint: `http://127.0.0.1:${redirector.address().port}/v1`, model: 'test' });
    assert.equal(result.online, false); assert.equal(forwarded, 0);
  } finally { await Promise.all([new Promise(resolve => receiver.close(resolve)), new Promise(resolve => redirector.close(resolve))]); }
});
