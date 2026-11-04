# Optional Qwen weight-edit recipe

This directory documents the custom **Qwen3 Personal WSP** checkpoint used to validate Buji. It is optional: the desktop app can connect to a separately configured local model API.

## What the recipe does

It downloads the original `Qwen/Qwen3-VL-4B-Instruct` checkpoint at revision `ebb281ec70b05090aa6165b016eac8ec08e71b17`, then applies a measured unit direction to 30 text-transformer output matrices in zero-based layers 16–30:

```python
W_new = W_original - outer(r, r @ W_original)
```

The targeted matrices are attention output and MLP down projections. No gradient descent or optimizer is involved. The supplied `refusal-direction.npz` contains the 2560-component direction measured at hidden-state index 21 from 48 forward-only calibration prompts. This small vector is provided; full model weights are not.

This is a **WSP-style rank-one projection experiment**, informed by refusal-direction work. It is not a reproduction of the published Qwen3.5-0.8B math experiment, not evidence of general intelligence gains, and not proof that all safeguards or refusals are gone.

## Requirements

- Python 3.12 and the packages in `requirements.txt`, preferably in a separate environment
- About 25 GiB of scratch checkpoint storage, plus final weights and installed dependencies
- A checkout of [llama.cpp](https://github.com/ggml-org/llama.cpp) at `b12099`
- Its `llama-quantize.exe` for Windows
- Converter dependencies from that checkout's `requirements/requirements-convert_hf_to_gguf.txt`

The edit runs on CPU and streams checkpoint files. The script does not need to load the complete model into GPU memory. Inference requirements are separate.

```powershell
python -m venv .venv-model
.\.venv-model\Scripts\Activate.ps1
python -m pip install -r tools/model/requirements.txt
python -m pip install -r C:/Tools/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt

python tools/model/build.py `
  --work-dir work/model-build `
  --output-dir models/BujiModel `
  --llama-source C:/Tools/llama.cpp `
  --quantizer C:/Tools/llama-runtime/llama-quantize.exe
```

The output contains Q4_K_M text weights, an F16 vision projector and provenance metadata. The work directory retains large source/intermediate checkpoints for inspection. Do not use a nonempty output directory or edit your original checkpoint in place.

For an already downloaded base, run `apply_edit.py --base <folder> --output <empty-folder>` directly. That operation only produces an edited Hugging Face checkpoint; conversion and quantization follow separately.

## Evidence and limitations

The earlier full-checkpoint audit checked 713 tensor regions: 30 changed and 683 matched, including 315 vision tensors. The final application/model functional checks cover a small set of tasks. A fixed refusal-prefix likelihood probe is not a refusal-rate evaluation. Different dependency versions, conversion versions or numerical behavior can change resulting bytes and behavior; bit-identical rebuilding across environments is not claimed.

See [Validation](../../docs/VALIDATION.md) and `recipe.json` for the recorded parameters.

## Attribution and licenses

- [Qwen3-VL-4B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct): the original checkpoint follows its Apache-2.0 license. Rebuilding it does not replace that license with Buji's application license.
- [llama.cpp](https://github.com/ggml-org/llama.cpp/tree/b12099): conversion, quantization and serving under its upstream license.
- [Refusal-direction reference](https://github.com/Sumandora/remove-refusals-with-transformers): background for the projection method.
- [Sparks of Weight-Space Programming](https://rikiyat.github.io/blog/weight-space-programming/): broader research context.
