const { commandSummary } = require('./presentation.cjs');
// Turn requirements come from the user's request, never from model/file output.
function taskRequirements(text, previousUserTexts = []) {
  let request = text.trim();
  const previousTask = [...previousUserTexts].reverse().find(value => /\b(python|javascript|typescript|script|program|code|game|app|website|utility|project|file)\b|\.(?:py|js|ts|html|md)\b/i.test(value)) || '';
  if (/^(?:yes[,! ]*)?(?:do it|go ahead|please proceed|build it|make it|kar do|bana do)[.! ]*$/i.test(request))
    request = previousTask || request;
  // A restriction on a named file does not cancel the rest of a build request.
  // Remove only that bounded clause for intent classification, never from the model's user message.
  const intent = request.replace(/\b(?:do not|don't|dont)\s+(?:change|modify|edit|overwrite|delete)\s+(?:the\s+)?["'`]?([\w./\\-]+\.[a-z0-9]{1,8})["'`]?\b/gi, '');
  const subject = /\b(it|that|this|isko)\b/i.test(request) ? request + ' ' + previousTask : request;
  const advisory = /^(?:how\b|what\b|why\b|explain\b|describe\b|teach\b|show me (?:how|an example)\b)/i.test(intent)
    || /\b(?:do not|don't|dont|without)\s+(?:actually\s+)?(?:create|write|change|modify|run|execute)\b/i.test(intent)
    || /\b(?:just|only)\s+(?:show|explain|give me (?:the )?code|provide (?:the )?code)\b/i.test(intent);
  if (advisory) return { action: false, write: false, command: false, inspect: false };
  const change = /\b(build|create|make|develop|implement|generate|write|add|fix|edit|update|change|refactor|banao|bana|banado|likho)\b|(?:बना|लिख|ठीक कर)/i.test(intent);
  const code = /\b(python|javascript|typescript|html|css|node|react|script|program|code|game|tic[ -]?tac[ -]?toe|app|website|utility|function|test|project|bug)\b|\.(?:py|js|jsx|ts|tsx|html|css|cjs|mjs|ps1)\b/i.test(subject);
  const file = /\b(file|readme|document|markdown|config)\b|\.[a-z0-9]{1,6}\b/i.test(subject);
  const write = change && (code || file);
  const command = /\b(run|execute|test|compile|verify|check|chalao|chala|build)\b|(?:चलाओ|चलाकर)/i.test(intent) || (write && code);
  const inspect = /\b(inspect|read|search|list|look at|review)\b/i.test(intent) && (file || /\b(project|folder|directory|source)\b/i.test(intent));
  return { action: write || command || inspect, write, command, inspect };
}

class TaskProgress {
  constructor(requirements) {
    this.requirements = requirements; this.files = new Set(); this.commands = []; this.changeIds = [];
    this.inspected = false; this.sequence = 0; this.lastWrite = 0; this.lastVerified = -1; this.declined = false;
    this.computerActions = []; this.computerObserved = -1; this.computerAction = 0; this.computerApp = '';
  }
  record(name, args, result) {
    this.sequence++;
    if (result?.error) return;
    if (name === 'computer_observe' && result?.snapshot) { this.computerObserved = this.sequence; this.computerApp = result.app; }
    if (name === 'computer_act') {
      this.declined ||= result?.approved === false;
      if (result?.approved === false) this.declineKind = 'computer';
      if (result?.performed) { this.computerAction = this.sequence; this.computerActions.push({ action: result.action, app: result.app }); }
    }
    if (['list_files', 'read_file', 'search_text'].includes(name)) this.inspected = true;
    if (['write_file', 'edit_file'].includes(name) && result?.written) {
      this.files.add(result.path || args.path); this.lastWrite = this.sequence;
      if (result.changeId) this.changeIds.push(result.changeId);
    }
    if (name === 'run_command') {
      this.declined ||= result?.approved === false;
      this.commands.push({ command: args.command, exitCode: result?.exitCode ?? null,
        declined: result?.approved === false, timedOut: !!result?.timedOut, cancelled: !!result?.cancelled,
        summary: commandSummary(result?.output) });
      if (result?.exitCode === 0 && !result.timedOut && !result.cancelled) this.lastVerified = this.sequence;
      else if (result?.exitCode != null || result?.timedOut || result?.cancelled) this.lastVerified = -1;
    }
  }
  missing() {
    const missing = [];
    if (this.requirements.computer === 'act' && !this.computerActions.length) missing.push('perform the requested action in the selected app after approval');
    if ((this.requirements.computer || this.computerActions.length) && this.computerObserved < this.computerAction) missing.push('observe the selected app after the latest action and verify its visible outcome');
    if (this.requirements.write && !this.files.size) missing.push('create or edit the requested files on disk');
    if (this.requirements.inspect && !this.inspected && !this.files.size) missing.push('inspect the actual project using its file tools');
    if (this.requirements.command && this.lastVerified < this.lastWrite)
      missing.push('run an appropriate non-interactive build, test, or smoke check after the latest edit and inspect its result');
    return missing;
  }
  snapshot(project, status) {
    return { status, declineKind: this.declineKind, projectId: project.id, root: project.root, files: [...this.files], changeIds: this.changeIds, commands: this.commands,
      verification: this.lastVerified >= this.lastWrite && this.lastVerified >= 0 ? 'passed' : 'not-run',
      ...(this.computerObserved >= 0 || this.computerActions.length ? { computer: { app: this.computerApp, actions: this.computerActions,
        observedAfterAction: this.computerObserved > this.computerAction } } : {}) };
  }
}
module.exports = { taskRequirements, TaskProgress };
