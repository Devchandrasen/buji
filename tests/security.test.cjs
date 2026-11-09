const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ComputerAccess, validateWindow } = require('../src/core/computer.cjs');
const { SecurityLog, publicQuery, requirePublicFile } = require('../src/core/security.cjs');
const { parseSearch, searchWeb, publicUrl } = require('../src/core/web.cjs');
const { TaskProgress } = require('../src/core/task.cjs');

function fixture(approve = async () => true) {
  let clock = 1000;
  const calls = [];
  const window = { id: 42, pid: 987654, process: 'demo', title: 'Demo editor', started: '123' };
  const elements = [{ id: 1, name: 'Note', type: 'Edit', enabled: true }, { id: 2, name: 'Send', type: 'Button', enabled: true }, { id: 3, name: 'Password', password: true, enabled: true }];
  const worker = { stop: () => calls.push('stop'), request: async (action, args) => {
    calls.push({ action, args }); return action === 'list' ? { windows: [window] } : action === 'observe' ? { snapshot: 'snapshot', window, elements } : { performed: true };
  } };
  const computer = new ComputerAccess({ worker, approve, now: () => clock });
  return { computer, calls, tick: amount => { clock += amount; } };
}
const action = { snapshot: 'snapshot', element_id: 1, action: 'type', text: 'Hello from Buji' };

test('computer access is off by default, tied to one chat and consumes a snapshot after one action', async () => {
  const { computer, calls } = fixture();
  await assert.rejects(computer.observe('a'), /Enable computer access/);
  await computer.grant('a',42);
  await assert.rejects(computer.observe('b'), /this chat/);
  await computer.observe('a');
  const result = await computer.act('a', action, new AbortController().signal);
  assert.equal(result.performed, true);
  await assert.rejects(computer.act('a', action), /stale/);
  assert.equal(calls.filter(call => call.action === 'act').length, 1);
});
test('expired and stale observations never reach the input worker', async () => {
  const { computer, calls, tick } = fixture();
  await computer.grant('a',42); await computer.observe('a'); tick(45001);
  await assert.rejects(computer.act('a', action), /stale/);
  tick(600000); await assert.rejects(computer.observe('a'), /Enable/);
  assert.equal(calls.filter(call => call.action === 'act').length, 0);
});
test('decline, revocation during review and cancellation do not execute computer input', async () => {
  const denied = fixture(async () => false);
  await denied.computer.grant('a',42); await denied.computer.observe('a');
  assert.equal((await denied.computer.act('a',action)).approved, false);
  assert.equal(denied.calls.filter(call => call.action === 'act').length,0);
  let release;
  const revoked = fixture(() => new Promise(resolve => { release=resolve; }));
  await revoked.computer.grant('a',42); await revoked.computer.observe('a');
  const pending = revoked.computer.act('a',action); revoked.computer.stop(); release(true);
  await assert.rejects(pending,/ended/);
  assert.equal(revoked.calls.filter(call => call.action === 'act').length,0);
});
test('password controls, external submission controls, unknown elements and forbidden shortcuts are blocked before approval', async () => {
  let approvals=0; const {computer,calls}=fixture(async()=>{approvals++;return true;});
  await computer.grant('a',42); await computer.observe('a');
  for (const args of [{...action,element_id:3},{...action,element_id:2,action:'click'},{...action,element_id:999},{...action,action:'key',key:'Win+R'}]) await assert.rejects(computer.act('a',args));
  assert.equal(approvals,0);assert.equal(calls.filter(call=>call.action==='act').length,0);
  assert.throws(()=>validateWindow({id:3,pid:123,process:'powershell',title:'Terminal'}));
  assert.throws(()=>validateWindow({id:3,pid:123,process:'browser',title:'Sign in'}));
});
test('computer task evidence requires an observation after the last input', () => {
  const progress = new TaskProgress({computer:'act'});
  progress.record('computer_observe',{}, {snapshot:'a',app:'demo'});
  assert.ok(progress.missing().length);
  progress.record('computer_act',{}, {performed:true,approved:true,action:'type',app:'demo'});
  assert.ok(progress.missing().length);
  progress.record('computer_observe',{}, {snapshot:'b',app:'demo'});
  assert.deepEqual(progress.missing(),[]);
  assert.equal(progress.snapshot({id:'p'},'completed').computer.observedAfterAction,true);
});
test('public research rejects credentials and signed private URLs while allowing public technical queries', () => {
  assert.equal(publicQuery('Python pathlib site:docs.python.org'),'Python pathlib site:docs.python.org');
  assert.throws(()=>publicQuery('api_key=very-private-token-value'));
  assert.throws(()=>publicUrl('https://example.org/?access_token=private'));
  for (const file of ['.env','.env.production','.ssh/id_rsa','config/private.pem','.git/config']) assert.throws(()=>requirePublicFile(file));
  for (const file of ['.env.example','src/core/security.cjs','config/system.js','README.md']) assert.doesNotThrow(()=>requirePublicFile(file));
});
test('search parses real public result links, rejects local URLs, honors site filters and reports provider failure', async () => {
  const html = '<a class="result-link" href="https://docs.python.org/3/library/pathlib.html">Python pathlib</a><td class="result-snippet">Official filesystem docs</td><a class="result-link" href="https://localhost/admin">Local</a>';
  assert.equal(parseSearch(html,'DuckDuckGo Lite').length,1);
  const rss='<rss><item><title>Python docs</title><link>https://docs.python.org/3/</link><description>Python language</description></item></rss>';
  assert.equal(parseSearch(rss,'Bing')[0].url,'https://docs.python.org/3/');
  const result=await searchWeb('pathlib site:docs.python.org',null,async()=>({body:html}));
  assert.equal(result.provider,'DuckDuckGo Lite');assert.equal(result.sources.length,1);
  const empty=await searchWeb('a public query',null,async()=>({body:'captcha challenge'}));
  assert.equal(empty.sources.length,0);assert.equal(empty.attempts.length,3);assert.match(empty.error,/No challenge was bypassed/);
});
test('security audit excludes command bodies, typed text and screenshots', async () => {
  const root=path.resolve(__dirname,'../artifacts/security-tests');await fs.mkdir(root,{recursive:true});
  const directory=await fs.mkdtemp(path.join(root,'log-'));const log=new SecurityLog(directory);
  log.record('computer-action','approved',{action:'type',app:'demo',text:'PRIVATE_NOTE',command:'PRIVATE_COMMAND',image:'PRIVATE_SCREEN',reason:'password=really-private-value'});
  const raw=await fs.readFile(log.file,'utf8');assert.doesNotMatch(raw,/PRIVATE_NOTE|PRIVATE_COMMAND|PRIVATE_SCREEN|really-private-value/);
  assert.equal(log.recent().length,1);
});

