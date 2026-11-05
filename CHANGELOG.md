# Changelog

## 1.0.1 — 2026-11-05

- Fix ordinary Agent build requests ending with a code tutorial or a handoff to the user.
- Track actual file edits and successful checks after the latest edit; retry premature answers through native tools and report incomplete work honestly.
- Show saved paths, command results, folder actions and review links in an execution summary. Reveal diffs automatically after agent writes.
- Add scripted standard input, include it in command review, and explain how to test interactive Python programs without a keyboard.
- Recover from truncated tool arguments without replaying malformed calls into the local server.
- Preserve command declines across retries. Keep explicit Chat mode free of action tools.
- Add orchestration regressions and a real-model desktop execution acceptance test plus a separate optional game-quality probe.

## 1.0.0 — 2026-11-04

First public **Buji V1** release.

- Windows desktop workspace with persistent project chats and archive/restore.
- Local streaming chat and native function calling with the tested Qwen3 Personal WSP backend.
- Project file listing, reading, searching, creation and exact-text edits.
- Syntax-aware editor, diffs and guarded undo.
- Reviewed non-interactive PowerShell commands, cancellation and timeouts.
- Image attachments and light/dark appearance.
- MIT-licensed source, build/test workflows, documentation and model setup guidance.
- First-launch migration from a previous local QwenDesk workspace, without deleting the original.

The original prototype was called QwenDesk. This release gives the project its Buji identity and a public, portable source distribution.
