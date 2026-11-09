# Buji V3

Buji is a local AI workspace for Windows from [CBN.Ai](https://devchandrasen.github.io/CBN.ai/). Open a folder to ask questions, make reviewable changes, and see the files and checks behind a result.

[Download the Windows x64 preview](https://github.com/Devchandrasen/buji/releases/tag/v3.0.0-preview.2)

- **Ask, Work, and Research.** Use local chat, work in a real project, or fetch current information from public web sources.
- **Review actions.** Inspect proposed commands and diffs. Use project-scoped sandbox mode or opt into full local access. Undo supported edits.
- **Use your voice.** Whisper transcribes locally. An optional Hindi voice supports Hindi and Hinglish replies.
- **Work with a Windows app.** Optional local vision reads a selected window. Buji asks before sending keyboard or pointer input.

## Install on Windows

1. Download `Buji-V3-Setup-x64.exe` and verify its SHA-256 using `SHA256SUMS.txt` on the release.
2. Run the unsigned preview installer. It installs for your Windows account.
3. Open **Buji** from the **Buji V3** Start menu folder. First launch downloads and verifies the 5.63 GB text model. Keep about 12 GB free during assembly. A download can resume from the same shortcut.

Use Windows 10 or 11 x64. Windows 11 is recommended for visual computer use. We recommend 16 GB RAM and a recent x64 CPU. CPU inference works without a discrete GPU and can be slow. Use the optional NVIDIA setup with a compatible driver and sufficient VRAM. The Start menu also has a shortcut to return to CPU mode.

For Hindi speech or computer use, close Buji and choose **Set up Hindi speech** or **Set up visual computer use** from the same folder. Visual computer use downloads an additional 1.55 GB model. Hindi speech downloads Piper dependencies and the Pratham voice. The Pratham model card lists a CC BY-NC-SA 4.0 dataset. Consult that card before using the voice commercially.

After setup, text inference and installed speech and vision run locally. Web research sends search requests to public providers. Chats, approvals, and model files stay under your Windows profile. Uninstall from Windows Settings. The uninstaller preserves the Buji profile under `%APPDATA%\CBN.Ai\Buji` and downloaded assets under `%LOCALAPPDATA%\CBN.Ai\Buji Assets`.

This is an early preview. Review generated edits, shell commands, and computer actions before applying them. See the [security guide](SECURITY.md) and [privacy details](docs/PRIVACY.md).

## Build the desktop app

Use Node.js 24 and npm on Windows x64.

```powershell
npm ci
npm test
npm run build
node package.mjs --v2 --stage-only
```

The V2 packaging flag and executable name are compatibility identifiers for the local OmniCoder-based backend. The UI and Windows installer identify this release as Buji V3. The source includes the [router](tools/brain), the [first-run scripts and NSIS definition](tools/windows-release), and the [model manifest](tools/windows-release/release-assets.json).

## Models and licenses

The application source is MIT-licensed. The text backend uses an Apache-2.0 OmniCoder-9B checkpoint from [Tesslate](https://huggingface.co/Tesslate/OmniCoder-9B), locally quantized to GGUF Q4_K_M from revision `9edd36a30fc7b95b6fd81b7ea16a73cbaf205734`. The supplied WSP adapters are local derivatives of that checkpoint and are loaded at zero scale for the original coding and reasoning route. The optional vision backend uses [Qwen3-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF). See [third-party notices](THIRD_PARTY_NOTICES.md) and the notices included in setup for component terms and provenance.

[Report an issue](https://github.com/Devchandrasen/buji/issues)
