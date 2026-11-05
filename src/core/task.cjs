// Turn requirements come from the user's request, never from model/file output.
function taskRequirements(text, previousUserTexts = []) {
  let request = text.trim();
  const previousTask = [...previousUserTexts].reverse().find(value => /\b(python|javascript|typescript|script|program|code|game|app|website|utility|project|file)\b|\.(?:py|js|ts|html|md)\b/i.test(value)) || '';
  if (/^(?:yes[,! ]*)?(?:do it|go ahead|please proceed|build it|make it|kar do|bana do)[.! ]*$/i.test(request))
    request = previousTask || request;
  const subject = /\b(it|that|this|isko)\b/i.test(request) ? request + ' ' + previousTask : request;
  const advisory = /^(?:how\b|what\b|why\b|explain\b|describe\b|teach\b|show me (?:how|an example)\b)/i.test(request)
    || /\b(?:do not|don't|dont|without)\s+(?:actually\s+)?(?:create|write|change|modify|run|execute)\b/i.test(request)
    || /\b(?:just|only)\s+(?:show|explain|give me (?:the )?code|provide (?:the )?code)\b/i.test(request);
  if (advisory) return { action: false, write: false, command: false, inspect: false };
  const change = /\b(build|create|make|develop|implement|generate|write|add|fix|edit|update|change|refactor|banao|bana|banado|likho)\b|(?:बना|लिख|ठीक कर)/i.test(request);
  const code = /\b(python|javascript|typescript|html|css|node|react|script|program|code|game|tic[ -]?tac[ -]?toe|app|website|utility|function|test|project|bug)\b|\.(?:py|js|jsx|ts|tsx|html|css|cjs|mjs|ps1)\b/i.test(subject);
  const file = /\b(file|readme|document|markdown|config)\b|\.[a-z0-9]{1,6}\b/i.test(subject);
  const write = change && (code || file);
  const command = /\b(run|execute|test|compile|verify|check|chalao|chala|build)\b|(?:चलाओ|चलाकर)/i.test(request) || (write && code);
  const inspect = /\b(inspect|read|search|list|look at|review)\b/i.test(request) && (file || /\b(project|folder|directory|source)\b/i.test(request));
  return { action: write || command || inspect, write, command, inspect };
}

class TaskProgress {
  constructor(requirements) {
    this.requirements = requirements; this.files = new Set(); this.commands = [];
    this.inspected = false; this.sequence = 0; this.lastWrite = 0; this.lastVerified = -1; this.declined = false;
  }
  record(name, args, result) {
    this.sequence++;
    if (result?.error) return;
    if (['list_files', 'read_file', 'search_text'].includes(name)) this.inspected = true;
    if (['write_file', 'edit_file'].includes(name) && result?.written) {
      this.files.add(result.path || args.path); this.lastWrite = this.sequence;
    }
    if (name === 'run_command') {
      this.declined ||= result?.approved === false;
      this.commands.push({ command: args.command, exitCode: result?.exitCode ?? null,
        declined: result?.approved === false, timedOut: !!result?.timedOut, cancelled: !!result?.cancelled });
      if (result?.exitCode === 0 && !result.timedOut && !result.cancelled) this.lastVerified = this.sequence;
      else if (result?.exitCode != null || result?.timedOut || result?.cancelled) this.lastVerified = -1;
    }
  }
  missing() {
    const missing = [];
    if (this.requirements.write && !this.files.size) missing.push('create or edit the requested files on disk');
    if (this.requirements.inspect && !this.inspected && !this.files.size) missing.push('inspect the actual project using its file tools');
    if (this.requirements.command && this.lastVerified < this.lastWrite)
      missing.push('run an appropriate non-interactive build, test, or smoke check after the latest edit and inspect its result');
    return missing;
  }
  snapshot(project, status) {
    return { status, projectId: project.id, root: project.root, files: [...this.files], commands: this.commands,
      verification: this.lastVerified >= this.lastWrite && this.lastVerified >= 0 ? 'passed' : 'not-run' };
  }
}
module.exports = { taskRequirements, TaskProgress };
