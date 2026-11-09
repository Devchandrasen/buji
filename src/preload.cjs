const { contextBridge, ipcRenderer } = require('electron');
const invoke = name => (...args) => ipcRenderer.invoke('buji:' + name, ...args);
contextBridge.exposeInMainWorld('buji', Object.freeze({
  bootstrap: invoke('bootstrap'), chooseProject: invoke('choose-project'), createThread: invoke('create-thread'),
  getThread: invoke('get-thread'), renameThread: invoke('rename-thread'), archiveThread: invoke('archive-thread'),
  archivedThreads: invoke('archived-threads'), restoreThread: invoke('restore-thread'),
  send: invoke('send'), cancel: invoke('cancel'), approve: invoke('approval'),
  securityStatus: invoke('security-status'), emergencyStop: invoke('emergency-stop'),
  computerWindows: invoke('computer-windows'), grantComputer: invoke('computer-grant'), stopComputer: invoke('computer-stop'), previewComputer: invoke('computer-preview'),
  lessons: invoke('lessons'), saveLesson: invoke('save-lesson'), removeLesson: invoke('remove-lesson'),
  saveJevKey: invoke('save-jev-key'), removeJevKey: invoke('remove-jev-key'),
  transcribeVoice: invoke('transcribe-voice'), cancelTranscription: invoke('cancel-transcription'),
  synthesizeVoice: invoke('synthesize-voice'), cancelSpeech: invoke('cancel-speech'),
  tree: invoke('tree'), readFile: invoke('read-file'), saveFile: invoke('save-file'), createFile: invoke('create-file'), undoChange: invoke('undo-change'),
  search: invoke('search'), gitStatus: invoke('git-status'), terminal: invoke('terminal'), cancelTerminal: invoke('cancel-terminal'),
  chooseImage: invoke('choose-image'), chooseBackendScript: invoke('choose-backend-script'),
  saveSettings: invoke('save-settings'), health: invoke('health'), startModel: invoke('start-model'),
  openDataFolder: invoke('open-data-folder'), openProjectFolder: invoke('open-project-folder'), window: invoke('window'), external: invoke('external'),
  onEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('buji:event', listener);
    return () => ipcRenderer.removeListener('buji:event', listener);
  }
}));
