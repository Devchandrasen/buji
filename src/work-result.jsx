import React, { useState } from 'react';
import { CircleCheck, CircleHelp, FileCode, ChevronRight, ExternalLink, RotateCcw } from 'lucide-react';
import { workPresentation } from './core/presentation.cjs';

export function WorkResult({ work, changes, onOpenFile, onReview, onUndo }) {
  const [undoing, setUndoing] = useState(false);
  const state = workPresentation(work, changes);
  async function undo() {
    setUndoing(true);
    try { await onUndo(work.changeIds); } finally { setUndoing(false); }
  }
  return <section className={'work-result ' + state.tone} data-testid="execution-summary" aria-label="Recorded task result">
    <div className="result-evidence">
      {state.tone === 'verified' ? <CircleCheck size={30}/> : <CircleHelp size={28}/>}
      <div><strong>{state.title}</strong>
        <div className="result-metadata">{!!work.files?.length && <div className="result-files">{work.files.map(path => <button key={path} disabled={!state.canOpen} onClick={() => onOpenFile(path)}><FileCode size={15}/>{path}</button>)}</div>}
        {(work.commands || []).map((command, index) => <div className="result-command" key={index}><code>{command.command}</code>
          {command.summary && <span>{command.summary}</span>}<span>{command.declined ? 'declined' : command.timedOut ? 'timed out' : command.cancelled ? 'cancelled' : 'exit ' + (command.exitCode ?? 'unknown')}</span></div>)}
        {work.files?.length > 0 && !work.commands?.length && <small>No command check recorded.</small>}</div>
        {work.computer && <small>{work.computer.app} · {work.computer.actions.length} approved actions · {work.computer.observedAfterAction ? 'screen rechecked' : 'screen check pending'}</small>}
      </div>
    </div>
    {work.files?.length > 0 && <div className="result-actions"><button className="review-work" onClick={onReview}><ChevronRight size={18}/>Review changes</button>
      <div><button className="open-result" disabled={!state.canOpen} onClick={() => onOpenFile(work.files[0])}><ExternalLink size={18}/>Open result</button>
        {state.canUndo && <button className="undo-result" disabled={undoing} onClick={undo}><RotateCcw size={18}/>{undoing ? 'Undoing…' : 'Undo changes'}</button>}</div>
    </div>}
  </section>;
}
