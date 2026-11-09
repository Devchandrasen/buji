const test=require('node:test');
const assert=require('node:assert/strict');
const {applyProfile,validateConfig}=require('../tools/brain/profile.cjs');
const config={schema:1,profile:'deep-math-512',context:8192};
const math={name:'math-wsp'},original={name:'original'};
const request={model:'buji-v2-routed',messages:[{role:'user',content:'Calculate 17*24.'}],max_tokens:1800,stream:true};
test('a named-file preservation clause keeps a real build task actionable',()=>{
  const {taskRequirements}=require('../src/core/task.cjs');
  const build=taskRequirements('Read README.md, create stats.py, do not change README.md, then verify with Python.');
  assert.equal(build.write,true);assert.equal(build.command,true);
  const read=taskRequirements('Read config.json. Do not change config.json.');assert.equal(read.write,false);assert.equal(read.command,false);assert.equal(read.inspect,true);
  assert.equal(taskRequirements('Explain how to create stats.py. Do not change README.md.').action,false);
  assert.equal(taskRequirements('Read the project. Do not change any files.').write,false);
});
test('exact arithmetic handles clear Hindi/Hinglish/English numeric questions without floating point errors',()=>{
  const {arithmetic}=require('../tools/brain/arithmetic.cjs');
  for(const [question,answer] of [
    ['240 ka 15 percent kitna hai?','36'],
    ['What is 15% of 240?','36'],
    ['240 ka 15 percent kitna hai? Sirf number do.','36'],
    ['२४० का १५ प्रतिशत कितना है? केवल संख्या बताओ।','36'],
    ['What is 15% of 240? Reply with only the number.','36'],
    ['Calculate 17 * 24. Reply with only the number.','408'],
    ['Calculate 0.1 + 0.2. Reply with only the number.','0.3'],
    ['Compute -2.5 * 4. Reply only the number.','-10'],
    ['Calculate 1 / 3. Reply only the number.','1/3'],
    ['Calculate 999999999999999999 + 1. Reply only the number.','1000000000000000000']
  ])assert.equal(arithmetic(question)?.answer,answer,question);
  for(const question of ['Explain why 15% of 240 is36.','Write Python code for 17*24. Reply only the number.','Calculate 1/0. Reply only the number.','Calculate 2+3; process.exit(). Reply only the number.','What is 03/11/2026? Reply only the number.','03/11'])assert.equal(arithmetic(question),null,question);
});
test('deep math enables bounded thinking with zero adapters and preserves messages/streaming',()=>{
  const got=applyProfile(request,math,config);
  assert.equal(got.profile,'deep-math-512');assert.deepEqual(got.scales,[0,0]);
  assert.equal(got.body.reasoning_budget_tokens,512);assert.equal(got.body.reasoning_format,'deepseek');
  assert.equal(got.body.chat_template_kwargs.enable_thinking,true);assert.equal(got.body.max_tokens,1800);
  assert.equal(got.body.stream,true);assert.equal(got.body.messages,request.messages);
  assert.equal(request.chat_template_kwargs,undefined);
});
test('coding/reasoning requests retain the exact original generation body for every profile',()=>{
  const expected={...request,cache_prompt:false,lora:[{id:0,scale:0},{id:1,scale:0}]};
  for(const profile of ['current-wsp','original-fast','deep-math-256','deep-math-512','concise-original','concise-deep-256'])assert.deepEqual(applyProfile(request,original,{...config,profile}).body,expected);
});
test('math refinements never alter requests with tool capabilities or structured response constraints',()=>{
  for(const extra of [{tools:[{type:'function',function:{name:'write_file'}}]},{response_format:{type:'json_object'}}]) {
    const got=applyProfile({...request,...extra},math,config);
    assert.equal(got.profile,'current-wsp');assert.deepEqual(got.scales,[.5,.5]);assert.equal(got.body.reasoning_budget_tokens,undefined);
  }
});
test('explicit thinking-off and original-only control cannot be overridden by a refinement',()=>{
  for(const extra of [{reasoning_effort:'none'},{chat_template_kwargs:{enable_thinking:false}}])assert.equal(applyProfile({...request,...extra},math,config).body.reasoning_budget_tokens,undefined);
  const got=applyProfile(request,math,config,true);assert.equal(got.profile,'original-control');assert.deepEqual(got.scales,[0,0]);assert.equal(got.body.reasoning_budget_tokens,undefined);
});
test('configuration and output budgets remain bounded',()=>{
  assert.throws(()=>validateConfig({profile:'unknown'}));assert.throws(()=>validateConfig({context:262144}));assert.throws(()=>validateConfig({schema:2}));
  assert.equal(applyProfile({...request,max_tokens:100000},math,config).body.max_tokens,2304);
  assert.equal(applyProfile({...request,max_tokens:128},math,config).body.max_tokens,1536);
});
test('shipping gateway preserves streaming, announces the selected profile and rejects browser-origin calls',async()=>{
  const http=require('node:http');const {once}=require('node:events');const {gateway}=require('../tools/brain/gateway.cjs');
  const captured=[];const native=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;captured.push(JSON.parse(body));res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: {"choices":[{"delta":{"content":"6"}}]}\n\ndata: [DONE]\n\n');});
  native.listen(0,'127.0.0.1');await once(native,'listening');
  const proxy=gateway({nativePort:native.address().port,nativeApiKey:'unit-test-only',ready:()=>true,mathScales:[.5,.5],brainConfig:{schema:1,profile:'concise-original',context:8192}});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const url='http://127.0.0.1:'+proxy.address().port;
  try {
    const health=await(await fetch(url+'/health')).json();assert.equal(health.context,8192);
    const neuralRequest={...request,messages:[{role:'user',content:'Find x if 2*x + 3 = 15.'}]};
    const response=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(neuralRequest)});
    assert.equal(response.status,200);assert.equal(response.headers.get('x-buji-brain'),'concise-original');assert.match(await response.text(),/"content":"6"/);
    assert.equal(captured[0].stream,true);assert.equal(captured[0].messages.at(-1).content,neuralRequest.messages.at(-1).content);assert.deepEqual(captured[0].lora,[{id:0,scale:0},{id:1,scale:0}]);assert.match(captured[0].messages[0].content,/180 words/);
    const denied=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify(request)});
    assert.equal(denied.status,403);assert.equal(captured.length,1);
    const exact=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,messages:[{role:'user',content:'240 ka 15 percent kitna hai? Sirf number do.'}]})});
    assert.equal(exact.headers.get('x-buji-brain'),'exact-local-arithmetic');assert.match(await exact.text(),/"content":"36"/);assert.equal(captured.length,1,'exact arithmetic must not contact the model');
    const protectedCall=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,messages:[{role:'user',content:'Calculate 17 * 24. Reply only the number.'}],tools:[{type:'function',function:{name:'read_file'}}]})});
    await protectedCall.text();assert.equal(captured.length,2,'tool-capable calls remain on the model path');
  } finally {proxy.closeAllConnections();native.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>native.close(r))]);}
});
