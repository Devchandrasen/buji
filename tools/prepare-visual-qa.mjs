import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'artifacts/visual-use'),profile=path.join(output,'profile'),project=path.join(output,'demo');
await fs.mkdir(profile,{recursive:true});await fs.mkdir(project,{recursive:true});
await fs.writeFile(path.join(project,'README.md'),'# Visual computer-use acceptance\n\nDisposable local fixture.\n');
const time=Date.now();
await fs.writeFile(path.join(profile,'workspace.json'),JSON.stringify({version:1,lessons:[],settings:{
 endpoint:'http://127.0.0.1:8093/v1',model:'buji-v2-routed',accessMode:'full',approveCommands:true,autoStartModel:false,webEnabled:true,theme:'light',voiceLanguage:'auto',voiceReplyLanguage:'auto',voiceConversation:false
},projects:[{id:'visual-project',root:project,name:'visual-demo',createdAt:time}],threads:[{id:'visual-task',projectId:'visual-project',title:'New chat',createdAt:time,updatedAt:time,messages:[],modelMessages:[],changes:[],archived:false}]},null,2));
console.log('Prepared isolated visual acceptance profile.');
