import fs from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve(import.meta.dirname, '../artifacts/v3-workflow');
const project = path.join(directory, 'buji-demo');
const profile = path.join(directory, 'profile');
await fs.mkdir(project, { recursive: true });
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(project, 'calculator.py'), 'def divide(a, b):\n    return a / b\n');
await fs.writeFile(path.join(project, 'test_calculator.py'), 'import pytest\nfrom calculator import divide\n\ndef test_positive():\n    assert divide(6, 2) == 3\n\ndef test_negative():\n    assert divide(-6, 2) == -3\n\ndef test_zero():\n    with pytest.raises(ValueError, match="Cannot divide by zero"):\n        divide(1, 0)\n');
const now = Date.now();
await fs.writeFile(path.join(profile, 'workspace.json'), JSON.stringify({ version: 1, lessons: [],
  settings: { endpoint: 'http://127.0.0.1:8093/v1', model: 'buji-v2-routed',
    backendScript: path.resolve(import.meta.dirname, '../../../outputs/BujiV2-Router/Start-Buji-V2-Backend.ps1'),
    autoStartModel: false, approveCommands: true, accessMode: 'full', voiceLanguage: 'auto', voiceReplyLanguage: 'auto',
    voiceConversation: true, voiceURI: '', theme: 'light' },
  projects: [{ id: 'v3-qa-project', name: 'buji-demo', root: project, createdAt: now }],
  threads: [{ id: 'v3-qa-thread', projectId: 'v3-qa-project', title: 'Workspace validation', createdAt: now, updatedAt: now,
    messages: [], modelMessages: [], changes: [], archived: false }] }, null, 2));
console.log('Prepared isolated native workflow at', directory);
