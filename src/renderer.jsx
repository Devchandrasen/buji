import React, { useState, useEffect, useRef, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, Settings, Folder, FolderOpen, MessageSquare, ArrowUp, Square, X, Minus,
  Maximize, Code, Terminal, PanelRight, Check, LoaderCircle, MoreHorizontal, Archive, Copy,
  Image, GitBranch, RotateCcw, FilePlus, SlidersHorizontal, Paperclip, FileCode, ChevronDown,
  ChevronRight, Zap, Play, Pencil, ArrowLeft, CircleHelp } from 'lucide-react';
import MarkdownIt from 'markdown-it';
import { EditorView, basicSetup } from 'codemirror';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';

const api = window.buji;
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const IconButton = ({ title, children, className = '', ...props }) => <button className={'icon-button ' + className} title={title} aria-label={title} {...props}>{children}</button>;
const Brand = ({ small = false }) => <div className={'brand-mark ' + (small ? 'small' : '')}><svg width={small ? 16 : 27} height={small ? 16 : 27} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4v16h6a4 4 0 0 0 0-8H7m0-8h5a4 4 0 0 1 0 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>;
const cleanError = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const summarize = thread => ({ id: thread.id, title: thread.title, projectId: thread.projectId,
  updatedAt: thread.updatedAt, createdAt: thread.createdAt, archived: thread.archived,
  changeCount: thread.changes?.filter(c => !c.reverted).length || 0 });
function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? minutes + 'm' : minutes < 1440 ? Math.floor(minutes / 60) + 'h' : Math.floor(minutes / 1440) + 'd';
}

const Message = memo(function Message({ message, onLink, onOpenFile, onOpenFolder, onReview }) {
  const [copied, setCopied] = useState(false);
  if (message.role === 'notice') return <div className="notice"><CircleHelp size={14}/>{message.content}</div>;
  if (message.role === 'tool') {
    let args = {}; try { args = JSON.parse(message.arguments || '{}'); } catch {}
    const labels = { list_files: 'Explore files', read_file: 'Read file', search_text: 'Search project',
      write_file: 'Write file', edit_file: 'Edit file', run_command: 'Run command' };
    const failed = message.status === 'error' || message.result?.timedOut || message.result?.cancelled || (message.result?.exitCode != null && message.result.exitCode !== 0);
    return <details className={'tool-row ' + (failed ? 'failed' : '')}>
      <summary>{message.status === 'running' ? <LoaderCircle size={14} className="spin"/> : failed ? <X size={14}/> : <Check size={14}/>}
        <span>{labels[message.name] || message.name}</span><code>{args.path || args.query || args.command || ''}</code><ChevronRight size={12}/></summary>
      <pre>{JSON.stringify(message.result || args, null, 2).slice(0, 14000)}</pre>
    </details>;
  }
  if (message.role === 'assistant' && !message.content && !message.streaming && !message.work) return null;
  const copy = async () => { await navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return <article className={'message ' + message.role}>
    {message.role === 'user' ? <div className="user-bubble">
      {!!message.contextFiles?.length && <div className="attached-files">{message.contextFiles.map(file => <span key={file}><FileCode size={12}/>{file}</span>)}</div>}
      {message.attachments?.map((image, index) => <img key={index} className="chat-image" src={image.dataUrl} alt={image.name}/>) }
      <div>{message.content}</div></div> : <>
      <div className="assistant-label"><Brand small/><span>Buji</span>{message.streaming && <span className="writing">working</span>}</div>
      {message.streaming ? <div className="stream-text">{message.content || <span className="thinking-dots">Thinking<span>…</span></span>}</div>
        : <div className="markdown" onClick={onLink} dangerouslySetInnerHTML={{ __html: md.render(message.content || '') }}/>}
      {message.work && <div className={'work-summary ' + message.work.status} data-testid="execution-summary">
        <div className="work-summary-heading"><Folder size={15}/><strong>{message.work.status === 'completed' ? 'Completed on your PC' : message.work.status === 'declined' ? 'Stopped · command declined' : 'Work incomplete'}</strong></div>
        <button className="work-folder" title="Open this folder in Windows Explorer" onClick={() => onOpenFolder(message.work.projectId)}><code>{message.work.root}</code><FolderOpen size={14}/></button>
        {!!message.work.files.length && <div className="work-files">{message.work.files.map(path => <button key={path} onClick={() => onOpenFile(path)}><FileCode size={12}/>{path}</button>)}</div>}
        {message.work.commands.map((command, index) => <div className="work-command" key={index}>{command.exitCode === 0 && !command.timedOut && !command.cancelled ? <Check size={13}/> : <CircleHelp size={13}/>}<code>{command.command}</code><span>{command.declined ? 'declined' : command.timedOut ? 'timed out' : command.cancelled ? 'cancelled' : 'exit ' + command.exitCode}</span></div>)}
        {!!message.work.files.length && <button className="review-work" onClick={onReview}>Review saved changes <ChevronRight size={12}/></button>}
      </div>}
      {!message.streaming && <div className="message-actions"><IconButton title={copied ? 'Copied' : 'Copy answer'} onClick={copy}>{copied ? <Check size={13}/> : <Copy size={13}/>}</IconButton>
        {message.tokensPerSecond > 0 && <span>{Math.round(message.tokensPerSecond)} tok/s</span>}
        {message.tokens > 0 && <span>{message.tokens} tokens</span>}</div>}
    </>}
  </article>;
});

function CodeEditor({ file, theme, onChange, onSave }) {
  const host = useRef(), view = useRef(), callbacks = useRef(); callbacks.current = { onChange, onSave };
  useEffect(() => {
    const extension = file.path.split('.').at(-1)?.toLowerCase();
    const language = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(extension) ? javascript({ jsx: extension.endsWith('x'), typescript: extension.startsWith('t') })
      : extension === 'py' ? python() : extension === 'json' ? json() : extension === 'html' ? html() : extension === 'css' ? css() : [];
    view.current = new EditorView({ doc: file.content, parent: host.current, extensions: [basicSetup, language,
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }]),
      EditorView.updateListener.of(update => { if (update.docChanged) callbacks.current.onChange(update.state.doc.toString()); }),
      EditorView.theme({ '&': { height: '100%', color: theme === 'dark' ? '#e0e1e5' : '#313331', backgroundColor: 'transparent' },
        '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: '12px', lineHeight: '1.8' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#969a94' },
        '.cm-activeLine': { backgroundColor: theme === 'dark' ? '#2c2e32' : '#f2f2ee' },
        '.cm-activeLineGutter': { backgroundColor: 'transparent' },
        '&.cm-focused': { outline: 'none' }, '.cm-content': { padding: '16px 0' } }, { dark: theme === 'dark' })] });
    return () => view.current?.destroy();
  }, [file.path, theme]);
  useEffect(() => {
    if (view.current && view.current.state.doc.toString() !== file.content)
      view.current.dispatch({ changes: { from: 0, to: view.current.state.doc.length, insert: file.content } });
  }, [file.content]);
  return <div ref={host} className="code-editor" data-testid="code-editor"/>;
}

