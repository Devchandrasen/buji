# Buji V3: security, internet research and app control

The Conversation Desk design is retained. Security details live in an on-demand center, with Protection, Computer and Activity sections. The model endpoint, routed OmniCoder weights, Hindi speech engines and existing V2 profile remain compatible. Inference and app automation run on this PC. Public research contacts search providers and requested source sites; no paid search API is required.

## Boundaries and design

The main process is the capability boundary. A turn receives only its declared tools; execution validates that list again before dispatch. Research has web tools, computer tasks have two computer tools, Sandbox has project text tools, and Full local access can additionally run PowerShell. A strategy per task keeps the local model's small context focused. App snapshots are short-lived, single-use evidence; task completion requires another observation after input. Recorded results distinguish file verification from app observation.

Credential-file guards exclude named `.env` files (except templates), SSH/cloud configuration directories, private-key extensions and common credential databases from normal file tools. These guards do not inspect every secret and do not constrain PowerShell. Full local access runs with the current Windows account's permissions and is **not an operating-system sandbox**. Command review remains the separate existing control; choose Sandbox for file-only work.

The renderer uses context isolation and a sandboxed preload without Node integration. IPC accepts the trusted main frame only. Model endpoints stay on localhost without following redirects. Existing stale-write and stale-undo checks remain in place.

## Internet research

Research searches DuckDuckGo Lite, with HTML and Bing RSS fallbacks when a provider cannot return usable results. Challenges are reported rather than bypassed. Results are deduplicated and filtered for query relevance and `site:` constraints. Up to two result pages are read automatically. A subsequent fetch can focus on a specific passage or follow a link returned by a source. Citations carry provider, retrieval time and whether a page was read or only a snippet was available. Existing Open-Meteo lookup handles live city weather separately.

Public fetches require HTTPS on port 443, reject credentials/signed URLs and local/private addresses, validate every redirect, and pin each connection to its checked IPv4 address. Reads have a 12-second deadline, a 2 MiB limit and bounded text excerpts. Tool calls per research turn are bounded. The original question is the only conversational input: project files, lessons and earlier chat are not attached to research. Common credential patterns in search terms are refused. These checks are partial detection; users should enter public questions only. Search providers and sites can see the query/URL and network address.

This is public text research, not an authenticated browser. JavaScript-only sites, paywalls, CAPTCHAs, private accounts, PDFs and unsupported content may need manual browsing. Search-provider markup and availability can change. The model can still misinterpret evidence, so citations and explicit retrieval failures remain visible.

## Computer skill

Open **Computer access**, choose an ordinary running app, and enable it for the current chat. Ask a concrete app task in **Work**, such as editing a note. The built-in skill uses `computer_observe` and `computer_act`. The controller spawns a local PowerShell/.NET Windows UI Automation helper over stdin/stdout, without a listening network port or an elevation request. No proprietary Codex computer-use runtime is redistributed.

The grant binds a window handle, process ID and process start time to one chat for ten minutes. Chat changes, Sandbox, cancellation, app close, expiry or Stop all revoke it. Observations identify accessible controls and skip password fields. Each click, text replacement, allowed shortcut or scroll has a separate review showing the app, target, original task and exact proposed text. Review expires after two minutes. Snapshots must be fresh when proposed and cannot be reused. The worker revalidates the target before input; text replacement also detects a changed field. Keyboard input must prove the selected window has focus. Semantic UIA actions operate the exact cached control.

Authentication, terminals, known protected/system windows and known sensitive/external submission controls are refused. These name-based checks are defense in depth, not a complete classifier for every third-party app. The human review is required for every input. Complete sensitive submissions manually. App content is untrusted evidence and is never permission to change the user's task.

There are two modes. **Accessible controls · OmniCoder** retains the text-only UIA strategy. **Visual · local Qwen3-VL** uses selected-window Windows Graphics Capture, a separate local 2B multimodal model and screenshot coordinates. Reviews show the image and target marker. Pixel/geometry checks run again before physical input; standard text entry requires a writable ValuePattern and checks the final field value. A separate read-only pass of the same model checks the resulting screen. Blank/protected/minimized captures fail closed. See [visual setup and limits](visual-computer-use.md) and [real-task acceptance](visual-computer-use-qa.md). This is bounded desktop control, not Codex feature parity.

## Local storage and stop controls

Chats retain accessible text, proposed arguments and tool outcomes locally in the existing plaintext workspace database. Review chat history before sharing it. In visual mode, the current screenshot is sent only to the authenticated loopback vision model; it is not appended to chat/model history or saved by normal operation. The renderer retains the latest preview in memory while access is active. `security-events.jsonl` keeps bounded metadata (tool, action, app/process, outcome, timestamp), excluding command bodies, entered text and screenshots. It is separate from chat history and is not an immutable forensic log. Security center shows the most recent 80 entries.

**Stop all** cancels replies, pending approvals, commands, voice and computer access. **Ctrl+Alt+Shift+S** is also available when registered successfully; the UI tells the truth when another app owns the shortcut. Stop cancels future work; it cannot roll back external effects of an already executed action.

## Validation and references

Run `npm test` and `npm run build`. The upgrade adds boundary tests for unauthorized research writes, Sandbox app input, expired/revoked/declined sessions, stale snapshots, credential paths/queries/URLs, search parsing, source passages, metadata logging and bounded model-context recovery. The Windows acceptance fixture is `tools/computer-fixture.cjs`; it writes only a fixed disposable test note under ignored `artifacts/security-upgrade`. `tools/prepare-security-qa.mjs` overwrites only its named isolated profile. Do not use it on a personal profile.

Recorded acceptance: the local model observed the fixture, proposed text replacement and Save, received each approval, observed the saved state, and the exact expected file bytes were confirmed. A separate live research task searched for Python pathlib and cited a fetched official Python source. See [upgrade QA](security-upgrade-qa.md) for evidence and limits. These checks are not an independent security audit.

Design basis: [OWASP LLM prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) informs tool separation, untrusted-source handling and human review. [Microsoft's UI Automation security overview](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-security-overview) describes Windows UI security boundaries; Buji does not elevate around them. [DuckDuckGo's non-JavaScript interfaces](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript) provide the public Lite/HTML search surfaces used here.
