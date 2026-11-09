const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SECRET = /(?:\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_]{20,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_ -]?key|password|authorization|access[_ -]?token)\s*[:=]\s*\S{8,})/i;
function publicQuery(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 350) throw new Error('Use public search terms under 350 characters.');
  if (SECRET.test(value)) throw new Error('The search appears to contain a credential. Remove private keys, passwords, and tokens.');
  return value.trim();
}
function protectedFile(relative) {
  const parts = String(relative).replaceAll('\\', '/').toLowerCase().split('/');
  return parts.some(part => ['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.git'].includes(part))
    || parts.some(part => /^\.env(?:\.|$)/.test(part) && !/\.(?:example|sample|template)$/.test(part))
    || /(?:^|\/)(?:credentials(?:\.json|\.ini)?|id_rsa|id_ed25519|login data(?:-journal)?|cookies(?:-journal)?|sam|security|system)$/i.test(String(relative).replaceAll('\\', '/'))
    || /\.(?:pem|pfx|p12|key)$/i.test(relative);
}
function requirePublicFile(relative) {
  if (protectedFile(relative)) throw new Error('Credential-file protection blocks this path. Open sensitive files yourself outside the agent.');
}
function requireTool(name, available) {
  if (!available.some(tool => tool.function.name === name)) throw new Error('Tool is not authorized for this turn: ' + name);
}
function redact(value) {
  return String(value ?? '').replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_]{20,}/g, '[redacted]')
    .replace(/((?:api[_ -]?key|password|authorization|access[_ -]?token)\s*[:=]\s*)\S+/gi, '$1[redacted]');
}
class SecurityLog {
  constructor(directory) { this.file = path.join(directory, 'security-events.jsonl'); }
  record(kind, outcome, details = {}) {
    // Allow only metadata. Command bodies, typed text, source content, and credentials are never logged here.
    const data = Object.fromEntries(['tool', 'host', 'app', 'reason', 'threadId', 'action', 'characters'].filter(key => details[key] !== undefined)
      .map(key => [key, typeof details[key] === 'number' ? details[key] : redact(details[key]).slice(0, 180)]));
    const entry = { id: crypto.randomUUID(), time: new Date().toISOString(), kind, outcome, ...data };
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > 1024 * 1024) {
        const recent = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-500);
        fs.writeFileSync(this.file, recent.join('\n') + '\n');
      }
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    } catch { /* Logging failure must not execute an action or expose its input. */ }
    return entry;
  }
  recent() {
    try { return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-80).reverse().flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
    catch { return []; }
  }
}
module.exports = { publicQuery, protectedFile, requirePublicFile, requireTool, redact, SecurityLog };
