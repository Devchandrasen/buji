const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Store } = require('../src/core/store.cjs');
const { Agent } = require('../src/core/agent.cjs');
const { taskRequirements } = require('../src/core/task.cjs');
const parent = path.resolve(__dirname, '../artifacts/agent-tests');
const text = content => ({ content });
const call = (name, args, id = name) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

async function fixture(responses, callback, approve = async () => true) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const delta = responses[requests.length - 1];
    if (!delta) { response.writeHead(500); response.end('Unexpected extra model request.'); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const projectRoot = path.join(root, 'project'); await fs.mkdir(projectRoot);
    const store = new Store(path.join(root, 'state'));
    store.data.settings.endpoint = `http://127.0.0.1:${server.address().port}/v1`;
    const project = store.addProject(projectRoot), thread = store.createThread(project.id);
    const agent = new Agent(store, () => {}, approve);
    await callback({ root: projectRoot, store, thread, agent, requests });
  } finally {
    await new Promise(resolve => server.close(resolve));
    const actual = await fs.realpath(root); assert.ok(actual.startsWith(parent + path.sep));
    await fs.rm(actual, { recursive: true });
  }
}

test('a natural build request recovers from a tutorial and a premature handoff, then really writes and runs', () => fixture([
  text('Here is the code. ```js\nthrow new Error("must not execute chat code")\n```'),
  call('write_file', { path: 'utility.js', content: "console.log('BUJI_ACTION_OK');\n" }),
  text('The file is ready. Run node utility.js yourself.'),
  call('run_command', { command: 'node utility.js', cwd: '.' }),
  text('Saved and checked the utility.')
], async ({ root, agent, thread, requests }) => {
  await agent.send({ threadId: thread.id, text: 'Can you help me build a Node utility that prints BUJI_ACTION_OK?', mode: 'agent' });
  assert.equal(await fs.readFile(path.join(root, 'utility.js'), 'utf8'), "console.log('BUJI_ACTION_OK');\n");
  const result = thread.messages.at(-1);
  assert.equal(result.work.status, 'completed'); assert.equal(result.work.verification, 'passed');
  const execution = thread.messages.find(m => m.name === 'run_command');
  assert.equal(execution.result.exitCode, 0); assert.match(execution.result.output, /BUJI_ACTION_OK/);
  assert.equal(requests[0].tool_choice, 'required');
  assert.deepEqual(requests[3].tool_choice, { type: 'function', function: { name: 'run_command' } });
  assert.equal(thread.messages.filter(m => m.role === 'assistant' && m.content.includes('yourself')).length, 0);
}));

test('a declined command stops later calls and recovery never bypasses that decision', () => {
  const multiple = call('run_command', { command: 'node utility.js' }, 'command');
  multiple.tool_calls.push({ ...call('write_file', { path: 'bypass.js', content: 'bad' }, 'bypass').tool_calls[0], index: 1 });
  return fixture([
    call('write_file', { path: 'utility.js', content: "console.log('safe');\n" }), multiple,
    text('Execution stopped.')
  ], async ({ root, agent, thread, requests }) => {
    await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'agent' });
    assert.equal(thread.messages.at(-1).work.status, 'declined');
    assert.equal(thread.messages.at(-1).work.verification, 'not-run');
    await assert.rejects(fs.access(path.join(root, 'bypass.js')), { code: 'ENOENT' });
    assert.equal(requests[2].tools, undefined);
    assert.ok(requests[2].messages.some(m => m.tool_call_id === 'bypass' && m.content.includes('stopped')));
  }, async () => false);
});

test('Chat mode keeps a code-only answer and does not mutate the project', () => fixture([
  text('Example only: <tool_call>{"name":"write_file","arguments":{"path":"example.js","content":"example"}}</tool_call>')
], async ({ root, agent, thread, requests }) => {
  await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'chat' });
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal(requests[0].tools, undefined); assert.equal(thread.messages.at(-1).work, undefined);
  assert.match(thread.messages.at(-1).content, /Example only: <tool_call>/);
}));

