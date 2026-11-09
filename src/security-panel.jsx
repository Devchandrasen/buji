import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Monitor, Activity, X, RefreshCw, Square, Check, LoaderCircle, SlidersHorizontal } from 'lucide-react';
const api = window.buji;

export function ComputerApproval({ approval, notify }) {
  const [enlarged,setEnlarged]=useState(false);
  return <section className="approval-card computer-approval" data-testid="computer-approval" aria-label="Review computer action">
    <div><Monitor size={20}/><strong>Review app action</strong></div>
    {approval.intent && <><small>Your task</small><p>{approval.intent}</p></>}
    <p>{approval.app} · {approval.title}</p><dl><dt>Action</dt><dd>{approval.action}{approval.key ? ' · ' + approval.key : ''}{approval.direction ? ' · ' + approval.direction : ''}</dd><dt>{approval.visual?'Target':'Control'}</dt><dd>{approval.target}</dd></dl>
    {approval.visual && <><p>{approval.reason}</p><figure className={'visual-action-preview'+(enlarged?' enlarged':'')}><div><img src={approval.image} alt="Selected app screenshot for this one reviewed action"/>{Number.isInteger(approval.x)&&Number.isInteger(approval.y)&&<span className="visual-target" style={{left:approval.x/10+'%',top:approval.y/10+'%'}} aria-label="Proposed action point"/>}</div><figcaption>Red marker: proposed input location. Screenshot stays on this PC. <button onClick={()=>setEnlarged(!enlarged)}>{enlarged?'Smaller preview':'Enlarge preview'}</button></figcaption></figure></>}
    {approval.text && <><small>Text to enter (replaces the field value)</small><pre>{approval.text}</pre></>}
    <small>Applies once to this app. Expires in 2 minutes. Observe again after the action.</small>
    <div className="approval-buttons"><button onClick={() => api.approve(approval.id,false).catch(notify)}>Skip action</button><button className="primary" onClick={() => api.approve(approval.id,true).catch(notify)}>Approve action</button></div>
  </section>;
}

