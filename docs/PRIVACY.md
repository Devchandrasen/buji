# Privacy and data flow

## What stays on the computer

Buji stores chats, project references, preferences and edit history in `%APPDATA%\BujiV1\workspace.json` or `%APPDATA%\BujiV2\workspace.json`. V3 retains the V2 profile name. Image attachments and file excerpts can be included in chat history. Edit records contain before/after file text. This database is local plaintext.

The application does not include an analytics service, cloud AI client, account sign-in or automatic updater. Its renderer uses bundled resources; spellcheck downloads are disabled.

## What reaches the model

The main process sends conversation context, selected attachments, relevant tool results and tool definitions to the localhost model endpoint configured in Settings. Endpoint validation limits hosts to loopback, and redirects are rejected.

A local API can itself proxy requests elsewhere. Buji cannot verify a separately configured backend's implementation or network behavior. For local-only inference, operate a backend that actually runs the model locally.

Visual computer-use captures only the selected window and sends its JPEG to the bundled configuration's local Qwen3-VL service at `127.0.0.1:8096`. The service requires a per-install bearer key. Screenshots are held in memory, excluded from chat/model history and not saved during normal operation. They may still appear in OS/GPU memory or a crash dump; this is not secure-memory erasure. Test harnesses explicitly save screenshots of their disposable fixtures. App titles, extracted screen text, typed text, action arguments and answers remain in local chat history. The metadata-only security activity log excludes screenshot bytes and typed text.

## Other network actions

- A user-clicked web link can open in the system browser.
- A PowerShell command can use the network with the user's account permissions.
- Installing dependencies, downloading a runtime/model, or fetching releases needs network access during setup.
- Research sends the current public question to search providers and contacts requested public source sites. City-weather lookup contacts a live weather service. Sites/providers can see queries, URLs and your network address. Research does not receive project files or earlier chat.
- Visual browser actions can load public sites in the selected browser, which uses its normal network and cookie behavior. Local screenshot inference does not make browser navigation offline.
- Optional TypeSafe Jev is a separate explicitly configured network integration. It is not needed for local visual computer-use and was not used in its acceptance tests.

These are separate from the app's localhost model transport.

## Backups and migration

Recognized legacy QwenDesk history is copied, not deleted, on first normal launch if no Buji history exists. Existing project paths remain unchanged. The old copy can still contain private information.

Use Settings → Open data folder to locate Buji's data. Close the app before backing up or manually changing its database. Review logs and history before attaching anything to a public issue.
