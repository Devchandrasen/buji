const test=require('node:test');
const assert=require('node:assert/strict');
const {parseDecision}=require('../src/core/vision.cjs');
const {ComputerAccess}=require('../src/core/computer.cjs');
const {runVisual}=require('../src/core/visual-agent.cjs');

const image='data:image/jpeg;base64,UFJJVkFURV9TQ1JFRU4=';
const window={id:42,pid:987654,process:'chrome',title:'Disposable browser',started:'123'};
function fixture(approve=async()=>true) {
  const calls=[];let time=1000;
  const worker={stop(){},async request(action,args){calls.push({action,args});return action==='list'?{windows:[window]}:['observe','visual_observe'].includes(action)?{snapshot:'uia',window,elements:[],sensitive:false}:{performed:true};}};
  const visualWorker={stop(){},async request(action,args){calls.push({action,args});return action==='capture'?{snapshot:'pixels',image,width:800,height:600,rect:{left:10,top:10,width:800,height:600}}:{verified:true,rect:{left:10,top:10,width:800,height:600}};}};
  const vision={status:()=>({installed:true})};
  const computer=new ComputerAccess({worker,visualWorker,vision,approve,now:()=>time});
  return {computer,calls,worker,visualWorker,tick:n=>{time+=n;}};
}
const click={snapshot:'pixels',action:'click',target:'Search field',x:500,y:300};

test('vision output is inert JSON with bounded coordinates and known actions',()=>{
  assert.equal(parseDecision('{"action":"click","x":120,"y":400,"target":"Search"}').x,120);
  for(const text of ['{"action":"run_command","text":"bad"}','{"action":"click","x":1001,"y":1,"target":"Search"}','{"action":"type","x":0.2,"y":1,"target":"Search"}','not JSON'])assert.throws(()=>parseDecision(text));
});
test('visual input requires one matching reviewed snapshot and verifies pixels before native input',async()=>{
  let reviewed;
  const {computer,calls}=fixture(async(_thread,details)=>{reviewed=details;return true;});
  await computer.grant('task',42,'visual');const view=await computer.observe('task');
  assert.equal(view.image,image);assert.equal(view.mode,'visual');
  assert.equal((await computer.act('task',click)).performed,true);
  assert.equal(reviewed.image,image);assert.equal(reviewed.x,500);
  assert.deepEqual(calls.slice(-2).map(x=>x.action),['verify','visual_act']);
  await assert.rejects(computer.act('task',click),/stale/);
});
test('declined, expired, out-of-window, protected and changed visual targets never execute input',async()=>{
  const denied=fixture(async()=>false);await denied.computer.grant('a',42,'visual');await denied.computer.observe('a');
  assert.equal((await denied.computer.act('a',click)).approved,false);assert.equal(denied.calls.some(c=>c.action==='visual_act'),false);
  const setup=fixture();await setup.computer.grant('a',42,'visual');await setup.computer.observe('a');
  for(const change of [{x:-1},{target:'Send message'},{action:'key',key:'Win+R'},{action:'type',text:'javascript:alert(1)'}])await assert.rejects(setup.computer.act('a',{...click,...change}));
  setup.visualWorker.request=async()=>{throw new Error('The target changed after observation.');};
  await assert.rejects(setup.computer.act('a',click),/target changed/);assert.equal(setup.calls.some(c=>c.action==='visual_act'),false);
  await setup.computer.observe('a').catch(()=>{});setup.tick(90001);await assert.rejects(setup.computer.act('a',click),/stale/);
});
test('visual access revocation while a review is pending prevents pixel verification and input',async()=>{
  let release;const {computer,calls}=fixture(()=>new Promise(resolve=>{release=resolve;}));
  await computer.grant('a',42,'visual');await computer.observe('a');const pending=computer.act('a',click);computer.stop();release(true);
  await assert.rejects(pending,/ended/);assert.equal(calls.some(c=>c.action==='verify'||c.action==='visual_act'),false);
});
test('visible sensitive fields block visual capture before any screenshot is requested',async()=>{
  const {computer,worker,calls}=fixture();await computer.grant('a',42,'visual');
  worker.request=async()=>({window,snapshot:'uia',sensitive:true,elements:[]});
  await assert.rejects(computer.observe('a'),/Sensitive/);assert.equal(calls.some(c=>c.action==='capture'),false);
});
test('visual task sends the current screenshot only to vision and never stores pixels in chat history',async()=>{
  const thread={id:'task',title:'New chat',messages:[],modelMessages:[]};let saved='',observations=0,decisions=0;
  const store={save(){saved=JSON.stringify(thread);}};
  const computer={async observe(){observations++;return{snapshot:'pixels-'+observations,image,app:'demo',title:'Notes'};},async act(){return{performed:true,approved:true,action:'type',app:'demo'};}};
  const vision={async ensure(){},async decide(_task,view){assert.equal(view.image,image);return{decision:decisions++?{action:'done',summary:'Saved note visible.'}:{action:'type',x:300,y:300,target:'Note',text:'Test note'}};}};
  await runVisual({store,thread,project:{id:'project'},text:'Type Test note in the selected app.',computer,vision,emit(){},signal:new AbortController().signal});
  assert.equal(observations,2);assert.doesNotMatch(saved,/data:image|UFJJVkFURV9TQ1JFRU4/);
  const result=thread.messages.find(m=>m.work);assert.equal(result.work.status,'completed');assert.equal(result.work.computer.observedAfterAction,true);
});
test('vision cannot mark a mutation complete without an approved action',async()=>{
  const thread={id:'task',title:'New chat',messages:[],modelMessages:[]};
  await runVisual({store:{save(){}},thread,project:{id:'p'},text:'Click Save in the selected app.',computer:{async observe(){return{snapshot:'one',image,app:'demo'};}},vision:{async ensure(){},async decide(){return{decision:{action:'done',summary:'Done'}};}},emit(){},signal:new AbortController().signal});
  assert.equal(thread.messages.find(m=>m.work).work.status,'incomplete');
});

