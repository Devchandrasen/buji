# Local model setup

Buji is a desktop client and coding agent. It does not include model weights in its source repository or Windows ZIP.

## Tested backend

| Component | Validated configuration |
| --- | --- |
| Inference server | llama.cpp b12099, Windows x64 CUDA 13.4 |
| Model | Custom Qwen3 Personal WSP, based on Qwen3-VL-4B-Instruct |
| Quantization | Q4_K_M text weights + F16 vision projector |
| Weight storage | About 3.10 GiB combined |
| Device | RTX 5060 Laptop GPU, 8 GB VRAM |
| System RAM | About 16 GB |
| Context | 8192 tokens |
| Serving | One slot, flash attention, Q8 KV cache |
| Endpoint | `http://127.0.0.1:8088/v1` |
| Served model ID | `qwen3-personal-wsp` |

This is a functional test configuration, not a minimum-hardware certification or a broad performance benchmark.

## Option A: keep an existing local server

Start your model server, then enter its local API endpoint and exact model ID in Buji Settings. The server should expose:

- `GET /v1/models`
- Streaming `POST /v1/chat/completions`
- OpenAI-style function calling for Agent mode
- Image content parts for vision, if needed

The endpoint must use `localhost`, `127.0.0.1` or IPv6 loopback. Redirects are rejected. V1 does not send authentication headers. Compatibility with other local servers/models is not established merely because they describe themselves as OpenAI-compatible; validate tool calls and cancellation before relying on them.

## Option B: create a launcher for existing GGUF files

Download an appropriate Windows llama.cpp runtime from its [official releases](https://github.com/ggml-org/llama.cpp/releases). For the validated CUDA build, extract both the runtime archive and its matching CUDA runtime DLL archive into the same directory. Obtain your model/projector files separately under their own licenses.

From a source checkout:

```powershell
.\tools\setup-backend.ps1 `
  -ModelPath "C:\Models\Qwen3-Personal-WSP-Q4_K_M.gguf" `
  -ProjectorPath "C:\Models\mmproj-Qwen3-Personal-f16.gguf" `
  -RuntimeDirectory "C:\Tools\llama.cpp" `
  -Destination ".\models\backend"
```

The helper writes `Start-Model.ps1` and `Stop-Model.ps1` without copying the weights. Select the generated start script in Buji Settings. Defaults match the tested model ID and port above. The model ID is a server alias; it does not verify the provenance of files you provide.

The helper itself does not download or execute a model until you run the generated launcher. Choose runtime and GPU options appropriate to your machine. CPU/other-GPU configurations need separate validation.

## Rebuild the custom WSP-style checkpoint

The optional [model recipe](../tools/model/README.md) includes the measured direction vector and a direct BF16 tensor-edit implementation. It starts from a pinned original Qwen checkpoint and then uses the upstream converter/quantizer. This requires substantial downloads and scratch space; it is not part of normal app installation.

The custom build is experimental and refusal-reduced. The available evaluation does not prove complete removal of refusals, absence of bias, or better general reasoning.

## Upstream sources

- [Original Qwen3-VL-4B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) — model and model license
- [llama.cpp](https://github.com/ggml-org/llama.cpp) — serving, conversion and quantization
- [Weight-space programming research](https://rikiyat.github.io/blog/weight-space-programming/) — context for gradient-free weight editing
