# Conversation Desk

The selected Buji V3 design is implemented in the existing desktop application. The launcher and model profile keep their Buji V2 names for compatibility; this update changes the workspace experience, not model weights or the routed model benchmark.

The security/research extension adds an on-demand Security center, selected-app control with reviewed input, and general public internet search with source reading. See [capabilities and limits](security-and-computer-use.md) and [upgrade verification](security-upgrade-qa.md). Research has no project, command or app tools. Computer input is off until explicitly enabled for one chat/window.

Ask answers conversationally, Work uses the selected project's file and command tools, and Research uses the existing public web tools. The selected intent remains visible after sending. The header shows the current project, execution access, and command-review setting.

Completed work presents recorded saved files and command outcomes. A green “Saved and verified” label requires both completed task status and successful post-edit verification. Saved-only and incomplete work use different labels. Open result opens the saved file, Review changes opens the diff, and Undo changes uses the recorded edit IDs in reverse order with the existing stale-file protection. An undone result becomes neutral.

Hindi/Hinglish speech uses the existing local setup. Work and Research recordings produce editable drafts. In Ask, the existing Voice conversation preference can automatically send and read a reply. Text-only local model profiles attach project text files through the paperclip.

## Local verification

```powershell
npm test
npm run build
node tools/design-preview.mjs
```

The browser design preview is at `http://127.0.0.1:4173/`. It uses sample data and refuses sends, writes, and command execution. `?state=incomplete`, `?state=declined`, `?state=undone`, `?state=empty`, and `?state=dark` expose preview states. It is not bundled into the desktop app.

`node tools/prepare-workspace-qa.mjs` prepares an isolated test profile and calculator project under `artifacts/v3-workflow`. It overwrites only that named QA fixture. Launch the packaged Buji V2 executable with `BUJI_DATA_DIR` set to the fixture profile to test the real localhost model separately from personal chats.

The recorded acceptance run passed three unchanged pytest tests after an initial failure and correction. It also verified opening the saved file and restoring the original bytes through Undo. See `../design-qa.md` for screenshots, visual comparisons, and the limits of this verification.
