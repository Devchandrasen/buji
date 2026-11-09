# Optional visual runtime notices

These components are installed separately from Buji. They retain their upstream licenses and do not require a paid API. Python dependency versions are pinned in `tools/vision-requirements.txt`.

| Component | License and source |
| --- | --- |
| Qwen3-VL-2B-Instruct GGUF and Q8 projector | Apache-2.0; [official model card](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF). Setup saves `BujiVision/LICENSE-QWEN.txt`. |
| llama.cpp | MIT; [upstream license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE). Reuses a separately installed official runtime. |
| Python 3.12 | PSF; [license](https://docs.python.org/3.12/license.html). |
| Pillow 13.0.0 | MIT-CMU; installed package includes its license. |
| PyWinRT runtime and Windows projection packages | MIT; [upstream license](https://github.com/pywinrt/pywinrt/blob/main/LICENSE). Installed wheels retain notices. |
| typing_extensions 4.16.0 | PSF-2.0; installed package retains its notice. |

Windows Graphics Capture and SendInput are Windows system APIs. Buji uses public APIs and does not redistribute a proprietary Codex computer-use runtime. No model weights are checked into the app repository.
