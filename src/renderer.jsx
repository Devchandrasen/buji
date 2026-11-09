import React, { useState, useEffect, useRef, memo } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Search, Settings, Folder, FolderOpen, MessageSquare, ArrowUp, Square, X, Minus,
  Maximize, Code, Terminal, PanelRight, Check, LoaderCircle, MoreHorizontal, Archive, Copy,
  Image, GitBranch, RotateCcw, FilePlus, SlidersHorizontal, Paperclip, FileCode, ChevronDown,
  ChevronRight, Zap, Play, Pencil, ArrowLeft, CircleHelp, Globe, Volume2, VolumeX,
  UserRound, Monitor, ShieldCheck, Shield, Send, Layers, PanelLeft } from 'lucide-react';
import { VoiceInput, useLocalSpeech } from './voice.jsx';
import { WorkResult } from './work-result.jsx';
import { SecurityPanel, ComputerApproval } from './security-panel.jsx';
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
const Brand = ({ small = false }) => <img className={'brand-mark ' + (small ? 'small' : '')} src="buji.png" alt=""/>;
const messageTime = value => value ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value) : '';
const cleanError = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const summarize = thread => ({ id: thread.id, title: thread.title, projectId: thread.projectId,
  updatedAt: thread.updatedAt, createdAt: thread.createdAt, archived: thread.archived,
  changeCount: thread.changes?.filter(c => !c.reverted).length || 0 });

function conversationMessages(messages = []) {
  const turns = [];
  for (const message of messages) {
    if (message.role === 'user' || !turns.length) turns.push([]);
    turns.at(-1).push(message);
  }
  return turns.flatMap(turn => {
    const result = turn.findLast(message => message.role === 'assistant' && message.work && !message.streaming);
    if (!result) return turn;
    const activity = turn.filter(message => message.role === 'tool');
    return turn.filter(message => message.role !== 'tool').map(message => message === result ? { ...message, activity } : message);
  });
}

function JevSettings({ configured, onChange, notify }) {
  const [key, setKey] = useState(''), [saving, setSaving] = useState(false);
  async function update(remove) {
    setSaving(true);
    try { onChange(await (remove ? api.removeJevKey() : api.saveJevKey(key))); setKey(''); }
    catch (error) { notify(error); }
    finally { setSaving(false); }
  }
  return <>
    <h3>TypeSafe Jev</h3>
    <p>{configured ? 'API key saved with Windows encryption. ' : ''}Optional paid source selection. Each use is enabled in the Web composer.</p>
    <label>TypeSafe API key<input type="password" value={key} autoComplete="off" onChange={event => setKey(event.target.value)} /></label>
    <div className="jev-key-actions">
      <button disabled={saving || !key.trim()} onClick={() => update(false)}>Save TypeSafe key</button>
      {configured && <button disabled={saving} onClick={() => update(true)}>Remove TypeSafe key</button>}
    </div>
  </>;
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? minutes + 'm' : minutes < 1440 ? Math.floor(minutes / 60) + 'h' : Math.floor(minutes / 1440) + 'd';
}

