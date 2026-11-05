# Start with Buji V1

## 1. Open the desktop application

Download the Windows x64 ZIP from [Releases](https://github.com/Devchandrasen/buji/releases/latest), extract the whole folder, and open `Start-Buji.cmd` or `app/Buji.exe`. Keep the application files together.

The app starts without a model, but sending a message requires a running local model API.

## 2. Connect your local model

Open **Settings**:

| Field | Validated Qwen profile |
| --- | --- |
| API endpoint | `http://127.0.0.1:8088/v1` |
| Model ID | `qwen3-personal-wsp` |
| Model launcher | Your existing `Start-Qwen3.ps1`, if present |

If this profile is already installed nearby, Buji detects its launcher. Otherwise, use an existing local API and its exact model ID, or follow [Models](MODELS.md) to create a launcher. Only unauthenticated localhost endpoints are supported in V1.

## 3. Select a folder

Choose **Open project folder**. The selected folder becomes the file-tool workspace for that conversation. New chat starts another conversation in the current project; the **+** beside Chats starts a general conversation.

## 4. Try a small task

```text
Explore this project and explain how it works. Read the relevant files.
```

```text
Create a small Python script that prints Hello, Buji. Run it and show the output.
```

```text
Read the Markdown files in this folder and create project-brief.md with a summary
and a short list of next steps. Use the file tools to save it.
```

**Agent** mode enables file and command tools. **Chat** mode answers without those tools. The **+** button attaches an image; the paperclip attaches the open text file.

You do not need to ask the model to “use tools.” A build request in Agent mode should create files and check them. The workspace line shows the selected folder; **Open folder** opens it in Windows Explorer. General chats are labeled **Chat only** and cannot change project files.

## 5. Review the work

- Open **Files and changes** to browse the project or inspect diffs.
- Save editor changes with `Ctrl+S`.
- A proposed PowerShell command appears before execution when command review is enabled.
- Click **Run command** to approve it. Scripted standard input is shown too, when supplied.
- The result card lists actual saved files and command exit codes. **Incomplete** means the required actions or checks did not finish; it is not a success claim.
- Undo an edit from **Changes**. Buji checks for later external edits before restoring a file.
- Restore archived conversations in **Settings → Archived chats**.

The terminal runs individual non-interactive commands. Agent commands can supply scripted standard input for CLI tests. It does not provide an interactive shell/PTY session; play keyboard-driven programs in a separate terminal.

## Existing QwenDesk users

On its first normal launch, Buji copies a recognized previous QwenDesk history database into `%APPDATA%\BujiV1` if a Buji database does not already exist. The original is left intact; existing project paths continue pointing to the same folders. Set `BUJI_MIGRATE_LEGACY=0` to skip this copy.

## Closing the app

Closing Buji cancels its active work but leaves a separately running/shared model server available. Use that server's own stop controls to release its GPU memory.
