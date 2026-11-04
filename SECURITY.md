# Security

## Report an issue

Use this repository's **Security → Report a vulnerability** option for a private report when available. If it is unavailable, open a minimal issue asking for a private reporting channel; leave exploit details and private data out of that public issue.

Include the affected version, platform, reproduction steps and the boundary you believe was crossed.

## Supported release

The current V1 release is supported on a best-effort basis. The project has not undergone an independent security audit.

## Actual boundaries

- The renderer uses context isolation, a sandboxed preload and no Node integration.
- Privileged IPC requests are accepted only from the app's main frame.
- File tools resolve paths within the selected project and reject links that escape it.
- Model endpoints must be localhost addresses. HTTP redirects are rejected.
- Command review is enabled by default. A user can change that preference.
- PowerShell commands run with the user's Windows permissions. They are not confined by an OS sandbox and can access resources beyond the working directory.
- Undo checks the current file hash before restoring a previous version.

A local model, repository content and tool output can all be unreliable. Project-boundary checks reduce some risks; they do not make an untrusted command safe.

## Data

Normal history and preferences live in `%APPDATA%\BujiV1`. They may include project paths, file excerpts, images and before/after edit contents. See [Privacy](docs/PRIVACY.md). Do not attach that database or logs to a public issue without reviewing them.
