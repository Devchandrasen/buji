// Completion labels come from recorded execution, never from assistant prose.
function workPresentation(work, changes = []) {
  const files = work?.files || [];
  const commands = work?.commands || [];
  const ids = work?.changeIds || [];
  const edits = changes.filter(change => ids.includes(change.id));
  const undone = edits.filter(change => change.reverted).length;
  const verified = work?.status === 'completed' && work.verification === 'passed'
    && commands.some(command => command.exitCode === 0 && !command.timedOut && !command.cancelled && !command.declined);
  if (undone) return { title: undone === ids.length ? 'Changes undone' : 'Some changes undone', tone: 'neutral',
    canUndo: edits.some(change => !change.reverted), canOpen: undone !== ids.length && files.length > 0 };
  return { title: work?.status === 'declined' ? (work.declineKind === 'computer' ? 'Stopped · app action not approved' : 'Stopped · command declined')
    : work?.status !== 'completed' ? 'Work incomplete'
      : !files.length && work.computer?.observedAfterAction ? (work.computer.actions.length ? 'App updated and rechecked' : 'App inspected')
      : verified ? (files.length ? 'Saved and verified' : 'Checked on your PC')
        : files.length ? 'Saved · verification not run' : 'Inspection complete',
    tone: verified || (work?.status === 'completed' && work.computer?.observedAfterAction) ? 'verified' : work?.status === 'completed' && !files.length ? 'neutral' : 'attention',
    canUndo: ids.length > 0 && edits.length === ids.length && edits.some(change => !change.reverted), canOpen: files.length > 0 };
}

function commandSummary(output = '') {
  // Keep only recognized test totals, not an arbitrary line of command output.
  const match = String(output).match(/\b\d+ passed(?:, \d+ (?:failed|skipped|xfailed|xpassed|warnings?))*/i);
  return match ? match[0].slice(0, 120) : '';
}
module.exports = { workPresentation, commandSummary };