export function SecurityPanel({ initialTab = 'security', threadId, sandbox, busy, computer, observation, onChange, onClose, onSettings, notify }) {
  const [tab, setTab] = useState(initialTab), [data, setData] = useState(null), [windows, setWindows] = useState([]);
  const [selected, setSelected] = useState(''), [loading, setLoading] = useState(false);
  const [mode,setMode]=useState(computer?.mode || 'visual');
  const [error, setError] = useState('');
  const dialog = useRef(null);
  async function refresh() {
    setLoading(true); setError('');
    try { const status=await api.securityStatus();setData(status);if(!status.vision?.installed)setMode('accessible');if (tab === 'computer') setWindows(await api.computerWindows()); }
    catch (error) { setError(String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); notify(error); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [tab]);
  useEffect(() => {
    const previous = document.activeElement; dialog.current?.querySelector('button')?.focus();
    return () => previous?.focus?.();
  }, []);
  async function grant() {
    setLoading(true);
    try { onChange(await api.grantComputer(threadId, Number(selected),mode)); await api.previewComputer(threadId); }
    catch (error) { notify(error); }
    finally { setLoading(false); }
  }
  return <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="security-panel" role="dialog" aria-modal="true" aria-labelledby="security-title" ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const fields = [...dialog.current.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href],input:not(:disabled)')].filter(element => element.getClientRects().length);
        if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
      }
    }}>
      <header><div><ShieldCheck size={23}/><h2 id="security-title">Security & computer access</h2></div><button className="icon-button" aria-label="Close security center" onClick={onClose}><X size={21}/></button></header>
      <nav className="security-tabs" aria-label="Security sections">{[['security','Protection',ShieldCheck],['computer','Computer',Monitor],['activity','Activity',Activity]].map(([id,label,Icon]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={18}/>{label}</button>)}</nav>
      <div className="security-body">
        {error && <p role="alert" className="access-explanation">{error}</p>}
        {tab === 'security' && <>
          <h3>Clear scope. Reviewable actions.</h3><p>Your model runs locally. Each task only receives the tools available in its selected mode.</p>
          <dl className="protection-list">
            <div><dt>Project files</dt><dd><Check size={16}/>Credential-file protection on</dd></div>
            <div><dt>Research</dt><dd>{data?.researchEnabled === false ? 'Disabled in Settings' : 'Public HTTPS · no file, command or app tools'}</dd></div>
            <div><dt>Computer</dt><dd>{computer?.active ? computer.window.process + ' · this chat only' : 'Off until you select an app'}</dd></div>
            <div><dt>Execution access</dt><dd>{sandbox ? 'Sandbox · project files only' : 'Full local access · your Windows permissions'}</dd></div>
          </dl>
          <p>Full local access is not an operating-system sandbox. Use Sandbox for file-only work. App control always reviews each action, independently of the command-review setting.</p>
          <button className="secondary-action" onClick={onSettings}><SlidersHorizontal size={17}/>Open access settings</button>
          <div className="emergency-note"><strong>Stop all activity</strong><p>{data?.emergencyShortcut ? 'Ctrl + Alt + Shift + S stops replies, commands, voice and computer access.' : 'Stop replies, commands, voice and computer access here. The keyboard shortcut is unavailable in this session.'}</p><button onClick={() => api.emergencyStop().then(() => onChange({active:false})).catch(notify)}><Square size={16}/>Stop all now</button></div>
        </>}
        {tab === 'computer' && <>
          <h3>{computer?.active ? 'Connected to ' + computer.window.title : 'Choose one app for this chat'}</h3>
          <p>Access expires after 10 minutes, on chat change, or when stopped. Every input needs your approval. Password fields, terminals and protected dialogs are unavailable; complete sensitive submissions yourself.</p>
          {sandbox && <p className="access-explanation">Computer control requires Full local access. You can change this in access settings.</p>}
          <label className="app-select">How Buji sees the app<select aria-label="Computer use mode" value={mode} onChange={event=>setMode(event.target.value)} disabled={loading||busy||sandbox}>
            <option value="visual" disabled={!data?.vision?.installed}>Visual · local Qwen3-VL</option><option value="accessible">Accessible controls · OmniCoder</option>
          </select></label>
          <p className="computer-limits">{mode==='visual'?'Qwen3-VL reads screenshots on this PC and proposes pointer/keyboard actions. The selected app is brought forward for capture. The model loads on the first task; no paid API or image upload is used.':'OmniCoder reads app accessibility controls. Apps without accessible controls may need manual operation.'}</p>
          {!data?.vision?.installed&&<p className="computer-limits">Local vision is not installed. {data?.vision?.message}</p>}
          <label className="app-select">Application window<select aria-label="Application window" value={selected} onChange={event => setSelected(event.target.value)} disabled={loading || busy || sandbox}>
            <option value="">Select a running app…</option>{windows.map(window => <option key={window.id} value={window.id}>{window.process} · {window.title}</option>)}
          </select></label>
          {!loading && !error && !windows.length && <p>Open an ordinary app window, then choose Refresh apps.</p>}
          <div className="computer-buttons"><button className="secondary-action" disabled={loading} onClick={refresh}>{loading ? <LoaderCircle size={17} className="spin"/> : <RefreshCw size={17}/>}Refresh apps</button>
            <button className="open-result" disabled={loading || busy || sandbox || !threadId || !selected} onClick={grant}>{computer?.active ? mode!==computer.mode?'Switch access mode':Number(selected) === computer.window.id ? 'Renew access' : 'Switch app' : 'Enable for this chat'}</button>
            {computer?.active && <button className="secondary-action" onClick={() => api.stopComputer().then(onChange).catch(notify)}><Square size={16}/>Stop access</button>}
          </div>
          <p className="computer-limits">Screenshots go only to the local vision model and are not saved in chat history. App text, action arguments and outcomes remain in local history. Pages can contain misleading instructions; review the marked target before approving.</p>
          {computer?.active && observation?.image && <figure className="computer-preview"><img src={observation.image} alt="Latest view of the selected application window"/><figcaption>{computer.window.title} · {computer.mode==='visual'?'Windows Graphics Capture':observation.elementCount+' accessible controls'} · {new Date(observation.observedAt).toLocaleTimeString()}</figcaption></figure>}
          {computer?.active && !observation?.image && <p>{observation ? 'Window preview unavailable for this app. Accessible controls can still be used.' : 'Ask Buji to inspect the selected app in Work mode.'}</p>}
        </>}
        {tab === 'activity' && <>
          <div className="activity-heading"><h3>Agent security activity</h3><button className="secondary-action" disabled={loading} onClick={refresh}><RefreshCw size={16}/>Refresh</button></div>
          <p>Stored on this PC. This log keeps action metadata; it excludes command bodies, typed text and screenshots. Chat history is stored separately.</p>
          <ol className="security-events">{data?.events?.map(event => <li key={event.id}><div><strong>{event.tool || event.action || event.kind}</strong><span>{event.outcome}</span></div><small>{new Date(event.time).toLocaleString()}{event.app ? ' · ' + event.app : ''}</small>{event.reason && <p>{event.reason}</p>}</li>)}</ol>
          {!data?.events?.length && <p>No security activity recorded yet.</p>}
        </>}
      </div>
    </section>
  </div>;
}
