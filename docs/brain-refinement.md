# Buji Brain: local refinement

This work refines how Buji runs its existing open-weight OmniCoder-9B checkpoint. It is an **inference/serving profile**, not a newly trained or merged checkpoint. Original model files are retained. No hosted teacher API or cloud training is involved.

The [research decision](brain-refinement-research.md) explains the model shortlist, licenses and memory constraints. Previous local merging and weight-space experiments did not establish a replacement that improved all required domains. This iteration therefore tests the deployment before making more weight edits.

## Recipe

- OmniCoder-9B Q4_K_M remains the coding/tool/reasoning parent. The exact deployed parent hash is recorded in the experiment protocol.
- A short-math candidate uses the original parent with zero WSP scales and a concise derivation instruction: look for a simple structure, check restrictions, retain the requested answer format and avoid repeated algebra. Development also tests bounded 256/512-token thinking. More thinking is not assumed to help.
- Coding/reasoning requests keep their existing generation payload. Tool-capable requests and structured-response requests are excluded from prompt refinement. An explicit thinking-off request is respected.
- The installed context can be set to 8192 after a real long-reference check. Prompt caching stays disabled to preserve the original comparison's generation behavior.
- Explicit number-only questions containing a simple binary expression or numeric percentage can use an exact local BigInt/fraction calculator. It supports English, Hindi digits and a narrow set of Hindi/Hinglish phrases. It uses no eval, shell, network or model call. Unsupported expressions retain the model path; this is not a general symbolic algebra system.
- The separate local Qwen3-VL visual model and voice engines remain separate capabilities. Brain optimization cannot bypass their access/review controls.

The final selected/installed profile and held-out metrics are recorded in `outputs/BujiBrain-Refined/REPORT.md` in this workspace. A development winner is not automatically the installed default; it must pass the frozen promotion gate. If it fails, retain `current-wsp` while keeping any independently validated serving improvement.

## Evaluation

Development and held-out task IDs are disjoint from all prior local WSP/router subsets. The final comparison uses 16 numeric MATH-500 questions, 10 HumanEval functions and 10 BIG-Bench Hard questions, with two fixed seeds per question and both profiles in randomized order. Graders use exact numeric/option answers and independently supplied function tests. The code worker restricts imports/operations and has a timeout; it is defense in depth, not an OS sandbox.

The candidate is selected from development only. Math promotion requires at least two net additional correct final responses, no new coding/reasoning failures, unchanged protected generation requests, no candidate truncation/errors, and median math latency no more than 2.5 times the control. Confidence intervals group repeated seeds by question. A small subset cannot prove universal quality or no regression on every task.

All failed/truncated trials are retained. An additional concise candidate is motivated by development-set output exhaustion, documented before any held-out inference. No private chats are used for training or grading. A real Buji Agent file workflow and local visual-model coexistence are separate product smoke tests.

## Inspect and configure

The endpoint/model ID remains `http://127.0.0.1:8093/v1` / `buji-v2-routed`. Inspect its current profile without revealing internal API credentials:

```powershell
Invoke-RestMethod http://127.0.0.1:8093/health
```

`outputs/BujiV2-Router/brain.json` selects the profile and 4096/8192 context. The installed default remains Standard (current WSP routing, 8192 context) plus the exact arithmetic guard. Fast Math is optional because the strict zero-truncation gate failed. Finish current work, then run the installed switcher in `outputs/BujiV2-Router`:

```powershell
.\Set-Buji-Brain.ps1 -Preset FastMath  # Concise math candidate, 8192 context
.\Set-Buji-Brain.ps1 -Preset Standard  # Retained default routing, 8192 context
.\Set-Buji-Brain.ps1 -Preset Legacy    # Earlier routing/context4096; arithmetic guard remains
```

The switcher refuses active model work, backs up the config, and restores it if startup fails. Model weights, personal chats and project settings are not rewritten. A full old-backend source backup is retained in the experiment's backups directory.

Source modules are in `tools/brain/`: `profile.cjs`, `arithmetic.cjs`, `router.cjs`, `gateway.cjs`, `service.cjs`. They are staged into the existing `outputs/BujiV2-Router` deployment layout; the service is not intended to be launched directly from the source-tools directory. It requires the already-installed pinned model, native runtime and WSP artifacts. Run `npm test` for CPU-only regression checks. The experiment scripts under `work/buji-brain` produce protocol, raw traces, grades and CSV in `outputs/BujiBrain-Refined`.

The concise candidate targets short calculation/solution requests. The small model can still make mathematical or language errors; review the reasoning and independently test important work. This release does not claim global-best performance or that a prompt profile adds knowledge to its underlying weights.