test('visual runner reobserves before repeating the same performed input',async()=>{
  const thread={id:'task',title:'New chat',messages:[],modelMessages:[]};let observations=0,actions=0,decisions=0;
  await runVisual({store:{save(){}},thread,project:{id:'p'},text:'Click Save note.',
    computer:{async observe(){observations++;return{snapshot:'s'+observations,image,app:'demo'};},async act(){actions++;return{performed:true,approved:true,action:'click',app:'demo'};}},
    vision:{async ensure(){},async decide(){return{decision:decisions++<2?{action:'click',x:140,y:700,target:'Save note'}:{action:'done',summary:'Saved visible.'}};}},emit(){},signal:new AbortController().signal});
  assert.equal(actions,1);assert.equal(observations,3);assert.equal(thread.messages.find(m=>m.work).work.status,'completed');
});

test('stopping a live computer session notifies its task once',async()=>{
  const {computer}=fixture();const stopped=[];computer.onStop=session=>stopped.push(session.threadId);
  await computer.grant('task',42,'visual');computer.stop('expired');computer.stop('again');assert.deepEqual(stopped,['task']);
});

test('a separate screen check ends an achieved goal before another action is proposed',async()=>{
  const thread={id:'task',title:'New chat',messages:[],modelMessages:[]};let decisions=0,actions=0;
  await runVisual({store:{save(){}},thread,project:null,text:'Click Documentation and report the heading.',
    computer:{async observe(){return{snapshot:'pixels',image,app:'chrome'};},async act(){actions++;return{performed:true,approved:true,action:'click',app:'chrome'};}},
    vision:{async ensure(){},async decide(){decisions++;return{decision:{action:'click',target:'Documentation',x:780,y:340}};},async verify(){return{satisfied:true,evidence:'Browse the docs online.'};}},emit(){},signal:new AbortController().signal});
  assert.equal(actions,1);assert.equal(decisions,1);assert.equal(thread.messages.find(m=>m.work).work.status,'completed');
});
test('a planning-model completion cannot override a negative screen outcome check',async()=>{
  const thread={id:'task',title:'New chat',messages:[],modelMessages:[]};let decisions=0;
  await runVisual({store:{save(){}},thread,project:null,text:'Click Save.',
    computer:{async observe(){return{snapshot:'pixels',image,app:'demo'};},async act(){return{performed:true,approved:true,action:'click',app:'demo'};}},
    vision:{async ensure(){},async decide(){return{decision:decisions++?{action:'done',summary:'Done'}:{action:'click',target:'Save',x:140,y:700}};},async verify(){return{satisfied:false,evidence:'Unsaved changes still visible.'};}},emit(){},signal:new AbortController().signal});
  const answer=thread.messages.find(m=>m.work);assert.equal(answer.work.status,'incomplete');assert.match(answer.content,/not verified/);
});
