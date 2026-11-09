# Security

## Report an issue

Use this repository's **Security → Report a vulnerability** option for a private report when available. If it is unavailable, open a minimal issue asking for a private reporting channel; leave exploit details and private data out of that public issue.

Include the affected version, platform, reproduction steps and the boundary you believe was crossed.

## Supported release

The current Windows desktop builds are supported on a best-effort basis. The project has not undergone an independent security audit. The V3 workspace retains the V2 executable/profile names for compatibility.

## Actual boundaries

- The renderer uses context isolation, a sandboxed preload and no Node integration.
- Privileged IPC requests are accepted only from the app's main frame.
- File tools resolve paths within the selected project and reject links that escape it.
- Model endpoints must be localhost addresses. HTTP redirects are rejected.
- Command review is enabled by default. A user can change that preference.
- PowerShell commands run with the user's Windows permissions. They are not confined by an OS sandbox and can access resources beyond the working directory.
- Undo checks the current file hash before restoring a previous version.
- Named credential files are excluded from file tools, attachments, search and the editor. This is a path-based guard, not a secret scanner or a restriction on Full local access commands.
- Research receives public-web tools only, without prior chat, attached files, project lessons, shell or computer tools. Requests use validated public HTTPS endpoints, bounded reads and pinned DNS resolution.
- Windows app control starts off, is bound to one selected window and chat for ten minutes, and reviews every input independently of the command-review preference. It does not elevate or operate authentication/system dialogs.
- Visual mode uses selected-window capture and authenticated loopback inference on port 8096. A fresh single-use image, pixel/geometry comparison, selected-process identity and foreground/hit-target checks precede input. Unicode typing avoids the clipboard and checks standard writable field values. Detection of sensitive controls is partial; every input still requires human review.
- Security center provides scope, a metadata-only activity log and Stop all. The global emergency shortcut is advertised only when Windows successfully registers it.

See [Security and computer use](docs/security-and-computer-use.md) for implementation details, privacy limits and acceptance evidence.

A local model, repository content and tool output can all be unreliable. Project-boundary checks reduce some risks; they do not make an untrusted command safe.

## Data

Normal history and preferences live in `%APPDATA%\BujiV1` or `%APPDATA%\BujiV2`. They may include project paths, file excerpts, accessible app text, action arguments, images and before/after edit contents. The database is local plaintext. See [Privacy](docs/PRIVACY.md). Do not attach it or logs to a public issue without reviewing them.
