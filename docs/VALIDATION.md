# Validation

Buji separates application checks from model-quality claims.

## Automated core checks

`npm test` exercises the actual file/command/storage code:

- Relative-path and junction escape rejection
- Exclusive creation, exact-text edits and undo
- Stale-write/stale-undo protection
- Search paths and line numbers
- Restart persistence and history compaction
- Command output, nonzero exit codes and timeout termination
- Legacy-state migration without overwriting a current workspace
- Model-transport redirect rejection

The public CI workflow runs these checks and builds the renderer on Windows with Node.js 24.

## Real-model desktop checks

`npm run test:desktop` uses Electron and a real local Qwen3 Personal WSP server. It creates an isolated project and data directory, then verifies:

1. Desktop startup and model connection
2. A model-created Python file on disk
3. A reviewed command's real output and successful exit
4. Editor save to disk
5. Diff review and undo
6. Chat/theme persistence across restart
7. Model-launcher discovery from a packaged application
8. Archive and restoration without losing the conversation
9. An image attachment reaching the vision model

The release validation report records which checks ran. These tests use a small task; they do not certify general coding ability, factual accuracy, security, or compatibility with every local server.

## Visual evidence

The README screenshots come from the application itself in a disposable test project. The GIF is a sequence of those captures with deliberate frame timing; it is a workflow walkthrough rather than an unedited speed recording.

## Model experiment

The optional Qwen checkpoint recipe is a gradient-free rank-one edit based on a measured residual direction. Its earlier experiment used 48 calibration prompts, eight benign answer continuations and four refusal-prefix probes. Refusal-prefix likelihood is a proxy, not a refusal rate.

The final checkpoint used 30 middle-layer output matrices. A broader initial edit failed an arithmetic check; narrowing the edit preserved that check in the final exported build. This is not a replication of the published Qwen3.5-0.8B math result and establishes no general intelligence gain.

See [the recipe](../tools/model/README.md) for the actual operation and upstream references.
