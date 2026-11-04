# Privacy and data flow

## What stays on the computer

Buji stores chats, project references, preferences and edit history in `%APPDATA%\BujiV1\workspace.json`. Image attachments and file excerpts can be included in chat history. Edit records contain before/after file text.

The application does not include an analytics service, cloud AI client, account sign-in or automatic updater. Its renderer uses bundled resources; spellcheck downloads are disabled.

## What reaches the model

The main process sends conversation context, selected attachments, relevant tool results and tool definitions to the localhost model endpoint configured in Settings. Endpoint validation limits hosts to loopback, and redirects are rejected.

A local API can itself proxy requests elsewhere. Buji cannot verify a separately configured backend's implementation or network behavior. For local-only inference, operate a backend that actually runs the model locally.

## Other network actions

- A user-clicked web link can open in the system browser.
- A PowerShell command can use the network with the user's account permissions.
- Installing dependencies, downloading a runtime/model, or fetching releases needs network access during setup.

These are separate from the app's localhost model transport.

## Backups and migration

Recognized legacy QwenDesk history is copied, not deleted, on first normal launch if no Buji history exists. Existing project paths remain unchanged. The old copy can still contain private information.

Use Settings → Open data folder to locate Buji's data. Close the app before backing up or manually changing its database. Review logs and history before attaching anything to a public issue.
