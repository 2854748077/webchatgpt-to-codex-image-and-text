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
  --project "project name" `
  --new-chat
```

Project grouping is required by default for image chats:

- Pass `--project "project name"` whenever the target project is known.
- If omitted, the script uses `CHATGPT_IMAGE_PROJECT` when set.
- If no project is specified, the script first tries `333`, then `222`; if neither exists, it creates `333`.
- Use `--no-project` only when the user explicitly wants to skip moving the image chat into a project.
- Text generation remains opt-in and does not use project grouping by default.

Optionally upload reference images:

```powershell
node D:\codeX\scripts\chatgpt-image.js generate `
  --prompt "use uploaded reference images for character and style consistency" `
  --reference "D:\refs\character.png" `
  --reference "D:\refs\style.webp" `
  --output "output directory" `
  --project "project name" `
  --new-chat
```

Reference image rules:

- `--reference` can be repeated.
- `--reference` may point to one image or a directory of images.
- `--references` may point to a `.txt` or `.list` file with one image path per line.
- The script does not impose a maximum count; the ChatGPT web UI or account may still have practical upload limits.
- Supported image extensions are `png`, `jpg`, `jpeg`, `webp`, and `gif`.

For important outputs, validate after generation:

```powershell
node D:\codeX\scripts\chatgpt-image.js validate --image "image path"
```

The image script already handles:

- inserting Chinese prompt text robustly
- clicking the ChatGPT send button
- detecting text-only replies and retrying with stronger image wording
- uploading optional reference images before prompt submission
- downloading generated images
- moving image chats into a ChatGPT project after successful download
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