test('Sandbox writes project files, blocks command execution and reports checks as pending', () => fixture([
  call('write_file', { path: 'utility.js', content: "console.log('SANDBOX_FILE');\n" }),
  call('run_command', { command: 'node utility.js' }),
  text('File written.')
], async ({ root, store, agent, thread, requests }) => {
  store.data.settings.accessMode = 'sandbox';
  const project = store.project(thread.projectId);
  await assert.rejects(agent.execute(thread, project, {
    function: { name: 'run_command', arguments: '{"command":"node utility.js"}' }
  }), /PowerShell is disabled in Sandbox/);
  await agent.send({ threadId: thread.id, text: 'Build and test a Node utility.', mode: 'agent' });
  assert.equal(await fs.readFile(path.join(root, 'utility.js'), 'utf8'), "console.log('SANDBOX_FILE');\n");
  assert.ok(requests.every(request => request.tools.every(tool => tool.function.name !== 'run_command')));
  assert.ok(requests.every(request => typeof request.tool_choice !== 'object'));
  assert.ok(!thread.messages.some(message => message.name === 'run_command'));
  const result = thread.messages.at(-1);
  assert.equal(result.work.status, 'incomplete');
  assert.equal(result.work.verification, 'not-run');
  assert.match(result.content, /Full local access/);
}));

test('a model that still refuses to act gets a bounded incomplete result, never a false success', () => fixture([
  text('Here is a tutorial.'), text('Do the steps yourself.'), text('Done! Everything was built.')
], async ({ root, agent, thread, requests }) => {
  await agent.send({ threadId: thread.id, text: 'Build a Python game.', mode: 'agent' });
  assert.equal(requests.length, 3); assert.deepEqual(await fs.readdir(root), []);
  assert.equal(thread.messages.at(-1).work.status, 'incomplete');
  assert.match(thread.messages.at(-1).content, /could not finish/);
  assert.doesNotMatch(thread.modelMessages.at(-1).content, /Everything was built/);
}));

test('verification before a later edit does not count as verification of that edit', () => fixture([
  call('run_command', { command: 'node -v' }, 'before'),
  call('write_file', { path: 'utility.js', content: "console.log('AFTER_EDIT');\n" }),
  text('Finished.'), call('run_command', { command: 'node utility.js' }, 'after'), text('Finished and checked.')
], async ({ agent, thread }) => {
  await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'agent' });
  const result = thread.messages.at(-1).work;
  assert.equal(result.status, 'completed'); assert.equal(result.commands.length, 2);
  assert.equal(result.commands[1].command, 'node utility.js');
}));

test('Agent mode without a project fails clearly before contacting a model', () => fixture([], async ({ store, agent, requests }) => {
  const general = store.createThread();
  await assert.rejects(agent.send({ threadId: general.id, text: 'Build a Python game.', mode: 'agent' }), /Choose a project/);
  assert.equal(requests.length, 0);
}));

test('build intent covers ordinary English and Hinglish while preserving explicit explanation-only requests', () => {
  const context = ['Can you help me build a Python Tic Tac Toe game?'];
  assert.equal(taskRequirements('build it for me on my system', context).write, true);
  assert.equal(taskRequirements('run it', context).write, false);
  assert.equal(taskRequirements('run it', context).command, true);
  for (const request of ['can you help me build me a tic tac toe using python', 'Python game bana do', 'Create a Python script.']) {
    const intent = taskRequirements(request); assert.ok(intent.write && intent.command, request);
  }
  for (const request of ['hi', 'How do I build a Python game?', 'Just show me code for a Python game.', "Do not create files, explain the Python game."]) {
    assert.equal(taskRequirements(request).action, false, request);
  }
});

test('a truncated tool call is retried without storing or executing its arguments', () => {
  const broken = call('write_file', {}); broken.tool_calls[0].function.arguments = '{"path":"broken.js","content":"unfinished';
  return fixture([broken, call('write_file', { path: 'utility.js', content: "console.log('RECOVERED');\n" }),
    call('run_command', { command: 'node utility.js' }), text('Saved and checked.')], async ({ root, agent, thread }) => {
    await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'agent' });
    assert.equal(thread.messages.at(-1).work.status, 'completed');
    await assert.rejects(fs.access(path.join(root, 'broken.js')), { code: 'ENOENT' });
    for (const message of thread.modelMessages) for (const c of message.tool_calls || []) assert.doesNotThrow(() => JSON.parse(c.function.arguments));
  });
});

test('an invalid extra call cannot poison already saved and successfully checked work', () => {
  const broken = call('run_command', {}); broken.tool_calls[0].function.arguments = '{"command":"node utility.js","stdin":"unfinished';
  return fixture([call('write_file', { path: 'utility.js', content: "console.log('CHECKED');\n" }),
    call('run_command', { command: 'node utility.js' }), broken], async ({ agent, thread, requests }) => {
    await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'agent' });
    assert.equal(thread.messages.at(-1).work.status, 'completed');
    assert.equal(thread.messages.at(-1).work.commands.length, 1); assert.equal(requests.length, 3);
    assert.match(thread.messages.at(-1).content, /discarded without execution/);
    for (const message of thread.modelMessages) for (const c of message.tool_calls || []) assert.doesNotThrow(() => JSON.parse(c.function.arguments));
  });
});

