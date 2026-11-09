// Integration test of the real local model/controller against two explicitly selected QA windows.
// The QA reviewer permits only a fixed test note and read-only public-documentation navigation.
// Production uses main.cjs's human approval UI; this script is never packaged into the app.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Store}=require('../src/core/store.cjs');
const {VisionModel}=require('../src/core/vision.cjs');
const {ComputerAccess,WindowsWorker}=require('../src/core/computer.cjs');
const {runVisual}=require('../src/core/visual-agent.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts/visual-use/native-acceptance');
const [noteId,browserId]=process.argv.slice(2).map(Number);
if(!Number.isSafeInteger(noteId)||!Number.isSafeInteger(browserId))throw new Error('Supply the two window IDs observed in the desktop inventory.');
fs.mkdirSync(output,{recursive:true});
const vision=new VisionModel(path.resolve(root,'../../outputs/BujiVision/vision.json'));
const store=new Store(path.join(output,'profile'),{v2:true});
const results=[];
const expected='Buji visual acceptance 8 November 2026';

async function exercise(kind,windowId,task) {
  const reviews=[];let frame=0;const started=Date.now();
  const computer=new ComputerAccess({vision,
    worker:new WindowsWorker(path.join(root,'tools/computer-worker.ps1')),
    visualWorker:new WindowsWorker(path.join(root,'tools/visual-capture.py'),vision.config().python),
    approve:async(_thread,details)=>{
      assert.equal(details.visual,true);
      const allowed=kind==='note'?
        (details.action==='type'&&details.text===expected)||(['click','double_click'].includes(details.action)&&/note|save/i.test(details.target)):
        details.action==='click'&&/documentation|docs/i.test(details.target);
      reviews.push({action:details.action,target:details.target,x:details.x,y:details.y,text:details.text,key:details.key,approved:allowed,reviewer:'bounded QA allowlist'});
      console.log(kind+': '+details.action+' '+details.target+' '+(allowed?'allowed':'declined'));
      return allowed;
    },
    emit:event=>{
      if(event.type==='computer-observation'&&event.value.image) {
        const match=event.value.image.match(/^data:image\/(jpeg|png);base64,(.+)$/);
        fs.writeFileSync(path.join(output,kind+'-frame-'+String(++frame).padStart(2,'0')+'.'+(match[1]==='jpeg'?'jpg':'png')),Buffer.from(match[2],'base64'));
      }
    }});
  const thread=store.createThread();
  try {
    const target=(await computer.windows()).find(window=>window.id===windowId);
    assert.ok(target,'The supplied QA window is unavailable.');
    assert.ok(kind==='note'?target.process==='electron'&&target.title==='Buji Computer QA — local test note':target.process==='chrome'&&target.title==='Welcome to Python.org - Google Chrome','Unexpected QA window; no grant issued.');
    await computer.grant(thread.id,windowId,'visual');
    await runVisual({store,thread,project:null,text:task,computer,vision,signal:new AbortController().signal,emit(){}});
    const answer=thread.messages.findLast(message=>message.work);
    const result={kind,seconds:(Date.now()-started)/1000,status:answer.work.status,answer:answer.content,work:answer.work,frames:frame,reviews,tokensPerSecond:answer.tokensPerSecond,
      tools:thread.messages.filter(message=>message.role==='tool').map(message=>({name:message.name,arguments:JSON.parse(message.arguments),result:message.result}))};
    results.push(result);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
    fs.writeFileSync(path.join(output,kind+'-result.json'),JSON.stringify(result,null,2));
    assert.equal(answer.work.status,'completed',answer.content);
    assert.equal(answer.work.computer.observedAfterAction,true);
    assert.ok(reviews.some(review=>review.approved));
    if(kind==='note')assert.equal(fs.readFileSync(path.join(root,'artifacts/security-upgrade/computer-note.txt'),'utf8'),expected);
    console.log(kind+': '+answer.content);
  }finally{computer.stop();}
}
(async()=>{
  try {
    if(process.argv[4]!=='browser')await exercise('note',noteId,'In the selected note app, replace the Note field with exactly "'+expected+'" (without the quotes). Click Save note. Finish only after the screenshot shows Saved locally: computer-note.txt.');
    await exercise('browser',browserId,'In the selected Chrome window on Python.org, click Documentation in the blue main navigation menu, then report the main heading of the page that opens. Only read the public documentation; do not download or submit anything.');
    console.log(process.argv[4]==='browser'?'The real browser visual task passed.':'Both real visual tasks passed.');
  }catch(error){console.error(error.stack||String(error));process.exitCode=1;}
  finally{vision.stop();}
})();
