/* Sample data for local visual QA. The packaged desktop app never loads this file. */
(() => {
  document.title = 'Buji V3 · Design preview · Sample data';
  const state = new URLSearchParams(location.search).get('state') || 'completed';
  const now = new Date('2026-11-08T10:24:00+05:30').getTime();
  const project = { id: 'demo', name: 'buji-demo', root: 'C:\\Buji-demo', createdAt: now };
  const before = 'def divide(a, b):\n    return a / b\n';
  let content = 'def divide(a, b):\n    if b == 0:\n        raise ValueError("Cannot divide by zero")\n    return a / b\n';
  const change = { id: 'change-demo', path: 'calculator.py', before, after: content, afterHash: 'sample', additions: 2, deletions: 0, reverted: state === 'undone', createdAt: now,
    patch: 'Index: calculator.py\n===================================================================\n--- calculator.py\n+++ calculator.py\n@@ -1,2 +1,4 @@\n def divide(a, b):\n+    if b == 0:\n+        raise ValueError("Cannot divide by zero")\n     return a / b\n' };
  let settings = { endpoint: 'http://127.0.0.1:8093/v1', model: 'buji-v2-routed', theme: state === 'dark' ? 'dark' : 'light', backendScript: '', autoStartModel: false,
    approveCommands: true, accessMode: 'full', voiceConversation: true, voiceLanguage: 'auto', voiceReplyLanguage: 'hinglish', voiceURI: '' };
  const health = { online: true, loading: false, model: 'buji-v2-routed', message: 'Design preview' };
  const commands = [{ command: 'pytest -q', exitCode: state === 'incomplete' ? 1 : state === 'declined' ? null : 0,
    declined: state === 'declined', summary: state === 'incomplete' ? '' : '3 passed' }];
  const thread = { id: 'demo-task', projectId: project.id, title: 'Calculator.py bug fix', createdAt: now, updatedAt: now, changes: [change], messages: state === 'empty' ? [] : [
    { id: 'request', role: 'user', content: 'Meri Python file ka bug fix karo.', createdAt: now },
    ...[['read_file', 'calculator.py', { path: 'calculator.py' }], ['edit_file', 'calculator.py', { written: true }], ['run_command', 'pytest -q', { exitCode: commands[0].exitCode, output: '3 passed' }]].map(([name, value, result], i) => ({
      id: `tool-${i}`, role: 'tool', name, arguments: JSON.stringify(name === 'run_command' ? { command: value } : { path: value }), status: 'done', result, createdAt: now })),
    { id: 'answer', role: 'assistant', content: state === 'incomplete' ? 'The check failed. The saved edit needs further work.' : state === 'declined' ? 'The command was declined. Verification was not completed.' : 'Bug fix ho gaya. Zero se divide karne par ab clear error milega.', createdAt: now,
      work: { status: ['incomplete', 'declined'].includes(state) ? state : 'completed', projectId: project.id, root: project.root, files: ['calculator.py'], changeIds: [change.id], commands,
        verification: ['incomplete', 'declined'].includes(state) ? 'not-run' : 'passed' } }
  ] };
  const threads = [thread, ...['Add tests for calculator', 'Improve error message', 'Refactor calculate() logic'].map((title, i) => ({ ...thread, id: `recent-${i}`, title, messages: [], changes: [] }))];
  let callback = () => {};
  let computer = {active:false};
  const emit = event => callback(event);
  const sampleOnly = async () => { throw new Error('This is a design preview with sample data. Use the Buji desktop app for local work.'); };
  window.buji = {
    bootstrap: async () => ({ projects: [project], threads, settings, health, voice: { ready: true, hindiReady: false }, jevConfigured: false }),
    onEvent: listener => { callback = listener; return () => { callback = () => {}; }; },
    securityStatus: async () => ({ events:[{id:'sample-event',kind:'tool',tool:'web_search',outcome:'done',time:new Date(now).toISOString()}],researchEnabled:settings.webEnabled !== false,computer,vision:{installed:true,model:'Qwen3-VL-2B-Instruct (sample)'},emergencyShortcut:'Ctrl+Alt+Shift+S' }),
    computerWindows: async () => [{id:42,pid:4242,process:'Buji Demo',title:'Sample application'}],
    grantComputer: async (threadId,windowId,mode) => { computer={active:true,mode,window:{id:42,process:'Buji Demo',title:'Sample application'},threadId,expiresAt:Date.now()+600000};emit({type:'computer-status',value:computer});return computer; },
    stopComputer: async () => { computer={active:false};emit({type:'computer-status',value:computer});return computer; },
    previewComputer: async () => {}, emergencyStop: async () => {computer={active:false};emit({type:'computer-status',value:computer});emit({type:'emergency-stop'});},
    getThread: async id => threads.find(value => value.id === id),
    createThread: async projectId => { const value = { id: crypto.randomUUID(), projectId, title: 'New task', changes: [], messages: [], createdAt: Date.now(), updatedAt: Date.now() }; threads.unshift(value); return value; },
    tree: async () => [{ path: 'calculator.py', name: 'calculator.py', depth: 0, directory: false }],
    readFile: async () => ({ path: 'calculator.py', content, hash: 'sample' }),
    gitStatus: async () => ({ branch: 'main', changed: change.reverted ? 0 : 1 }),
    undoChange: async () => { change.reverted = true; content = before; emit({ type: 'thread', thread }); return change; },
    health: async () => health, lessons: async () => [], archivedThreads: async () => [], saveSettings: async value => settings = value,
    renameThread: async (id, title) => { const value = threads.find(value => value.id === id); value.title = title; return value; },
    archiveThread: async id => ({ threads: threads.filter(value => value.id !== id) }),
    window: async () => {}, cancel: async () => {}, cancelSpeech: async () => {}, cancelTranscription: async () => {},
    chooseProject: sampleOnly, send: sampleOnly, saveFile: sampleOnly, createFile: sampleOnly, transcribeVoice: sampleOnly, synthesizeVoice: sampleOnly,
    openProjectFolder: sampleOnly, openDataFolder: sampleOnly, external: sampleOnly, startModel: async () => health
  };
  document.addEventListener('DOMContentLoaded', () => {
    const mark = () => { const bar = document.querySelector('.sidebar-bottom small'); if (bar) bar.textContent = 'Design preview · sample data'; };
    new MutationObserver(mark).observe(document.getElementById('root'), { childList: true });
    setTimeout(mark, 500);
  });
})();
