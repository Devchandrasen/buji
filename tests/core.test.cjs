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

test('listing and search use canonical relative paths when the project root is redirected', () => fixture(async root => {
  const actual = path.join(root, 'actual'), alias = path.join(root, 'alias');
  await fs.mkdir(path.join(actual, 'src'), { recursive: true });
  await fs.writeFile(path.join(actual, 'src/note.txt'), 'canonical needle\n');
  await fs.symlink(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual((await files.listFiles(alias)).map(file => file.path), ['src', 'src/note.txt']);
  assert.deepEqual(await files.searchText(alias, 'needle'), [{path:'src/note.txt',line:1,text:'canonical needle'}]);
  await assert.rejects(files.safePath(alias, '../outside.txt'), /outside/);
  await assert.rejects(files.listFiles(alias, '.', 2, 300, true), /different location/);
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
test('old malformed tool groups are removed only from model transport history', () => {
  const history = [{ role: 'user', content: 'Build it.' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'bad', type: 'function', function: { name: 'run_command', arguments: '{"command":"unfinished' } }] },
    { role: 'tool', tool_call_id: 'bad', content: '{"error":"invalid JSON"}' }, { role: 'user', content: 'Continue.' }];
  const before = JSON.stringify(history), compact = compactMessages(history);
  assert.equal(JSON.stringify(history), before);
  assert.ok(!compact.some(m => m.role === 'tool' || m.tool_calls));
  assert.ok(compact.some(m => m.content?.includes('malformed arguments')));
  assert.equal(compact.at(-1).content, 'Continue.');
});
test('scripted standard input reaches a real child program', () => fixture(async root => {
  await fs.writeFile(path.join(root, 'stdin.cjs'), "process.stdin.on('data', chunk => process.stdout.write(chunk.toString().toUpperCase()));\n");
  const result = await runCommand(root, 'node stdin.cjs', { input: 'alpha\nbeta\n' });
  assert.equal(result.exitCode, 0); assert.equal(result.output.replaceAll('\r\n', '\n'), 'ALPHA\nBETA\n');
  await assert.rejects(runCommand(root, 'node stdin.cjs', { input: 'x'.repeat(65537) }), /64 KiB/);
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

test('web lookups reject local destinations and mixed public-private DNS answers', async () => {
  const { publicUrl, publicAddress } = require('../src/core/web.cjs');
  for (const url of ['file:///C:/test.txt', 'http://example.org', 'https://localhost', 'https://2130706433',
    'https://[::ffff:127.0.0.1]', 'https://router.home.arpa', 'https://example.org:8443', 'https://name:password@example.org']) {
    assert.throws(() => publicUrl(url));
  }
  for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '172.31.0.1', '192.168.1.2', '100.64.2.3']) {
    await assert.rejects(publicAddress('test.example.org', async () => [{ address, family: 4 }]));
  }
  const publicIp = { address: '1.1.1.1', family: 4 };
  await assert.rejects(publicAddress('test.example.org', async () => [publicIp, { address: '127.0.0.1', family: 4 }]));
  assert.deepEqual(await publicAddress('test.example.org', async () => [publicIp]), publicIp);
});

test('saved lessons are scoped to the selected project or explicitly general', () => {
  const { addLesson, lessonPrompt } = require('../src/core/lessons.cjs');
  const shared = addLesson([], null, 'Use concise examples.');
  const privateNotes = addLesson(shared, 'project-one', 'Use the project test convention.');
  assert.match(lessonPrompt(privateNotes, 'project-one'), /project test convention/);
  assert.doesNotMatch(lessonPrompt(privateNotes, 'project-two'), /project test convention/);
  assert.match(lessonPrompt(privateNotes, null), /concise examples/);
  assert.equal(addLesson(privateNotes, 'project-one', 'Use the project test convention.').length, 2);
});

test('live weather questions route separately from encyclopedic and historical questions', () => {
  const { wantsWeather } = require('../src/core/web.cjs');
  assert.equal(wantsWeather('hi what is the weather today in dehradun?'), true);
  assert.equal(wantsWeather('Dehradun ka aaj ka mausam'), true);
  assert.equal(wantsWeather('देहरादून में आज मौसम कैसा है?'), true);
  assert.equal(wantsWeather('What is the difference between weather and climate?'), false);
  assert.equal(wantsWeather('Historical temperature data from Delhi in 1998'), false);
});

test('Jev uses the System One choice contract and handles a missing balance or an invalid choice', async () => {
  const { selectSource } = require('../src/core/jev.cjs');
  const sources = [{ title: 'First', snippet: 'Context A', url: 'https://example.org/first' },
    { title: 'Second', snippet: 'Context B', url: 'https://example.org/second' }];
  const mock = async (url, options) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.headers.Authorization, 'Bearer mock-jev-key');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.state, { public_search_query: 'public query' });
    assert.equal(body.model, 'jev-latest');
    assert.equal(body.questions.best_source.type, 'choice');
    assert.deepEqual(body.questions.best_source.criteria.source_2, { title: 'Second', snippet: 'Context B' });
    return Response.json({ model: 'jev-test', answers: { best_source: { type: 'choice', choice: 'source_2', confidence: .8 } }, usage: { input_tokens: 47 } });
  };
  assert.deepEqual(await selectSource('public query', sources, 'mock-jev-key', null, mock),
    { status: 'selected', index: 1, model: 'jev-test', confidence: .8, inputTokens: 47, title: 'Second' });
  assert.deepEqual(await selectSource('public query', sources, 'mock-jev-key', null, async () => new Response(null, { status: 402 })),
    { status: 'unavailable', httpStatus: 402 });
  assert.deepEqual(await selectSource('public query', sources, 'mock-jev-key', null, async () => Response.json({
    model: 'jev-test', answers: { best_source: { type: 'choice', choice: 'source_9', confidence: 1 } }, usage: { input_tokens: 47 }
  })), { status: 'unavailable' });
});