test('superseded app snapshots leave model context without dropping the latest observed controls', () => {
  const { computerHistory } = require('../src/core/agent.cjs');
  const messages=[{role:'assistant',tool_calls:[{id:'old',function:{name:'computer_observe'}}]},
    {role:'tool',tool_call_id:'old',content:'OLD_SNAPSHOT_PRIVATE_TEXT'},
    {role:'assistant',tool_calls:[{id:'latest',function:{name:'computer_observe'}}]},
    {role:'tool',tool_call_id:'latest',content:'LATEST_SNAPSHOT'}];
  const history=computerHistory(messages);
  assert.doesNotMatch(JSON.stringify(history),/OLD_SNAPSHOT_PRIVATE_TEXT/);
  assert.equal(history.at(-1).content,'LATEST_SNAPSHOT');
  assert.equal(messages[1].content,'OLD_SNAPSHOT_PRIVATE_TEXT');
});

test('page reading selects relevant deep passages instead of only the page introduction', () => {
  const {selectPassages}=require('../src/core/web.cjs');
  const document='General introduction.\n'.repeat(600)+'\nPath.exists returns True when the path exists and False otherwise.\n'+'Unrelated appendix.\n'.repeat(500);
  const excerpt=selectPassages(document,'Python Path.exists return value');
  assert.match(excerpt,/Path.exists returns True/);assert.ok(excerpt.length<=4500);
});

test('local context overflow retries with less tool history while preserving the current user request', async () => {
  const http=require('node:http');const {complete}=require('../src/core/model.cjs');const requests=[];
  const server=http.createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;requests.push(JSON.parse(body));
    if(requests.length===1){response.writeHead(400);response.end('{"error":{"message":"request exceeds the available context size"}}');return;}
    response.writeHead(200,{'Content-Type':'text/event-stream'});response.end('data: '+JSON.stringify({choices:[{delta:{content:'Recovered locally'}}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const result=await complete({endpoint:`http://127.0.0.1:${server.address().port}/v1`,model:'test'},[
      {role:'system',content:'Keep tools scoped.'},{role:'user',content:'CURRENT USER REQUEST'},
      {role:'assistant',tool_calls:[{id:'call',type:'function',function:{name:'read_file',arguments:'{}'}}]},
      {role:'tool',tool_call_id:'call',content:'large output '.repeat(1500)}],[],new AbortController().signal,()=>{}, {maxTokens:700});
    assert.equal(result.content,'Recovered locally');assert.equal(requests.length,2);
    assert.ok(JSON.stringify(requests[1].messages).length<JSON.stringify(requests[0].messages).length);
    assert.equal(requests[1].messages.find(message=>message.role==='user').content,'CURRENT USER REQUEST');
    assert.equal(requests[1].messages[0].content,'Keep tools scoped.');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