const Message = memo(function Message({ message, changes, onUndo, onLink, onOpenFile, onOpenFolder, onReview, onTeach, onSpeak, onStopSpeaking, speaking, speechEnabled }) {
  const [copied, setCopied] = useState(false);
  if (message.role === 'notice') return <div className="notice"><CircleHelp size={14}/>{message.content}</div>;
  if (message.role === 'tool') {
    let args = {}; try { args = JSON.parse(message.arguments || '{}'); } catch {}
    const labels = { list_files: 'Explore files', read_file: 'Read file', search_text: 'Search project',
      write_file: 'Write file', edit_file: 'Edit file', run_command: 'Run command', web_search: 'Search the internet', web_fetch: 'Read webpage', weather_lookup: 'Check live weather', computer_observe: 'Inspect selected app', computer_act: 'App action' };
    const failed = message.status === 'error' || message.result?.timedOut || message.result?.cancelled || (message.result?.exitCode != null && message.result.exitCode !== 0);
    return <details className={'tool-row ' + (failed ? 'failed' : '')}>
      <summary>{message.status === 'running' ? <LoaderCircle size={14} className="spin"/> : failed ? <X size={14}/> : <Check size={14}/>}
        <span>{labels[message.name] || message.name}</span><code>{args.path || args.query || args.command || args.url || args.location || ''}</code><ChevronRight size={12}/></summary>
      <pre>{JSON.stringify(message.result || args, null, 2).slice(0, 14000)}</pre>
    </details>;
  }
  if (message.role === 'assistant' && !message.content && !message.streaming && !message.work) return null;
  const copy = async () => { await navigator.clipboard.writeText(message.content); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return <article className={'message ' + message.role}>
    {message.role === 'user' ? <><div className="user-label"><UserRound size={22}/><strong>You</strong><time>{messageTime(message.createdAt)}</time></div><div className="user-bubble">
      {message.web && <div className="web-bubble-label"><Globe size={12}/>Web research</div>}
      {!!message.contextFiles?.length && <div className="attached-files">{message.contextFiles.map(file => <span key={file}><FileCode size={12}/>{file}</span>)}</div>}
      {message.attachments?.map((image, index) => <img key={index} className="chat-image" src={image.dataUrl} alt={image.name}/>) }
      <div>{message.content}</div></div></> : <>
      <div className="assistant-label"><Brand small/><span>Buji</span><time>{messageTime(message.createdAt)}</time>{message.streaming && <span className="writing">working</span>}</div>
      {message.streaming ? <div className="stream-text">{message.content || <span className="thinking-dots">Thinking<span>…</span></span>}</div>
        : <div className="markdown" onClick={onLink} dangerouslySetInnerHTML={{ __html: md.render(message.content || '') }}/>}
      {message.activity?.length > 0 && <div className="task-activity" aria-label="Recorded activity">{message.activity.map(entry => <Message key={entry.id} message={entry}/>)}</div>}
      {!!message.sources?.length && <div className="web-sources" onClick={onLink}>
        <strong>Sources</strong><ul>{message.sources.map(source => <li key={source.url}><a href={source.url}>{source.title}</a><small title={source.fetchedAt ? 'Retrieved ' + new Date(source.fetchedAt).toLocaleString() : undefined}>{source.provider ? source.provider + ' · ' : ''}{source.evidence === 'page' ? 'Page read' : 'Search result'}</small></li>)}</ul>
      </div>}
      {message.jev && <div className="jev-result">{message.jev.status === 'selected'
        ? `Jev prioritized ${message.jev.title} · ${Math.round(message.jev.confidence * 100)}% confidence · ${message.jev.inputTokens} input tokens`
        : message.jev.status === 'unavailable' ? `Jev unavailable${message.jev.httpStatus ? ` (HTTP ${message.jev.httpStatus})` : ''}. Kept Wikipedia order.`
          : 'Jev was skipped because this lookup had no sources to rank.'}</div>}
      {message.work && <WorkResult work={message.work} changes={changes} onOpenFile={onOpenFile} onReview={onReview} onUndo={onUndo}/>}
      {!message.streaming && <div className="message-actions"><IconButton title={copied ? 'Copied' : 'Copy answer'} onClick={copy}>{copied ? <Check size={13}/> : <Copy size={13}/>}</IconButton>
        {onSpeak && message.content && <IconButton title={speaking ? 'Stop reading' : 'Read aloud'} disabled={!speaking && !speechEnabled} onClick={() => speaking ? onStopSpeaking() : onSpeak(message)}>{speaking ? <VolumeX size={14}/> : <Volume2 size={14}/>}</IconButton>}
        {onTeach && message.content && <IconButton title="Teach Buji" onClick={() => onTeach(message.id)}><Pencil size={13}/></IconButton>}
        </div>}
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [securityTab, setSecurityTab] = useState(null), [computer, setComputer] = useState({ active: false }), [computerObservation, setComputerObservation] = useState(null);
  const [showLatest, setShowLatest] = useState(false);
  const conversationScroll = useRef(null), followLatest = useRef(true);
  const [web, setWeb] = useState(false), [lessonDraft, setLessonDraft] = useState(null), [lessons, setLessons] = useState([]);
  const [jevConfigured, setJevConfigured] = useState(false), [jev, setJev] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false), [hindiReady, setHindiReady] = useState(false), [voiceBusy, setVoiceBusy] = useState(false);
  const voiceReply = useRef(null);
  const currentId = useRef(null), live = useRef(), bottom = useRef(), textarea = useRef(), terminalBottom = useRef();
  live.current = { thread, projectId, file, activeId };
  const project = projects.find(p => p.id === projectId);
  const modelName = !settings?.model || settings.model === 'qwen3-personal-wsp' ? 'Qwen3 Personal WSP' : settings.model;
  const shortModelName = modelName === 'Qwen3 Personal WSP' ? 'Qwen3 Personal' : modelName;
  const accessMode = settings?.accessMode;
  const sandbox = accessMode === 'sandbox';
  const busy = !!activeId;
  const visualReady = computer.active && computer.mode === 'visual' && mode === 'agent' && !web;
  const notify = error => setToast(cleanError(error));
  const speech = useLocalSpeech(notify, hindiReady);
  live.current.speech = speech;
  live.current.voiceURI = settings?.voiceURI;
  const upsertSummary = value => setThreads(previous => [summarize(value), ...previous.filter(t => t.id !== value.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  function canLeaveEditor() {
    const current = live.current.file;
    return !current || current.content === current.saved || window.confirm('Discard unsaved editor changes?');
  }
  async function loadThread(id, alreadyConfirmed = false) {
    if (!alreadyConfirmed && !canLeaveEditor()) return;
    voiceReply.current = null;
    speech.stop();
    currentId.current = id; setFile(null); setContextFiles([]); setImage(null); setInput(''); setWeb(false); setJev(false);
    followLatest.current = true; setShowLatest(false);
    setSidebarOpen(false);
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
      if (event.type === 'computer-status') { setComputer(event.value); if (!event.value.active) setComputerObservation(null); }
      if (event.type === 'computer-observation') { setComputerObservation(event.value); setComputer(event.value); }
      if (event.type === 'emergency-stop') { setApproval(null); setToast('All activity stopped. Computer access revoked.'); live.current.speech.stop(); }
      if (event.type === 'snapshot') { setProjects(event.snapshot.projects); setThreads(event.snapshot.threads); }
      if (event.type === 'thread' || event.type === 'idle') {
        upsertSummary(event.thread);
        if (currentId.current === event.thread.id) setThread(event.thread);
        if (event.type === 'idle') {
          setActiveId(null); refreshTree(event.thread.projectId);
          if (voiceReply.current === event.thread.id) {
            voiceReply.current = null;
            const userIndex = event.thread.messages.findLastIndex(message => message.role === 'user');
            const answer = event.thread.messages.slice(userIndex + 1).findLast(message => message.role === 'assistant' && message.content);
            if (currentId.current === event.thread.id && answer) live.current.speech.speak(answer, live.current.voiceURI);
          }
        }
      }
      if (event.type === 'message' && currentId.current === event.threadId) {
        setThread(value => value ? { ...value, messages: [...value.messages, event.message] } : value);
        if (event.message.role === 'tool' && event.message.name === 'run_command') {
          let args = {}; try { args = JSON.parse(event.message.arguments); } catch {}
          setTerminal(value => (value + '\n> ' + (args.command || '') + '\n').slice(-60000));
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
          setRightTab('changes');
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
      setProjects(value.projects); setThreads(value.threads); setSettings(value.settings); setHealth(value.health); setJevConfigured(value.jevConfigured); setVoiceReady(value.voice?.ready === true); setHindiReady(value.voice?.hindiReady === true); setComputer(value.computer || {active:false});
      if (value.threads.length) loadThread(value.threads[0].id);
      else setProjectId(value.projects[0]?.id || null);
    }).catch(notify);
    return unsubscribe;
  }, []);
  useEffect(() => { if (settings) document.documentElement.dataset.theme = settings.theme; }, [settings?.theme]);
  useEffect(() => { if (preferences && accessMode) api.lessons().then(setLessons).catch(notify); }, [!!preferences, accessMode]);
  useEffect(() => { refreshTree(projectId); if (projectId) api.gitStatus(projectId).then(setGit).catch(() => {}); }, [projectId, accessMode]);
  useEffect(() => {
    if (toast) { const timer = setTimeout(() => setToast(''), 6000); return () => clearTimeout(timer); }
  }, [toast]);
  useEffect(() => { if (followLatest.current || approval) bottom.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.at(-1)?.content, thread?.messages.at(-1)?.work?.status, thread?.messages.length, approval]);
  useEffect(() => {
    const element = conversationScroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { if (followLatest.current) element.scrollTop = element.scrollHeight; });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { terminalBottom.current?.scrollIntoView({ block: 'end' }); }, [terminal]);
  useEffect(() => {
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'n') { event.preventDefault(); newThread(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); saveFile(); }
      if (event.key === 'Escape') { setModal(null); setLessonDraft(null); setPreferences(null); setProjectMenu(false); setThreadMenu(null); setSecurityTab(null); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  async function send(voiceText) {
    const fromVoice = typeof voiceText === 'string';
    const text = fromVoice ? voiceText : input;
    if (!text.trim() || busy || !thread || (voiceBusy && !fromVoice)) return;
    if (!health.online && !visualReady) return notify('Start your local model first, or enable local visual app access.');
    if (web && text.trim().length > 3000) return notify('Keep your public Web research question under 3,000 characters.');
    speech.stop(); followLatest.current = true; setShowLatest(false); setInput(''); setActiveId(thread.id);
    voiceReply.current = fromVoice ? thread.id : null;
    const payload = { threadId: thread.id, text, mode: fromVoice ? 'chat' : projectId || computer.active ? mode : 'chat', attachments: image ? [image] : [], contextFiles, web, jev: web && jev && jevConfigured,
      ...(fromVoice ? { replyLanguage: settings.voiceReplyLanguage } : {}) };
    setImage(null); setContextFiles([]); setJev(false);
    try { await api.send(payload); }
    catch (error) { voiceReply.current = null; setActiveId(null); setInput(previous => previous || text); notify(error); }
  }
  function voiceTranscript(text) {
    if (settings.voiceConversation && mode === 'chat' && !input.trim() && !image && !contextFiles.length && !web) send(text);
    else { setInput(previous => previous ? previous.trimEnd() + ' ' + text : text); textarea.current?.focus(); }
  }
  async function startModel() {
    setHealth(value => ({ ...value, loading: true, message: 'Starting local model…' }));
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
  async function undoWork(ids) {
    if (!canLeaveEditor()) return;
    try {
      const current = live.current.thread;
      const edits = current.changes.filter(change => ids.includes(change.id) && !change.reverted).reverse();
      for (const change of edits) await api.undoChange(current.id, change.id);
      setFile(null); await refreshTree(); setToast('Changes undone. Previous checks describe the earlier version.');
    } catch (error) { notify(error); }
  }
  async function runTerminal() {
    if (sandbox || !command.trim() || terminalId || !projectId) return;
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
    <button className="thread-select" onClick={() => loadThread(item.id)}><MessageSquare size={18}/><span>{item.title}</span>{activeId === item.id ? <LoaderCircle size={12} className="spin"/> : <small>{relativeTime(item.updatedAt)}</small>}</button>
    <button className="thread-more" aria-label={'Options for ' + item.title} onClick={() => setThreadMenu(threadMenu === item.id ? null : item.id)}><MoreHorizontal size={14}/></button>
    {threadMenu === item.id && <div className="popover thread-popover">
      <button onClick={() => { setModal({ type: 'rename', title: 'Rename chat', value: item.title, id: item.id }); setThreadMenu(null); }}><Pencil size={13}/>Rename</button>
      <button onClick={async () => { if (thread?.id === item.id && !canLeaveEditor()) return; try { const snapshot = await api.archiveThread(item.id); setThreads(snapshot.threads); setThreadMenu(null);
        if (thread?.id === item.id) { if (snapshot.threads.length) await loadThread(snapshot.threads[0].id, true); else await newThread(projectId, true); }
      } catch (error) { notify(error); } }}><Archive size={13}/>Archive</button>
    </div>}
  </div>;
  return <div className="app-shell">
    <aside className={'sidebar ' + (sidebarOpen ? 'mobile-open' : '')}>
      <div className="sidebar-brand"><Brand small/><strong>Buji</strong><span>V3</span></div>
      <div className="sidebar-actions"><button className="new-chat" onClick={() => newThread()}><Plus size={22}/>New task<kbd>Ctrl N</kbd></button>
        {searchOpen && <div className="chat-search"><Search size={16}/><input autoFocus aria-label="Search chats" placeholder="Search chats" value={search} onChange={event => setSearch(event.target.value)}/><IconButton title="Close search" onClick={() => { setSearch(''); setSearchOpen(false); }}><X size={15}/></IconButton></div>}
      </div>
      <div className="sidebar-scroll">
        {projects.filter(item => item.id === projectId).map(item => <section className="project-section" key={item.id}>
          <div className={'project-row ' + (item.id === projectId ? 'current' : '')}><button onClick={() => selectProject(item)} title={item.root}><Folder size={15}/><span>{item.name}</span></button><IconButton title={'New chat in ' + item.name} onClick={() => newThread(item.id)}><Plus size={13}/></IconButton></div>
        </section>)}
        {!projectId && <button className="open-project" onClick={openProject}><FolderOpen size={18}/>Open project folder</button>}
        <div className="section-heading general-heading">Recent<IconButton title="Search chats" onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setSearch(''); }}><Search size={17}/></IconButton></div>
        {visibleThreads.filter(t => !search ? t.projectId === projectId : true).map(renderThread)}
        {!visibleThreads.length && <p className="sidebar-empty">No matching chats.</p>}
      </div>
      <div className="sidebar-bottom"><Brand small/><div><strong>Model on this PC</strong><small><i className={health.online ? 'online' : 'offline'}/>{health.online ? 'Local inference' : health.loading ? 'Starting model' : 'Model offline'}</small></div><IconButton title="Settings" onClick={() => setPreferences({ ...settings })}><Settings size={20}/></IconButton></div>
    </aside>
    <div className="workspace-shell">
      <header className="topbar"><div className="topbar-left"><IconButton title="Toggle navigation" className="nav-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}><PanelLeft size={20}/></IconButton><div className="project-picker"><button onClick={() => setProjectMenu(!projectMenu)}><Folder size={14}/>{project?.name || 'General chat'}<ChevronDown size={12}/></button>
        {projectMenu && <div className="popover project-popover">{projects.map(item => <button key={item.id} onClick={() => selectProject(item)}><Folder size={16}/>{item.name}{item.id === projectId && <Check size={16}/>}</button>)}<hr/><button onClick={() => { setProjectMenu(false); setMode('chat'); newThread(null); }}><MessageSquare size={16}/>General chat</button><button onClick={() => { setProjectMenu(false); openProject(); }}><FolderOpen size={16}/>Open project…</button></div>}</div>
        {accessMode && <><span className="top-divider"/><button className="scope-button" title="Change access mode in Settings" onClick={() => setPreferences({ ...settings })}>{sandbox ? <Shield size={20}/> : <Monitor size={20}/>}<span>{sandbox ? 'Sandbox' : 'Full local access'}</span></button><span className="top-divider"/><button className="scope-button" aria-label={sandbox ? "Commands disabled" : settings.approveCommands ? "Command review on" : "Command review off"} onClick={() => setPreferences({ ...settings })}><ShieldCheck size={20}/><span>{sandbox ? 'Commands disabled' : settings.approveCommands ? 'Command review on' : 'Command review off'}</span></button></>}</div>
        <div className="topbar-actions">{accessMode && <><IconButton title="Security center" onClick={() => setSecurityTab('security')}><ShieldCheck size={19}/></IconButton><IconButton title="Computer access" className={computer.active ? 'computer-connected' : ''} onClick={() => setSecurityTab('computer')}><Monitor size={19}/></IconButton></>}<button className={'view-button ' + (terminalOpen && !sandbox ? 'active' : '')} title={sandbox ? 'PowerShell is disabled in Sandbox' : 'Toggle terminal'} aria-label="Toggle terminal" disabled={sandbox} onClick={() => setTerminalOpen(!terminalOpen)}><Terminal size={15}/></button>
          <button className={'view-button ' + (rightOpen ? 'active' : '')} title="Files and changes" aria-label="Files and changes" onClick={() => setRightOpen(!rightOpen)}><PanelRight size={15}/>{changes.length > 0 && <b>{changes.length}</b>}</button>
          <span className="window-divider"/><IconButton title="Minimize" onClick={() => api.window('minimize')}><Minus size={14}/></IconButton><IconButton title="Maximize" onClick={() => api.window('maximize')}><Maximize size={12}/></IconButton><IconButton title="Close window" className="window-close" onClick={() => api.window('close')}><X size={15}/></IconButton></div>
      </header>
      <div className="main-columns"><section className="conversation">
        {computer.active && <div className="computer-session" role="status"><Monitor size={17}/><span>{computer.window.title} · {computer.mode==='visual'?'local visual access':'accessible controls'} · this chat · review every action</span><button onClick={() => setSecurityTab('computer')}>Inspect</button><button onClick={() => api.stopComputer().then(setComputer).catch(notify)}><Square size={14}/>Stop access</button></div>}
        <div className={'conversation-scroll ' + (welcome ? 'is-welcome' : '')} ref={conversationScroll} onScroll={event => { const element = event.currentTarget; const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 60; followLatest.current = atBottom; setShowLatest(!atBottom); }}>
          {welcome ? <div className="welcome"><Brand/><div className="welcome-eyebrow">YOUR PERSONAL AI WORKBENCH</div><h1>What shall we work on?</h1><p>Code, understand, and work with your files.<br/>Your model. On your computer.</p>
            <div className="suggestions">{[
              { icon: Code, title: 'Build something', text: 'Create a small Python utility in this project and explain how to run it.' },
              { icon: Search, title: 'Understand this code', text: 'Explore the files in this project and explain how the code works.' },
              { icon: FileCode, title: 'Draft from files', text: 'Read the Markdown and text files in this project and write a concise project-brief.md with a summary and next steps. Use the file tools.' }
            ].map(item => <button key={item.title} onClick={() => { setInput(item.text); textarea.current?.focus(); }}><item.icon size={17}/><span>{item.title}</span><ChevronRight size={13}/></button>)}</div>
            <div className="welcome-status"><i className={health.online ? 'online' : 'offline'}/>{health.online ? modelName + ' is ready' : health.message}
              {!health.online && <button disabled={health.loading} onClick={startModel}>{health.loading ? <LoaderCircle size={12} className="spin"/> : <Play size={12}/>}Start model</button>}</div>
          </div> : <div className="messages">{conversationMessages(thread.messages).map(message => <Message key={message.id} message={message} changes={thread.changes} onUndo={undoWork} onLink={onLink} onOpenFile={openFile} onOpenFolder={openProjectFolder} onReview={() => { setRightOpen(true); setRightTab('changes'); }}
            onTeach={accessMode ? messageId => setLessonDraft({ messageId, threadId: thread.id, projectName: project?.name, text: '' }) : null}
            onSpeak={accessMode ? message => speech.speak(message, settings.voiceURI) : null} onStopSpeaking={speech.stop}
            speaking={speech.speaking === message.id} speechEnabled={speech.voices.length > 0 && !voiceBusy}/>) }
            {approval?.threadId === thread?.id && approval.kind === 'computer' && <ComputerApproval approval={approval} notify={notify}/>}
            {approval?.threadId === thread?.id && approval.kind !== 'computer' && <div className="approval-card" data-testid="command-approval"><div><Terminal size={16}/><strong>Run this command?</strong></div><pre>{approval.command}</pre>{approval.input && <><small>Scripted standard input</small><pre>{approval.input}</pre></>}<small>PowerShell · {approval.cwd === '.' ? project?.name : approval.cwd}</small><div className="approval-buttons"><button onClick={() => api.approve(approval.id, false).catch(notify)}>Skip</button><button className="primary" onClick={() => api.approve(approval.id, true).catch(notify)}><Play size={12}/>Run command</button></div></div>}
            <div ref={bottom}/></div>}
        </div>
        {showLatest && <button className="jump-latest" onClick={() => { followLatest.current = true; setShowLatest(false); bottom.current?.scrollIntoView({block:'end'}); }}><ChevronDown size={17}/>Latest activity</button>}
        <div className="composer-area"><div className={'composer ' + (busy ? 'busy' : '')}>
          <div className="intent-tabs" role="tablist" aria-label="Task intent" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const tabs = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
            const index = tabs.indexOf(document.activeElement);
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
            if (next) { event.preventDefault(); next.focus(); next.click(); }
          }}>
            <button role="tab" aria-selected={!web && (mode === 'chat' || (!projectId&&!computer.active))} disabled={busy} onClick={() => { setMode('chat'); setWeb(false); setJev(false); }}><MessageSquare size={21}/>Ask</button>
            <button role="tab" aria-selected={!web && mode === 'agent' && (!!projectId||computer.active)} disabled={busy} onClick={() => { setMode('agent'); setWeb(false); setJev(false); if (!projectId&&!computer.active) openProject(); }}><Code size={22}/>Work</button>
            {accessMode && <button role="tab" aria-selected={web} disabled={busy || !!image || contextFiles.length > 0 || settings?.webEnabled === false} title={settings?.webEnabled === false ? 'Public web research is disabled in Settings' : 'Search the public internet and read sources'} onClick={() => { setWeb(true); setJev(false); }}><Layers size={21}/>Research</button>}
          </div>
          {(image || contextFiles.length > 0) && <div className="composer-attachments">{image && <span><Image size={12}/>{image.name}<button onClick={() => setImage(null)}><X size={11}/></button></span>}{contextFiles.map(value => <span key={value}><FileCode size={12}/>{value}<button onClick={() => setContextFiles(contextFiles.filter(f => f !== value))}><X size={11}/></button></span>)}</div>}
          <textarea ref={textarea} aria-label="Message Buji" disabled={voiceBusy} placeholder={visualReady ? 'Describe what to do in the selected app…' : web ? 'Enter a public question or HTTPS URL…' : project ? 'Ask Buji to build, fix, or explain…' : 'Ask anything…'} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} rows={3}/>
          <div className="composer-toolbar"><div className="composer-helper"><span>{busy ? (web ? 'Researching public sources…' : visualReady ? 'Working in the selected app…' : 'Working on this PC…') : visualReady ? 'Local vision · review every screen action' : web ? 'Internet search + source reading · project tools off' : mode === 'agent' && project ? 'Hindi / Hinglish · Review before sending' : 'Hindi / Hinglish · Ask anything'}</span>
            {web && jevConfigured && <label className="jev-toggle"><input type="checkbox" checked={jev} disabled={busy} onChange={event => setJev(event.target.checked)}/>Jev (paid)</label>}</div>
            <div className="composer-actions"><IconButton title={file ? 'Attach open file' : 'Attach a project file'} disabled={web || visualReady || !projectId || busy} onClick={() => { if (file) setContextFiles(previous => previous.includes(file.path) ? previous : [...previous, file.path].slice(0, 3)); else { setRightOpen(true); setRightTab('files'); setToast('Open a file, then use the paperclip to attach it.'); } }}><Paperclip size={23}/></IconButton>
              {!accessMode && <IconButton title="Attach image" disabled={web} onClick={async () => { try { const value = await api.chooseImage(); if (value) setImage(value); } catch (error) { notify(error); } }}><Image size={20}/></IconButton>}
              {accessMode && <VoiceInput key={thread?.id} ready={voiceReady} disabled={busy || !thread || (!health.online&&!visualReady)}
              language={settings.voiceLanguage} automatic={settings.voiceConversation && mode === 'chat' && !input.trim() && !web && !image && !contextFiles.length}
              onTranscript={voiceTranscript} onBusy={setVoiceBusy} beforeRecord={speech.stop} notify={notify}/>}
              {busy ? <button className="send-button stop" title="Stop reply" aria-label="Stop reply" onClick={() => { voiceReply.current = null; speech.stop(); api.cancel(activeId).catch(notify); }}><Square size={16} fill="currentColor"/><span>Stop task</span></button> : <button className="send-button" aria-label={web ? 'Start research' : mode === 'agent' && (project || computer.active) ? 'Start task' : 'Send message'} disabled={voiceBusy || !input.trim() || !thread || (!health.online && !visualReady)} onClick={send}><Send size={22}/><span>{web ? 'Research' : mode === 'agent' && (project || computer.active) ? 'Start task' : 'Send'}</span></button>}</div></div>
        </div><div className="composer-caption"><span>{!health.online && !visualReady ? health.message : web && jev ? 'This query and snippets will be sent to TypeSafe for a paid decision.' : 'Enter to send · Shift + Enter for a new line'}</span>{!health.online && !visualReady && <button disabled={health.loading} onClick={startModel}>Start model</button>}</div></div>
        {terminalOpen && !sandbox && <section className="terminal-panel"><div className="panel-title"><span><Terminal size={13}/>Terminal <small>PowerShell · {project?.name || 'Select a project'}</small></span><div>{terminalId && <IconButton title="Stop command" onClick={() => api.cancelTerminal(terminalId).catch(notify)}><Square size={11}/></IconButton>}<IconButton title="Clear terminal" onClick={() => setTerminal('')}><RotateCcw size={12}/></IconButton><IconButton title="Close terminal" onClick={() => setTerminalOpen(false)}><X size={13}/></IconButton></div></div><pre aria-label="Terminal output">{terminal || 'Ready. Commands run in the selected project folder.\n'}<span ref={terminalBottom}/></pre><form className="terminal-input" onSubmit={event => { event.preventDefault(); runTerminal(); }}><span>❯</span><input aria-label="Terminal command" value={command} onChange={event => setCommand(event.target.value)} placeholder={projectId ? 'Run a PowerShell command…' : 'Open a project first'} disabled={!projectId || !!terminalId}/><button disabled={!command.trim() || !!terminalId}><ArrowUp size={13}/></button></form></section>}
      </section>
      {rightOpen && <aside className="right-panel"><div className="right-tabs"><button className={rightTab === 'files' ? 'active' : ''} onClick={() => setRightTab('files')}><Folder size={13}/>Files</button><button className={rightTab === 'changes' ? 'active' : ''} onClick={() => setRightTab('changes')}><FileCode size={13}/>Changes{changes.length > 0 && <b>{changes.length}</b>}</button><IconButton title="Close files panel" onClick={() => setRightOpen(false)}><X size={13}/></IconButton></div>
        {rightTab === 'files' ? <>
          <div className="explorer-heading"><span>{project?.name || 'No project'}</span><div><IconButton title="Refresh files" onClick={() => refreshTree()}><RotateCcw size={12}/></IconButton><IconButton title="New file" disabled={!projectId} onClick={() => setModal({ type: 'new-file', title: 'Create a file', value: '', placeholder: 'e.g. src/main.py' })}><FilePlus size={13}/></IconButton></div></div>
          <div className="file-filter"><Search size={12}/><input aria-label="Filter files" placeholder="Filter files" value={fileSearch} onChange={event => setFileSearch(event.target.value)}/></div>
          <div className={'file-tree ' + (file ? 'with-editor' : '')}>{tree.filter(entry => (!fileSearch || entry.path.toLowerCase().includes(fileSearch.toLowerCase())) && ![...collapsed].some(folder => entry.path.startsWith(folder + '/'))).map(entry => <button key={entry.path} title={entry.path} className={'file-row ' + (file?.path === entry.path ? 'selected' : '')} style={{ paddingLeft: 14 + entry.depth * 13 }} onClick={() => entry.directory ? setCollapsed(previous => { const next = new Set(previous); next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path); return next; }) : openFile(entry.path)}>{entry.directory ? <>{collapsed.has(entry.path) ? <ChevronRight size={11}/> : <ChevronDown size={11}/>}<Folder size={13}/></> : <><span className="file-indent"/><FileCode size={13}/></>}<span>{entry.name}</span></button>)}{!projectId && <div className="panel-empty">Open a project to browse files.</div>}</div>
          {file && <div className="editor-section"><div className="editor-heading"><span title={file.path}><FileCode size={13}/>{file.path}{file.content !== file.saved && <i/>}</span><div><button className="save-file" disabled={file.content === file.saved} onClick={saveFile}>Save</button><IconButton title="Close editor" onClick={() => { if (file.content === file.saved || window.confirm('Discard unsaved editor changes?')) setFile(null); }}><X size={12}/></IconButton></div></div><CodeEditor file={file} theme={settings?.theme} onChange={content => setFile(previous => ({ ...previous, content }))} onSave={saveFile}/><div className="editor-footer"><span>{file.content.split('\n').length} lines</span><span>UTF-8</span></div></div>}
        </> : <div className="changes-panel">{changes.length ? changes.map(change => <section className="change-card" key={change.id}><div className="change-heading"><button onClick={() => openFile(change.path)}><FileCode size={13}/>{change.path}</button><span><b>+{change.additions}</b><em>−{change.deletions}</em></span><IconButton title={'Undo edit to ' + change.path} onClick={() => undoWork([change.id])}><RotateCcw size={12}/></IconButton></div><pre>{change.patch.split('\n').slice(4).map((line, index) => <div key={index} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : line.startsWith('@@') ? 'hunk' : ''}>{line || ' '}</div>)}</pre></section>) : <div className="panel-empty"><Check size={22}/><strong>No changes yet</strong><p>Saved edits appear here, with a diff and undo.</p></div>}</div>}
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
    {lessonDraft && <div className="modal-overlay"><form className="small-modal lesson-modal" onSubmit={async event => {
      event.preventDefault();
      try { setLessons(await api.saveLesson(lessonDraft.threadId, lessonDraft.messageId, lessonDraft.text)); setLessonDraft(null); setToast('Lesson saved locally.'); }
      catch (error) { notify(error); }
    }}>
      <h2>Teach Buji</h2><p>{lessonDraft.projectName ? 'Future chats in ' + lessonDraft.projectName : 'Future chats across Buji'}</p>
      <textarea autoFocus aria-label="Correction or preference" maxLength={360} rows={4} placeholder="What should Buji do differently next time?" value={lessonDraft.text}
        onChange={event => setLessonDraft({ ...lessonDraft, text: event.target.value })}/>
      <div className="modal-buttons"><button type="button" onClick={() => setLessonDraft(null)}>Cancel</button><button className="primary" disabled={!lessonDraft.text.trim()}>Save lesson</button></div>
    </form></div>}
    {securityTab && <SecurityPanel initialTab={securityTab} threadId={thread?.id} sandbox={sandbox} busy={busy} computer={computer} observation={computerObservation} onChange={value => { setComputer(value); if (!value.active) setComputerObservation(null); }} onClose={() => setSecurityTab(null)} onSettings={() => { setSecurityTab(null); setPreferences({...settings}); }} notify={notify}/>}
    {preferences && <div className="modal-overlay"><div className="settings-modal">
      <div className="settings-heading"><div><SlidersHorizontal size={19}/><h2>Settings</h2></div><IconButton title="Close settings" onClick={() => setPreferences(null)}><X size={17}/></IconButton></div>
      <div className="settings-body">
        {accessMode && <>
          <h3>Execution access</h3>
          <label>Access mode<select value={preferences.accessMode} disabled={busy || !!terminalId}
            onChange={event => setPreferences({ ...preferences, accessMode: event.target.value })}>
            <option value="sandbox">Sandbox</option>
            <option value="full">Full local access</option>
          </select></label>
          <p>{preferences.accessMode === 'sandbox'
            ? 'Read and edit text files inside the selected project. PowerShell, builds, and tests are disabled.'
            : 'PowerShell can read, write, and run programs anywhere your Windows account has access. Commands start in the selected project.'}</p>
        </>}
        <label className="toggle-setting"><span><strong>Review agent commands</strong><small>See the PowerShell command before it runs.</small></span>
          <input type="checkbox" checked={preferences.approveCommands} disabled={preferences.accessMode === 'sandbox'}
            onChange={event => setPreferences({ ...preferences, approveCommands: event.target.checked })}/></label>
        {accessMode && <label className="toggle-setting"><span><strong>Allow public web research</strong><small>Search terms and requested public pages are sent to search providers and source websites. App and file tools stay off in Research.</small></span><input type="checkbox" disabled={busy} checked={preferences.webEnabled !== false} onChange={event => setPreferences({...preferences,webEnabled:event.target.checked})}/></label>}
        <h3>Local model</h3><p>Your chats and project context are sent to this localhost endpoint.</p>
        <label>API endpoint<input value={preferences.endpoint} onChange={event => setPreferences({ ...preferences, endpoint: event.target.value })}/></label>
        <label>Model ID<input value={preferences.model} onChange={event => setPreferences({ ...preferences, model: event.target.value })}/></label>
        <label>Model launcher<div className="launcher-input"><input readOnly value={preferences.backendScript}/><button onClick={async () => { const value = await api.chooseBackendScript(); if (value) setPreferences({ ...preferences, backendScript: value }); }}>Browse</button></div></label>
        <label className="toggle-setting"><span><strong>Start the model automatically</strong><small>Start the local model when you open Buji.</small></span><input type="checkbox" checked={preferences.autoStartModel} onChange={event => setPreferences({ ...preferences, autoStartModel: event.target.checked })}/></label>
        {accessMode && <>
          <h3>Voice</h3>
          <label>Speech input language<select value={preferences.voiceLanguage} onChange={event => setPreferences({ ...preferences, voiceLanguage: event.target.value })}>
            <option value="auto">Auto detect</option><option value="en">English</option><option value="hi">Hindi</option>
          </select></label>
          <label>Voice reply language<select value={preferences.voiceReplyLanguage} onChange={event => setPreferences({ ...preferences, voiceReplyLanguage: event.target.value })}>
            <option value="auto">Match my language</option><option value="hi">Hindi</option><option value="hinglish">Hinglish</option><option value="en">English</option>
          </select></label>
          <label className="toggle-setting"><span><strong>Voice conversation</strong><small>Send voice messages in Ask and read the reply aloud. Work and Research always use an editable draft.</small></span>
            <input type="checkbox" checked={preferences.voiceConversation} onChange={event => setPreferences({ ...preferences, voiceConversation: event.target.checked })}/></label>
          <label>Reply voice<select value={preferences.voiceURI} onChange={event => setPreferences({ ...preferences, voiceURI: event.target.value })}>
            <option value="">Automatic local voice</option>{speech.voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}
          </select></label>
          <p>Speech runs on this PC. Hindi playback uses Piper. English playback uses installed Windows voices.</p>
        </>}
        {accessMode && <JevSettings configured={jevConfigured} onChange={value => { setJevConfigured(value); setJev(false); }} notify={notify}/>}
        <h3>Appearance</h3><label>Theme<select value={preferences.theme} onChange={event => setPreferences({ ...preferences, theme: event.target.value })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
        {accessMode && <details className="archived-chats"><summary>Saved lessons ({lessons.length})</summary>
          {!lessons.length && <p>Use Teach Buji on a reply to save a correction.</p>}
          {lessons.map(lesson => <div key={lesson.id}><span>{lesson.text}<small className="lesson-scope">{lesson.projectId ? projects.find(project => project.id === lesson.projectId)?.name || 'Project' : 'All chats'}</small></span>
            <button onClick={async () => { try { setLessons(await api.removeLesson(lesson.id)); } catch (error) { notify(error); } }}>Forget</button></div>)}
        </details>}
        <details className="archived-chats" onToggle={event => { if (event.currentTarget.open) api.archivedThreads().then(setArchivedChats).catch(notify); }}><summary>Archived chats</summary>{archivedChats?.length ? archivedChats.map(item => <div key={item.id}><span>{item.title}</span><button onClick={async () => { try { const value = await api.restoreThread(item.id); setThreads(value.threads); setArchivedChats(previous => previous.filter(chat => chat.id !== item.id)); } catch (error) { notify(error); } }}>Restore</button></div>) : <p>No archived chats.</p>}</details>
        <div className="data-folder"><span>Buji · data stored locally</span><button onClick={() => api.openDataFolder()}>Open data folder</button></div>
      </div>
      <div className="settings-footer">
        <button onClick={startModel} disabled={health.loading}>{health.online ? <Check size={13}/> : <Play size={13}/>} {health.online ? 'Model connected' : 'Start model'}</button>
        <button className="primary" onClick={async () => { try { const value = await api.saveSettings(preferences); setSettings(value); setPreferences(null); setHealth(await api.health()); } catch (error) { notify(error); } }}>Save settings</button>
      </div>
    </div></div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