test('voice input accepts only a bounded mono PCM recording', () => {
  const { validateWave } = require('../src/core/voice.cjs');
  const bytes = Buffer.alloc(44 + 16000 * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  assert.equal(validateWave(bytes).length, bytes.length);
  const stereo = Buffer.from(bytes); stereo.writeUInt16LE(2, 22);
  assert.throws(() => validateWave(stereo), /mono 16 kHz PCM/);
  assert.throws(() => validateWave(Buffer.alloc(44 + 32000 * 61)), /between 0.3 and 60 seconds/);
  assert.throws(() => validateWave(bytes.subarray(0, bytes.length - 2)), /mono 16 kHz PCM/);
});

test('workspace results never turn saved-only or failed work into a verified result', () => {
  const { workPresentation } = require('../src/core/presentation.cjs');
  const work = { status: 'completed', files: ['calculator.py'], changeIds: ['a'], commands: [] };
  assert.equal(workPresentation(work).title, 'Saved · verification not run');
  assert.equal(workPresentation({ ...work, verification: 'passed' }).title, 'Saved · verification not run');
  for (const command of [{ exitCode: 1 }, { exitCode: 0, timedOut: true }, { exitCode: 0, cancelled: true }, { exitCode: 0, declined: true }]) {
    assert.notEqual(workPresentation({ ...work, verification: 'passed', commands: [command] }).tone, 'verified');
  }
  const checked = { ...work, verification: 'passed', commands: [{ exitCode: 0 }] };
  assert.equal(workPresentation(checked).title, 'Saved and verified');
  assert.notEqual(workPresentation({ ...checked, status: 'incomplete' }).tone, 'verified');
  assert.notEqual(workPresentation({ ...checked, verification: 'not-run' }).tone, 'verified');
  assert.equal(workPresentation(checked, [{ id: 'other', reverted: true }]).title, 'Saved and verified');
  const undone = workPresentation(checked, [{ id: 'a', reverted: true }]);
  assert.equal(undone.title, 'Changes undone'); assert.equal(undone.canOpen, false); assert.equal(undone.canUndo, false);
  assert.equal(workPresentation(checked, [{ id: 'a', reverted: false }]).canUndo, true);
});

test('task evidence preserves turn-specific undo IDs and only recognized check totals', () => {
  const { TaskProgress } = require('../src/core/task.cjs');
  const progress = new TaskProgress({ write: true, command: true });
  progress.record('edit_file', { path: 'calculator.py' }, { written: true, path: 'calculator.py', changeId: 'edit-a' });
  progress.record('run_command', { command: 'python -m pytest -q' }, { exitCode: 0, output: '...\n3 passed in 0.02s\n' });
  const saved = progress.snapshot({ id: 'project', root: 'test-root' }, 'completed');
  assert.deepEqual(saved.changeIds, ['edit-a']); assert.equal(saved.commands[0].summary, '3 passed');
  progress.record('edit_file', { path: 'calculator.py' }, { written: true, path: 'calculator.py', changeId: 'edit-b' });
  assert.equal(progress.snapshot({ id: 'project' }, 'incomplete').verification, 'not-run');
});
