# Contributing to Buji

Small, verifiable improvements are welcome. Open an issue with a concrete use case before making a large architectural change.

## Development

Use Windows and Node.js 24:

```powershell
npm ci
npm run build
npm test
npm start
```

The app connects to a localhost model API. The tested configuration uses `http://127.0.0.1:8088/v1` and model ID `qwen3-personal-wsp`. Model setup is documented in [docs/MODELS.md](docs/MODELS.md).

## Desktop checks

```powershell
npm run build
npm run test:desktop
```

These checks require the real local Qwen profile and Python on PATH. Keep its launcher discoverable as described in [Quick start](docs/QUICKSTART.md), using `Start-Qwen3.ps1` for an existing installation or the generated `models/backend/Start-Model.ps1`. They create disposable project/state folders under `artifacts/`, use command approval, and verify actual file contents and command output. They do not use your normal Buji history.

To check a packaged executable:

```powershell
$env:BUJI_EXECUTABLE = "C:\path\to\app\Buji.exe"
npm run test:desktop
```

## Portable Windows package

```powershell
npm run build
npm run package
```

Build scratch files go under `work/buji-packaging`. The portable app is written to `outputs/BujiV1`. A previous package is preserved in the scratch directory before replacement.

## Pull requests

- Explain the concrete behavior before and after the change.
- Include relevant test output. For visible UI changes, include a screenshot from the real application.
- Keep project-boundary checks, command review, cancellation and guarded undo intact.
- Never commit chat history, API tokens, private project files, model weights or generated build folders.
- Do not present a scripted provider response as a real-model integration result.

Useful areas include accessibility, model compatibility, context handling, command cancellation, packaging and documentation. Current priorities are in [ROADMAP.md](ROADMAP.md).

Contributions are made under the project's MIT license. Dependencies, model artifacts and third-party code need their original license and attribution.