function App() {
  const [projects, setProjects] = useState([]), [threads, setThreads] = useState([]), [settings, setSettings] = useState(null);
  const [thread, setThread] = useState(null), [projectId, setProjectId] = useState(null), [activeId, setActiveId] = useState(null);
  const [health, setHealth] = useState({ online: false, loading: true, message: 'Connecting to local model…' });
  const [mode, setMode] = useState('agent'), [input, setInput] = useState(''), [image, setImage] = useState(null), [contextFiles, setContextFiles] = useState([]);
  const [rightOpen, setRightOpen] = useState(false), [rightTab, setRightTab] = useState('files'), [tree, setTree] = useState([]), [collapsed, setCollapsed] = useState(new Set());
  const [file, setFile] = useState(null), [search, setSearch] = useState(''), [fileSearch, setFileSearch] = useState('');
  const [terminalOpen, setTerminalOpen] = useState(false), [terminal, setTerminal] = useState(''), [command, setCommand] = useState(''), [terminalId, setTerminalId] = useState(null);
  const [approval, setApproval] = useState(null), [modal, setModal] = useState(null), [preferences, setPreferences] = useState(null), [toast, setToast] = useState('');
  const [git, setGit] = useState({ branch: 'workspace', changed: 0 }), [projectMenu, setProjectMenu] = useState(false), [threadMenu, setThreadMenu] = useState(null);
  const [archivedChats, setArchivedChats] = useState(null);
  const currentId = useRef(null), live = useRef(), bottom = useRef(), textarea = useRef(), terminalBottom = useRef();
  live.current = { thread, projectId, file, activeId };
  const project = projects.find(p => p.id === projectId);
  const modelName = !settings?.model || settings.model === 'qwen3-personal-wsp' ? 'Qwen3 Personal WSP' : settings.model;
  const shortModelName = modelName === 'Qwen3 Personal WSP' ? 'Qwen3 Personal' : modelName;
  const busy = !!activeId;
  const notify = error => setToast(cleanError(error));
  const upsertSummary = value => setThreads(previous => [summarize(value), ...previous.filter(t => t.id !== value.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  function canLeaveEditor() {
    const current = live.current.file;
    return !current || current.content === current.saved || window.confirm('Discard unsaved editor changes?');
  }
  async function loadThread(id, alreadyConfirmed = false) {
    if (!alreadyConfirmed && !canLeaveEditor()) return;
    currentId.current = id; setFile(null); setContextFiles([]); setImage(null); setInput('');
    try { const value = await api.getThread(id); if (currentId.current === id) { setThread(value); setProjectId(value.projectId); } }
    catch (error) { notify(error); }
  }
  async function newThread(id = live.current.projectId, alreadyConfirmed = false) {
    if (!alreadyConfirmed && !canLeaveEditor()) return;
    try { const value = await api.createThread(id || null); upsertSummary(value); await loadThread(value.id, true); textarea.current?.focus(); }
    catch (error) { notify(error); }
  }
  async function openProject() {
    if (!canLeaveEditor()) return;
    try { const value = await api.chooseProject(); if (value) await newThread(value.id, true); }
    catch (error) { notify(error); }
  }
  async function refreshTree(id = live.current.projectId) {
    if (!id) return setTree([]);
    try { const value = await api.tree(id); if (live.current.projectId === id) setTree(value); }
    catch (error) { notify(error); }
  }
  useEffect(() => {
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'health') setHealth(event.value);
      if (event.type === 'snapshot') { setProjects(event.snapshot.projects); setThreads(event.snapshot.threads); }
      if (event.type === 'thread' || event.type === 'idle') {
        upsertSummary(event.thread);
        if (currentId.current === event.thread.id) setThread(event.thread);
        if (event.type === 'idle') { setActiveId(null); refreshTree(event.thread.projectId); }
      }
      if (event.type === 'message' && currentId.current === event.threadId) {
        setThread(value => value ? { ...value, messages: [...value.messages, event.message] } : value);
        if (event.message.role === 'tool' && event.message.name === 'run_command') {
          let args = {}; try { args = JSON.parse(event.message.arguments); } catch {}
          setTerminalOpen(true); setTerminal(value => (value + '\n> ' + (args.command || '') + '\n').slice(-60000));
        }
      }
      if (event.type === 'delta' && currentId.current === event.threadId)
        setThread(value => value ? { ...value, messages: value.messages.map(message => message.id === event.messageId ? { ...message, content: message.content + event.delta } : message) } : value);
      if (event.type === 'message-update' && currentId.current === event.threadId)
        setThread(value => value ? { ...value, messages: value.messages.map(message => message.id === event.message.id ? event.message : message) } : value);
      if (event.type === 'change') {
        if (currentId.current === event.threadId) setThread(value => value ? { ...value,
          changes: [...value.changes.filter(c => c.id !== event.change.id), event.change] } : value);
        refreshTree();
        const editor = live.current.file;
        if (currentId.current === event.threadId && (!editor || editor.content === editor.saved)) {
          setRightOpen(true); setRightTab('changes');
        }
        if (editor?.path === event.change.path && editor.content === editor.saved)
          setFile({ ...editor, content: event.change.after, saved: event.change.after, hash: event.change.afterHash });
      }
      if (event.type === 'approval') { setApproval(event.approval); }
      if (event.type === 'approval-closed') setApproval(value => value?.id === event.approvalId ? null : value);
      if (event.type === 'command-output' && event.threadId === currentId.current) setTerminal(value => (value + event.text).slice(-60000));
      if (event.type === 'terminal-start') { setTerminalId(event.terminalId); setTerminal(value => (value + '\n> ' + event.command + '\n').slice(-60000)); }
      if (event.type === 'terminal-output') setTerminal(value => (value + event.text).slice(-60000));
      if (event.type === 'terminal-end') { setTerminalId(null); setTerminal(value => value + `\n[exit ${event.result.exitCode}${event.result.timedOut ? ' · timed out' : ''}]\n`); }
    });
    api.bootstrap().then(value => {
      setProjects(value.projects); setThreads(value.threads); setSettings(value.settings); setHealth(value.health);
      if (value.threads.length) loadThread(value.threads[0].id);
      else setProjectId(value.projects[0]?.id || null);
    }).catch(notify);
    return unsubscribe;
  }, []);
  useEffect(() => { if (settings) document.documentElement.dataset.theme = settings.theme; }, [settings?.theme]);
  useEffect(() => { refreshTree(projectId); if (projectId) api.gitStatus(projectId).then(setGit).catch(() => {}); }, [projectId]);
  useEffect(() => {
    if (toast) { const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }
  }, [toast]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [thread?.messages.at(-1)?.content, thread?.messages.length, approval]);
  useEffect(() => { terminalBottom.current?.scrollIntoView({ block: 'end' }); }, [terminal]);
  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'n') { event.preventDefault(); newThread(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); saveFile(); }
      if (event.key === 'Escape') { setModal(null); setPreferences(null); setProjectMenu(false); setThreadMenu(null); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  async function send() {
    if (!input.trim() || busy || !thread) return;
    if (!health.online) return notify('Start your local model first.');
    const text = input; setInput(''); setActiveId(thread.id);
    const payload = { threadId: thread.id, text, mode: projectId ? mode : 'chat', attachments: image ? [image] : [], contextFiles };
    setImage(null); setContextFiles([]);
    try { await api.send(payload); }
    catch (error) { setActiveId(null); notify(error); }
  }
  async function startModel() {
    setHealth(value => ({ ...value, loading: true, message: 'Starting Qwen3…' }));
    try { setHealth(await api.startModel()); } catch (error) { setHealth({ online: false, message: cleanError(error) }); notify(error); }
  }
  async function openProjectFolder(id) {
    try { const error = await api.openProjectFolder(id); if (error) notify(error); }
    catch (error) { notify(error); }
  }
  async function openFile(relative) {
    const current = live.current.file;
    if (current?.content !== current?.saved && current?.path !== relative && !window.confirm('Discard unsaved editor changes?')) return;
    try {
      const value = await api.readFile(live.current.projectId, relative);
      setFile({ ...value, saved: value.content }); setRightOpen(true); setRightTab('files');
    } catch (error) { notify(error); }
  }
  async function saveFile() {
    const current = live.current.file, currentThread = live.current.thread;
    if (!current || !currentThread) return;
    try {
      const change = await api.saveFile(currentThread.id, current.path, current.content, current.hash);
      setFile(value => value?.path === current.path ? { ...value, saved: current.content, hash: change.afterHash } : value);
      setToast('Saved ' + current.path);
    } catch (error) { notify(error); }
  }
  async function runTerminal() {
    if (!command.trim() || terminalId || !projectId) return;
    const value = command; setCommand(''); setTerminalId('starting');
    try { await api.terminal({ projectId, command: value }); } catch (error) { setTerminalId(null); notify(error); }
  }
  function onLink(event) {
    const anchor = event.target.closest('a'); if (!anchor) return;
    event.preventDefault(); const target = anchor.getAttribute('href');
    if (/^https?:\/\//i.test(target)) api.external(target).catch(notify);
    else if (projectId && target && !target.startsWith('#')) openFile(decodeURIComponent(target));
  }
  const visibleThreads = threads.filter(t => !search || t.title.toLowerCase().includes(search.toLowerCase()));
  const changes = thread?.changes?.filter(change => !change.reverted) || [];
  const welcome = !thread?.messages.length;
  const selectProject = async value => {
    setProjectMenu(false);
    const recent = threads.find(t => t.projectId === value.id);
    if (recent) await loadThread(recent.id); else await newThread(value.id);
  };
  const renderThread = item => <div className={'thread-row ' + (item.id === thread?.id ? 'selected' : '')} key={item.id}>
    <button className="thread-select" onClick={() => loadThread(item.id)}><span>{item.title}</span>{activeId === item.id ? <LoaderCircle size={12} className="spin"/> : <small>{relativeTime(item.updatedAt)}</small>}</button>
    <button className="thread-more" aria-label={'Options for ' + item.title} onClick={() => setThreadMenu(threadMenu === item.id ? null : item.id)}><MoreHorizontal size={14}/></button>
    {threadMenu === item.id && <div className="popover thread-popover">
      <button onClick={() => { setModal({ type: 'rename', title: 'Rename chat', value: item.title, id: item.id }); setThreadMenu(null); }}><Pencil size={13}/>Rename</button>
      <button onClick={async () => { if (thread?.id === item.id && !canLeaveEditor()) return; try { const snapshot = await api.archiveThread(item.id); setThreads(snapshot.threads); setThreadMenu(null);
        if (thread?.id === item.id) { if (snapshot.threads.length) await loadThread(snapshot.threads[0].id, true); else await newThread(projectId, true); }
      } catch (error) { notify(error); } }}><Archive size={13}/>Archive</button>
    </div>}
  </div>;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand small/><strong>Buji</strong><span>V1</span></div>
      <div className="sidebar-actions"><button className="new-chat" onClick={() => newThread()}><Plus size={17}/>New chat<kbd>Ctrl N</kbd></button>
        <div className="chat-search"><Search size={14}/><input aria-label="Search chats" placeholder="Search chats" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button onClick={() => setSearch('')}><X size={12}/></button>}</div>
      </div>
      <div className="sidebar-scroll"><div className="section-heading">Projects<IconButton title="Open project" onClick={openProject}><Plus size={14}/></IconButton></div>
        {projects.map(item => <section className="project-section" key={item.id}>
          <div className={'project-row ' + (item.id === projectId ? 'current' : '')}><button onClick={() => selectProject(item)} title={item.root}><Folder size={15}/><span>{item.name}</span></button><IconButton title={'New chat in ' + item.name} onClick={() => newThread(item.id)}><Plus size={13}/></IconButton></div>
          <div className="project-threads">{visibleThreads.filter(t => t.projectId === item.id).slice(0, 12).map(renderThread)}</div>
        </section>)}
        <button className="open-project" onClick={openProject}><FolderOpen size={14}/>Open project folder</button>
        <div className="section-heading general-heading">Chats<IconButton title="New general chat" onClick={() => newThread(null)}><Plus size={14}/></IconButton></div>
        {visibleThreads.filter(t => !t.projectId).map(renderThread)}
        {!visibleThreads.length && <p className="sidebar-empty">No matching chats.</p>}
      </div>
      <div className="sidebar-bottom"><div className="local-avatar">B</div><div><strong>Personal workspace</strong><small><i className={health.online ? 'online' : 'offline'}/>{health.online ? 'Model connected' : health.loading ? 'Starting model' : 'Model offline'}</small></div><IconButton title="Settings" onClick={() => setPreferences({ ...settings })}><Settings size={16}/></IconButton></div>
    </aside>
    <div className="workspace-shell">
      <header className="topbar"><div className="topbar-left"><div className="project-picker"><button onClick={() => setProjectMenu(!projectMenu)}><Folder size={14}/>{project?.name || 'General chat'}<ChevronDown size={12}/></button>
        {projectMenu && <div className="popover project-popover">{projects.map(item => <button key={item.id} onClick={() => selectProject(item)}><Folder size={13}/>{item.name}{item.id === projectId && <Check size={13}/>}</button>)}<hr/><button onClick={() => { setProjectMenu(false); openProject(); }}><FolderOpen size={13}/>Open project…</button></div>}</div>
        <span className="top-divider"/><span className="chat-title">{thread?.title || 'New chat'}</span></div>
        <div className="topbar-actions"><button className={'view-button ' + (terminalOpen ? 'active' : '')} title="Toggle terminal" aria-label="Toggle terminal" onClick={() => setTerminalOpen(!terminalOpen)}><Terminal size={15}/></button>
          <button className={'view-button ' + (rightOpen ? 'active' : '')} title="Files and changes" aria-label="Files and changes" onClick={() => setRightOpen(!rightOpen)}><PanelRight size={15}/>{changes.length > 0 && <b>{changes.length}</b>}</button>
          <span className="window-divider"/><IconButton title="Minimize" onClick={() => api.window('minimize')}><Minus size={14}/></IconButton><IconButton title="Maximize" onClick={() => api.window('maximize')}><Maximize size={12}/></IconButton><IconButton title="Close window" className="window-close" onClick={() => api.window('close')}><X size={15}/></IconButton></div>
      </header>
      <div className="main-columns"><section className="conversation">
        <div className={'conversation-scroll ' + (welcome ? 'is-welcome' : '')}>
          {welcome ? <div className="welcome"><Brand/><div className="welcome-eyebrow">YOUR PERSONAL AI WORKBENCH</div><h1>What shall we work on?</h1><p>Code, understand, and work with your files.<br/>Your model. On your computer.</p>
            <div className="suggestions">{[
              { icon: Code, title: 'Build something', text: 'Create a small Python utility in this project and explain how to run it.' },
              { icon: Search, title: 'Understand this code', text: 'Explore the files in this project and explain how the code works.' },
              { icon: FileCode, title: 'Draft from files', text: 'Read the Markdown and text files in this project and write a concise project-brief.md with a summary and next steps. Use the file tools.' }
            ].map(item => <button key={item.title} onClick={() => { setInput(item.text); textarea.current?.focus(); }}><item.icon size={17}/><span>{item.title}</span><ChevronRight size={13}/></button>)}</div>
            <div className="welcome-status"><i className={health.online ? 'online' : 'offline'}/>{health.online ? modelName + ' is ready' : health.message}
              {!health.online && <button disabled={health.loading} onClick={startModel}>{health.loading ? <LoaderCircle size={12} className="spin"/> : <Play size={12}/>}Start model</button>}</div>
          </div> : <div className="messages">{thread.messages.map(message => <Message key={message.id} message={message} onLink={onLink} onOpenFile={openFile} onOpenFolder={openProjectFolder} onReview={() => { setRightOpen(true); setRightTab('changes'); }}/>) }
            {approval?.threadId === thread?.id && <div className="approval-card" data-testid="command-approval"><div><Terminal size={16}/><strong>Run this command?</strong></div><pre>{approval.command}</pre>{approval.input && <><small>Scripted standard input</small><pre>{approval.input}</pre></>}<small>PowerShell · {approval.cwd === '.' ? project?.name : approval.cwd}</small><div className="approval-buttons"><button onClick={() => api.approve(approval.id, false).catch(notify)}>Skip</button><button className="primary" onClick={() => api.approve(approval.id, true).catch(notify)}><Play size={12}/>Run command</button></div></div>}
            <div ref={bottom}/></div>}
        </div>
        <div className="composer-area"><div className="workspace-context">{project ? <><Folder size={12}/><span>{mode === 'agent' ? 'Working in' : 'Chat only in'} <strong>{project.name}</strong></span><button title={project.root} onClick={() => openProjectFolder(projectId)}>Open folder <FolderOpen size={12}/></button></> : <><MessageSquare size={12}/><span>Chat only · choose a project to build things on your PC</span><button onClick={openProject}>Choose folder</button></>}</div><div className={'composer ' + (busy ? 'busy' : '')}>
          {(image || contextFiles.length > 0) && <div className="composer-attachments">{image && <span><Image size={12}/>{image.name}<button onClick={() => setImage(null)}><X size={11}/></button></span>}{contextFiles.map(value => <span key={value}><FileCode size={12}/>{value}<button onClick={() => setContextFiles(contextFiles.filter(f => f !== value))}><X size={11}/></button></span>)}</div>}
          <textarea ref={textarea} aria-label="Message Buji" placeholder={project ? 'Ask Buji to build, fix, or explain…' : 'Ask anything…'} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} rows={3}/>
          <div className="composer-toolbar"><div><IconButton title="Attach image" onClick={async () => { try { const value = await api.chooseImage(); if (value) setImage(value); } catch (error) { notify(error); } }}><Plus size={18}/></IconButton>
            {file && <IconButton title="Attach open file" onClick={() => setContextFiles(previous => previous.includes(file.path) ? previous : [...previous, file.path].slice(0, 3))}><Paperclip size={15}/></IconButton>}
            <select aria-label="Chat mode" value={projectId ? mode : 'chat'} onChange={event => setMode(event.target.value)} disabled={!projectId || busy}><option value="agent">Agent</option><option value="chat">Chat</option></select>
            <span className="model-pill"><Zap size={12}/>{shortModelName}</span></div>
            <div><span className="local-pill"><i className={health.online ? 'online' : 'offline'}/>Local</span>{busy ? <button className="send-button stop" title="Stop reply" aria-label="Stop reply" onClick={() => api.cancel(activeId).catch(notify)}><Square size={13} fill="currentColor"/></button> : <button className="send-button" aria-label="Send message" disabled={!input.trim() || !thread || !health.online} onClick={send}><ArrowUp size={18}/></button>}</div></div>
        </div><div className="composer-caption"><span>{busy ? 'Buji is working in your workspace' : 'Enter to send · Shift + Enter for a new line'}</span><span>8K context</span></div></div>
        {terminalOpen && <section className="terminal-panel"><div className="panel-title"><span><Terminal size={13}/>Terminal <small>PowerShell · {project?.name || 'Select a project'}</small></span><div>{terminalId && <IconButton title="Stop command" onClick={() => api.cancelTerminal(terminalId).catch(notify)}><Square size={11}/></IconButton>}<IconButton title="Clear terminal" onClick={() => setTerminal('')}><RotateCcw size={12}/></IconButton><IconButton title="Close terminal" onClick={() => setTerminalOpen(false)}><X size={13}/></IconButton></div></div><pre aria-label="Terminal output">{terminal || 'Ready. Commands run in the selected project folder.\n'}<span ref={terminalBottom}/></pre><form className="terminal-input" onSubmit={event => { event.preventDefault(); runTerminal(); }}><span>❯</span><input aria-label="Terminal command" value={command} onChange={event => setCommand(event.target.value)} placeholder={projectId ? 'Run a PowerShell command…' : 'Open a project first'} disabled={!projectId || !!terminalId}/><button disabled={!command.trim() || !!terminalId}><ArrowUp size={13}/></button></form></section>}
      </section>
      {rightOpen && <aside className="right-panel"><div className="right-tabs"><button className={rightTab === 'files' ? 'active' : ''} onClick={() => setRightTab('files')}><Folder size={13}/>Files</button><button className={rightTab === 'changes' ? 'active' : ''} onClick={() => setRightTab('changes')}><FileCode size={13}/>Changes{changes.length > 0 && <b>{changes.length}</b>}</button><IconButton title="Close files panel" onClick={() => setRightOpen(false)}><X size={13}/></IconButton></div>
        {rightTab === 'files' ? <>
          <div className="explorer-heading"><span>{project?.name || 'No project'}</span><div><IconButton title="Refresh files" onClick={() => refreshTree()}><RotateCcw size={12}/></IconButton><IconButton title="New file" disabled={!projectId} onClick={() => setModal({ type: 'new-file', title: 'Create a file', value: '', placeholder: 'e.g. src/main.py' })}><FilePlus size={13}/></IconButton></div></div>
          <div className="file-filter"><Search size={12}/><input aria-label="Filter files" placeholder="Filter files" value={fileSearch} onChange={event => setFileSearch(event.target.value)}/></div>
          <div className={'file-tree ' + (file ? 'with-editor' : '')}>{tree.filter(entry => (!fileSearch || entry.path.toLowerCase().includes(fileSearch.toLowerCase())) && ![...collapsed].some(folder => entry.path.startsWith(folder + '/'))).map(entry => <button key={entry.path} title={entry.path} className={'file-row ' + (file?.path === entry.path ? 'selected' : '')} style={{ paddingLeft: 14 + entry.depth * 13 }} onClick={() => entry.directory ? setCollapsed(previous => { const next = new Set(previous); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; }) : openFile(entry.path)}>{entry.directory ? <>{collapsed.has(entry.path) ? <ChevronRight size={11}/> : <ChevronDown size={11}/>}<Folder size={13}/></> : <><span className="file-indent"/><FileCode size={13}/></>}<span>{entry.name}</span></button>)}{!projectId && <div className="panel-empty">Open a project to browse files.</div>}</div>
          {file && <div className="editor-section"><div className="editor-heading"><span title={file.path}><FileCode size={13}/>{file.path}{file.content !== file.saved && <i/>}</span><div><button className="save-file" disabled={file.content === file.saved} onClick={saveFile}>Save</button><IconButton title="Close editor" onClick={() => { if (file.content === file.saved || window.confirm('Discard unsaved editor changes?')) setFile(null); }}><X size={12}/></IconButton></div></div><CodeEditor file={file} theme={settings?.theme} onChange={content => setFile(previous => ({ ...previous, content }))} onSave={saveFile}/><div className="editor-footer"><span>{file.content.split('\n').length} lines</span><span>UTF-8</span></div></div>}
        </> : <div className="changes-panel">{changes.length ? changes.map(change => <section className="change-card" key={change.id}><div className="change-heading"><button onClick={() => openFile(change.path)}><FileCode size={13}/>{change.path}</button><span><b>+{change.additions}</b><em>−{change.deletions}</em></span><IconButton title={'Undo edit to ' + change.path} onClick={async () => { try { await api.undoChange(thread.id, change.id); refreshTree(); setFile(null); } catch (error) { notify(error); } }}><RotateCcw size={12}/></IconButton></div><pre>{change.patch.split('\n').slice(4).map((line, index) => <div key={index} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : line.startsWith('@@') ? 'hunk' : ''}>{line || ' '}</div>)}</pre></section>) : <div className="panel-empty"><Check size={22}/><strong>No changes yet</strong><p>Edits made by you or Qwen appear here, with a diff and undo.</p></div>}</div>}
      </aside>}
      </div>
      <footer className="statusbar"><span><GitBranch size={12}/>{git.branch}{git.changed > 0 && <span className="git-count">{git.changed} changed</span>}</span><span><i className={health.online ? 'online' : 'offline'}/>{health.online ? modelName + ' · local inference' : health.loading ? 'Loading model…' : 'Model offline'}<button onClick={() => setPreferences({ ...settings })}><SlidersHorizontal size={11}/></button></span></footer>
    </div>
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')}><X size={13}/></button></div>}
    {modal && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><form className="small-modal" onSubmit={async event => {
      event.preventDefault(); try {
        if (modal.type === 'rename') { const value = await api.renameThread(modal.id, modal.value); upsertSummary(value); if (thread?.id === value.id) setThread(value); }
        else { await api.createFile(thread.id, modal.value); await refreshTree(); await openFile(modal.value); }
        setModal(null);
      } catch (error) { notify(error); }
    }}><h2>{modal.title}</h2><input autoFocus aria-label={modal.title} placeholder={modal.placeholder} value={modal.value} onChange={event => setModal({ ...modal, value: event.target.value })}/><div className="modal-buttons"><button type="button" onClick={() => setModal(null)}>Cancel</button><button className="primary" disabled={!modal.value.trim()}>{modal.type === 'rename' ? 'Save title' : 'Create file'}</button></div></form></div>}
    {preferences && <div className="modal-overlay"><div className="settings-modal"><div className="settings-heading"><div><SlidersHorizontal size={19}/><h2>Settings</h2></div><IconButton title="Close settings" onClick={() => setPreferences(null)}><X size={17}/></IconButton></div><div className="settings-body"><h3>Local model</h3><p>Your chats and project context are sent to this localhost endpoint.</p><label>API endpoint<input value={preferences.endpoint} onChange={event => setPreferences({ ...preferences, endpoint: event.target.value })}/></label><label>Model ID<input value={preferences.model} onChange={event => setPreferences({ ...preferences, model: event.target.value })}/></label><label>Model launcher<div className="launcher-input"><input readOnly value={preferences.backendScript}/><button onClick={async () => { const value = await api.chooseBackendScript(); if (value) setPreferences({ ...preferences, backendScript: value }); }}>Browse</button></div></label><label className="toggle-setting"><span><strong>Start the model automatically</strong><small>Wake Qwen when you open Buji V1.</small></span><input type="checkbox" checked={preferences.autoStartModel} onChange={event => setPreferences({ ...preferences, autoStartModel: event.target.checked })}/></label><label className="toggle-setting"><span><strong>Review agent commands</strong><small>See the PowerShell command before it runs.</small></span><input type="checkbox" checked={preferences.approveCommands} onChange={event => setPreferences({ ...preferences, approveCommands: event.target.checked })}/></label><h3>Appearance</h3><label>Theme<select value={preferences.theme} onChange={event => setPreferences({ ...preferences, theme: event.target.value })}><option value="light">Light</option><option value="dark">Dark</option></select></label><details className="archived-chats" onToggle={event => { if (event.currentTarget.open) api.archivedThreads().then(setArchivedChats).catch(notify); }}><summary>Archived chats</summary>{archivedChats?.length ? archivedChats.map(item => <div key={item.id}><span>{item.title}</span><button onClick={async () => { try { const value = await api.restoreThread(item.id); setThreads(value.threads); setArchivedChats(previous => previous.filter(chat => chat.id !== item.id)); } catch (error) { notify(error); } }}>Restore</button></div>) : <p>No archived chats.</p>}</details><div className="data-folder"><span>Buji V1 · data stored locally</span><button onClick={() => api.openDataFolder()}>Open data folder</button></div></div><div className="settings-footer"><button onClick={startModel} disabled={health.loading}>{health.online ? <Check size={13}/> : <Play size={13}/>} {health.online ? 'Model connected' : 'Start model'}</button><button className="primary" onClick={async () => { try { const value = await api.saveSettings(preferences); setSettings(value); setPreferences(null); setHealth(await api.health()); } catch (error) { notify(error); } }}>Save settings</button></div></div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
