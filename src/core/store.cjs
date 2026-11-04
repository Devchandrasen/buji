const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const id = () => crypto.randomUUID();

function migrateLegacyData(destination, legacyDirectory) {
  const target = path.join(destination, 'workspace.json');
  const legacy = path.join(legacyDirectory, 'workspace.json');
  if (fs.existsSync(target) || !fs.existsSync(legacy)) return false;
  const text = fs.readFileSync(legacy, 'utf8');
  const data = JSON.parse(text);
  if (!Array.isArray(data.projects) || !Array.isArray(data.threads) || !data.settings)
    throw new Error('The previous workspace format is not recognized. The original data was left intact.');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(target, text, { encoding: 'utf8', flag: 'wx' });
  return true;
}

class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.filename = path.join(directory, 'workspace.json');
    try { this.data = JSON.parse(fs.readFileSync(this.filename, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.copyFileSync(this.filename, this.filename + '.recovery-' + Date.now()); } catch {}
      }
      this.data = { version: 1, projects: [], threads: [], settings: {
        endpoint: 'http://127.0.0.1:8088/v1', model: 'qwen3-personal-wsp',
        backendScript: '', autoStartModel: true, approveCommands: true, theme: 'light' } };
    }
    this.data.settings = { approveCommands: true, autoStartModel: true, theme: 'light', ...this.data.settings };
  }
  save() {
    const temporary = this.filename + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temporary, this.filename);
  }
  addProject(root) {
    const real = fs.realpathSync(root);
    let project = this.data.projects.find(p => p.root.toLowerCase() === real.toLowerCase());
    if (!project) {
      project = { id: id(), name: path.basename(real), root: real, createdAt: Date.now() };
      this.data.projects.push(project); this.save();
    }
    return project;
  }
  project(projectId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found.');
    return project;
  }
  createThread(projectId = null) {
    if (projectId) this.project(projectId);
    const thread = { id: id(), projectId, title: 'New chat', createdAt: Date.now(),
      updatedAt: Date.now(), messages: [], modelMessages: [], changes: [], archived: false };
    this.data.threads.unshift(thread); this.save(); return thread;
  }
  thread(threadId) {
    const thread = this.data.threads.find(t => t.id === threadId);
    if (!thread) throw new Error('Chat not found.');
    return thread;
  }
  summaries() {
    return this.data.threads.filter(t => !t.archived).map(({ messages, modelMessages, changes, ...rest }) =>
      ({ ...rest, messageCount: messages.length, changeCount: changes.filter(c => !c.reverted).length }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  snapshot() { return { projects: this.data.projects, threads: this.summaries(), settings: this.data.settings }; }
}
module.exports = { Store, id, migrateLegacyData };