test('a later failing check prevents a completed status despite an earlier passing check', () => fixture([
  call('write_file', { path: 'utility.js', content: "console.log('created');\n" }),
  call('run_command', { command: 'node utility.js' }), call('run_command', { command: 'node -e "process.exit(7)"' }),
  text('Done.'), text('Done.'), text('Done.')
], async ({ agent, thread }) => {
  await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'agent' });
  assert.equal(thread.messages.at(-1).work.status, 'incomplete');
  assert.equal(thread.messages.at(-1).work.verification, 'not-run');
}));

test('Research rejects a model-injected project write before touching the filesystem', () => fixture([
  call('write_file',{path:'injected.txt',content:'must not write'}),text('No sources were retrieved.')
],async({agent,store,thread,root,requests})=>{
  store.data.settings.accessMode='full';
  await agent.send({threadId:thread.id,text:'Find public information about Python.',mode:'agent',web:true});
  await assert.rejects(fs.access(path.join(root,'injected.txt')));
  assert.equal(thread.changes.length,0);
  assert.ok(requests[0].tools.every(tool=>!['write_file','read_file','run_command','computer_act'].includes(tool.function.name)));
  assert.equal(thread.messages.some(message=>message.role==='tool'),false);
  assert.match(requests[1].messages[0].content,/was not executed/);
}));

test('Sandbox rejects model-injected computer input even when other file tools are available', () => fixture([
  call('computer_act',{snapshot:'fake',element_id:1,action:'click'}),text('No action performed.')
],async({agent,store,thread,requests})=>{
  store.data.settings.accessMode='sandbox';
  await agent.send({threadId:thread.id,text:'Say hello.',mode:'agent'});
  assert.equal(thread.messages.some(message=>message.role==='tool'),false);
  assert.match(requests[1].messages[0].content,/was not executed/);
}));

test('computer tasks expose only app tools and require a post-input observation', () => fixture([
  call('computer_observe',{}),call('computer_act',{snapshot:'one',element_id:1,action:'type',text:'hello'}),call('computer_observe',{}),text('Updated and rechecked.')
],async({agent,store,thread,requests})=>{
  store.data.settings.accessMode='full';
  agent.computer={allowed:()=>true,observe:async()=>({snapshot:'one',app:'demo',elements:[{id:1,name:'Note'}]}),act:async()=>({performed:true,approved:true,action:'type',app:'demo'})};
  await agent.send({threadId:thread.id,text:'Type hello in the selected app.',mode:'agent'});
  assert.deepEqual(requests[0].tools.map(tool=>tool.function.name),['computer_observe','computer_act']);
  assert.equal(requests[0].max_tokens,700);
  assert.equal(thread.messages.at(-1).work.computer.observedAfterAction,true);
  assert.equal(thread.messages.at(-1).work.status,'completed');assert.equal(thread.changes.length,0);
}));

test('the tool-round limit produces an incomplete result card with the actual activity', () => fixture(
  Array.from({ length: 16 }, (_, i) => call('list_files', { path: '.' }, 'read-' + i)),
  async ({ agent, thread, requests }) => {
    await agent.send({ threadId: thread.id, text: 'Build a Node utility.', mode: 'agent' });
    assert.equal(requests.length, 16); assert.equal(thread.messages.at(-1).work.status, 'incomplete');
    assert.match(thread.messages.at(-1).content, /16-step limit/);
  }
));

test('three identical tool failures stop the turn with the real error and no false completion', () => fixture(
  Array.from({ length: 3 }, (_, i) => call('read_file', { path: 'missing.txt' }, 'missing-' + i)),
  async ({ agent, thread, requests }) => {
    await agent.send({ threadId: thread.id, text: 'Inspect missing.txt.', mode: 'agent' });
    assert.equal(requests.length, 3);
    assert.equal(thread.messages.at(-1).work.status, 'incomplete');
    assert.match(thread.messages.at(-1).content, /same tool error occurred 3 times.*ENOENT/);
    assert.equal(thread.changes.length, 0);
    assert.equal(agent.active.size, 0);
  }
));
