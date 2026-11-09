# Local visual computer use

Buji's Windows V3 workspace has a screenshot-driven agent alongside accessible-controls mode. It uses **Qwen3-VL-2B-Instruct Q4_K_M**, its Q8 vision projector and llama.cpp on this PC. No hosted inference, subscription or paid search API is used. Existing OmniCoder coding/reasoning and math routing remain separate.

## Use it

1. Open an ordinary app or browser window. Keep it restored, with the controls you need visible.
2. In Buji choose **Full local access**, then **Computer access**.
3. Choose **Visual · local Qwen3-VL**, select the application window, and click **Enable for this chat**.
4. Close the panel, choose **Work**, and describe a short task. Example: `Replace the Note field with Hello Buji, then click Save note.` A project folder is optional for visual work.
5. Review each proposed input: app, original task, red target marker, action and exact text. Approve or skip it. Buji observes again after input and checks the visible outcome.
6. Use **Stop access**, **Stop all**, or **Ctrl+Alt+Shift+S** when available. Access also expires after ten minutes, on chat change or cancellation. Leave access off when finished.

The first task loads the visual model. It unloads after five idle minutes or when its access session stops. Capture/input brings the selected window forward; avoid using that window during a task. Input stops if another app takes focus or the screen changes during review. Check the app before retrying.

## Setup on another PC

Requires Windows with Windows Graphics Capture, Python 3.12 and an official llama.cpp build supporting Qwen3-VL. From the repository:

```powershell
.\tools\setup-vision.ps1 -Server 'C:\path\to\llama-server.exe'
```

Setup installs pinned free capture dependencies, downloads the official pinned model/projector, verifies SHA-256 values, and writes `BujiVision/vision.json`. Restart Buji. `BUJI_VISION_CONFIG` can point to the config for a portable install. The vision endpoint is fixed to `http://127.0.0.1:8096/v1`; 8094 remains available to the existing router's benchmark control. Model files total about 1.55 GB decimal, plus capture/runtime dependencies. Setup needs internet once; inference works offline. Browsing public sites still needs internet.

This PC's 8 GB RTX 5060 Laptop GPU and 16 GB RAM ran vision with 20 GPU layers alongside the original coding backend. Other hardware may need fewer GPU layers in the config. This is a tested configuration, not a minimum hardware guarantee.

## Implementation and privacy

`visual-agent.cjs` runs a separate bounded task strategy. `visual-capture.py` uses Microsoft's Windows Graphics Capture for the selected HWND, rather than whole-desktop capture or a proprietary automation service. Images are scaled to at most 1280 × 900 and sent to the local multimodal server. The model proposes one structured action using normalized screenshot coordinates; it does not receive accessibility IDs for visual grounding.

`ComputerAccess` requires human approval, a fresh single-use snapshot and the original window identity. Before input, the capture helper compares pixels and geometry with the reviewed frame. The Windows worker checks process identity, foreground focus, hit-tested window, known sensitive controls and writable fields. Mouse and Unicode keyboard events use Windows SendInput without the clipboard. Standard text replacement checks the actual field value after typing. A separate read-only inference pass of the **same local model** checks the resulting screenshot before further planning. This helps prevent repeated clicks; it is not an independent correctness guarantee.

Screenshots stay in process/helper memory and go only to the authenticated loopback vision API. They are not appended to chat/model history or saved by normal operation. Typed text, arguments, app titles and answers remain in local plaintext chat history. Acceptance tests deliberately save their disposable/public screenshots as evidence.

## Limits

- Inputs: click, double click, whole-field text replacement, whitelisted keys and vertical scrolling. Twelve steps per task, two consecutive input failures and expiring reviews bound each run.
- Editable fields must expose a writable Windows UI Automation ValuePattern. Reading/clicking can work on rendered pages, but typing into canvas-only/custom editors without that pattern is refused.
- Known password/credential fields, authentication, terminals, protected/system dialogs and sensitive submission controls are refused. Name-based detection is incomplete; complete sensitive actions manually and inspect reviews.
- Blank/protected/minimized captures, changed geometry, stale frames, lost focus or invalid model JSON stop input. Full local access uses your Windows permissions and is not an OS sandbox.
- The small model can miss controls, confuse a page title with a body heading, or misread text. Dense interfaces, animations, small fonts, nonstandard editors and multi-window tasks need more testing. This is not full Codex parity or unattended desktop automation.

See [acceptance evidence](visual-computer-use-qa.md), [security](security-and-computer-use.md) and [privacy](PRIVACY.md).

## Upstream references

The official [Qwen GGUF model card](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF) supplies the Apache-2.0 checkpoint and projector. [llama.cpp multimodal documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md) describes local image inference. Microsoft's [CreateForWindow API](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow) and [free-threaded frame-pool API](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframepool.createfreethreaded) document selected-window capture.
