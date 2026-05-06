---
name: chatgpt-web-image
description: Use when Codex should generate or regenerate images through the locally open Chrome ChatGPT web UI, download images to local folders, validate image quality, or run the AI video image pipeline. Do not use for text-only ChatGPT replies unless the user explicitly asks to use local ChatGPT web text generation, chatgpt-text.js, or says the text must come from the ChatGPT web UI.
---

# ChatGPT Web Image

## Default Behavior

Use this skill by default for image-generation tasks that mention any of:

- local Chrome ChatGPT web UI
- ChatGPT web image generation
- generate image and download locally
- regenerate keyframes, scene images, character sheets, environment images
- validate image quality, noise, clarity, 4K look
- AI video image pipeline or storyboard keyframes

Do not use text generation by default. Only use `chatgpt-text.js` when the user explicitly asks for local ChatGPT web text output, names `chatgpt-text.js`, or says text must be generated through the ChatGPT web UI.

## Preconditions

Check the local Chrome CDP endpoint before generation:

```powershell
node D:\codeX\scripts\chatgpt-image.js check
```

If unavailable, start a controllable Chrome instance:

```powershell
node D:\codeX\scripts\chatgpt-image.js launch --force-close
```

The browser must be logged into ChatGPT.

## Image Generation

Generate one image:

```powershell
node D:\codeX\scripts\chatgpt-image.js generate `
  --prompt "image prompt" `
  --output "output directory" `
  --new-chat
```

For important outputs, validate after generation:

```powershell
node D:\codeX\scripts\chatgpt-image.js validate --image "image path"
```

The image script already handles:

- inserting Chinese prompt text robustly
- clicking the ChatGPT send button
- detecting text-only replies and retrying with stronger image wording
- downloading generated images
- validating dimensions, file size, sharpness, and noise

## Batch Video Asset Pipeline

Use the pipeline for projects with scripts, storyboard prompts, image generation, validation, and video prompts:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "project directory" `
  -Docx "script.docx" `
  -Mode all
```

Common stages:

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 -ProjectDir "project directory" -Mode image
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 -ProjectDir "project directory" -Mode validate
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 -ProjectDir "project directory" -Mode video-prompts
```

Use `-Force` to regenerate existing images.

## Text Generation Is Opt-In Only

Do not call this for ordinary text-writing tasks. Use normal Codex reasoning unless the user explicitly requests the text come from the local ChatGPT web page.

When explicitly requested, reuse the saved text session:

```powershell
node D:\codeX\scripts\chatgpt-text.js ask --prompt "text prompt"
```

Save text output:

```powershell
node D:\codeX\scripts\chatgpt-text.js ask `
  --prompt-file "prompt.txt" `
  --output "answer.md"
```

Text session rules:

- Do not pass `--new-chat`, `--reset-session`, or `--allow-new-chat` unless the user explicitly approves creating or replacing the text session.
- Check the saved text session with `node D:\codeX\scripts\chatgpt-text.js session status`.
- Open it with `node D:\codeX\scripts\chatgpt-text.js session open`.
- Clear it only when the user asks: `node D:\codeX\scripts\chatgpt-text.js session clear`.

## Output Discipline

After running generation:

- Report exact output paths.
- For batches, count generated files and check for temporary `chatgpt-image-*` leftovers.
- Run validation when quality matters.
- If ChatGPT returns text instead of an image, retry through the image script rather than manually pasting partial prompts.
