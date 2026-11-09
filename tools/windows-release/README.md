# Build the Buji V3 Windows installer

The build checks out the app source and verifies SHA-256 for the Electron, llama.cpp, Whisper, Python, NSIS, and WSP inputs listed in [build-inputs.json](build-inputs.json). The adapter archive contains the same Apache-2.0 OmniCoder derivatives included in the V3 preview. The larger text model is downloaded by the installed app's first-run setup using [release-assets.json](release-assets.json).

From the repository root on Windows x64 with Node.js 24, Python 3.12, and curl available, run:

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
npm ci
npm test
npm run build
python tools/windows-release/build-installer.py --cache work/installer-inputs --output outputs/Buji-V3-Setup-x64.exe
```

The [GitHub Actions workflow](../../.github/workflows/build-v3-installer.yml) builds an unsigned installer with read-only repository access. The existing public release was built locally. A signing candidate for SignPath must come from the trusted workflow and receive manual approval under the project's signing policy.

The signing job runs only for the commit named by the `BUJI_SIGNPATH_COMMIT` repository variable on `release/buji-v3-signpath`. Configure the `buji-signpath` GitHub environment with the `SIGNPATH_API_TOKEN` secret and the `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_POLICY_SLUG`, and `SIGNPATH_ARTIFACT_SLUG` variables from the approved project. Use a submitter credential for the approved release policy. The job submits the artifact from that workflow run. Approve and retrieve the signed artifact in the SignPath project.

After signing, verify the Authenticode chain and timestamp with Windows SignTool. Check that the publisher matches the approved identity. Publish the signed installer with a new SHA-256, then update the download link on CBN.Ai.
