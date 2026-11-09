import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'artifacts/security-upgrade');
const profile = path.join(output, 'profile');
const project = path.join(output, 'security-demo');
await fs.mkdir(profile,{recursive:true}); await fs.mkdir(project,{recursive:true});
await fs.writeFile(path.join(project,'README.md'),'# Security QA\n\nA disposable project for local acceptance checks.\n');
await fs.writeFile(path.join(project,'.env'),'BUJI_TEST_SECRET=not-a-real-credential\n');
const now=Date.now();
await fs.writeFile(path.join(profile,'workspace.json'),JSON.stringify({version:1,lessons:[],settings:{
  endpoint:'http://127.0.0.1:8093/v1',model:'buji-v2-routed',backendScript:path.resolve(root,'../../outputs/BujiV2-Router/Start-Buji-V2-Backend.ps1'),
  autoStartModel:false,approveCommands:true,accessMode:'full',webEnabled:true,voiceLanguage:'auto',voiceReplyLanguage:'auto',voiceConversation:true,voiceURI:'',theme:'light'
},projects:[{id:'security-qa-project',root:project,name:'security-demo',createdAt:now}],threads:[{id:'security-qa-thread',projectId:'security-qa-project',title:'Security upgrade validation',createdAt:now,updatedAt:now,messages:[],modelMessages:[],changes:[],archived:false}]},null,2));
console.log('Prepared isolated security QA profile.');
