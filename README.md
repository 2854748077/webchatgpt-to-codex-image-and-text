# Web ChatGPT to Codex Image and Text

这个仓库提供一组本地自动化脚本，让 Codex 通过已登录的 Chrome ChatGPT 网页版完成：

- 图片生成、下载与质量验证。
- 文本生成、保存到本地文件，并按规则复用同一个 ChatGPT 网页会话。
- AI 视频项目素材流水线：分镜/关键帧图片目录准备、批量图片生成、质量报告、视频 prompt 输出。
- Codex skill：`chatgpt-web-image`，用于让 Codex 优先调用这些本地脚本。

## 环境要求

- Windows
- Node.js / npm
- Google Chrome
- 已在 Chrome 中登录 ChatGPT

安装依赖：

```powershell
npm install
```

## Chrome 调试端口

检查当前 Chrome 是否可被脚本接管：

```powershell
npm run chatgpt:check
```

如果不可用，启动一个带远程调试端口的 Chrome：

```powershell
npm run chatgpt:launch
```

或强制关闭现有 Chrome 后启动：

```powershell
node scripts\chatgpt-image.js launch --force-close
```

默认 CDP 地址是：

```text
http://127.0.0.1:9222
```

## 图片生成

生成一张图片：

```powershell
npm run chatgpt:image -- --prompt "cat" --output output\chatgpt-images --new-chat --validate
```

脚本会自动把图片提示词规范成：

```text
生成照片：cat
```

如果 ChatGPT 返回文字而不是图片，脚本会延时检测并尝试用更强的图片生成提示词重试。

可选上传参考图：

```powershell
node scripts\chatgpt-image.js generate `
  --prompt "参考上传图片的角色外观，生成电影感场景图" `
  --reference "D:\refs\character.png" `
  --output output\chatgpt-images `
  --new-chat `
  --validate
```

多个参考图可以重复传 `--reference`，脚本本身不设数量上限：

```powershell
node scripts\chatgpt-image.js generate `
  --prompt "综合这些参考图，生成统一风格的关键帧" `
  --reference "D:\refs\character.png" `
  --reference "D:\refs\environment.png" `
  --reference "D:\refs\style.webp"
```

也可以传目录或清单文件：

```powershell
node scripts\chatgpt-image.js generate --prompt "按参考图生成" --reference "D:\refs"
node scripts\chatgpt-image.js generate --prompt "按参考图生成" --references "D:\refs\list.txt"
```

清单文件每行一个图片路径，支持空行和 `#` 注释。支持的图片类型：`png`、`jpg`、`jpeg`、`webp`、`gif`。

独立验证图片：

```powershell
node scripts\chatgpt-image.js validate --image output\chatgpt-images\example.png
```

## 文本生成

文本生成默认不是 Codex 的自动行为，只有你明确要求使用本地 ChatGPT 网页版生成文本时才调用。

第一次创建文本会话必须明确允许：

```powershell
node scripts\chatgpt-text.js ask --prompt "只回复 OK" --allow-new-chat
```

之后默认复用同一个网页版聊天：

```powershell
node scripts\chatgpt-text.js ask --prompt "继续刚才的话题，只回复 OK2"
```

保存回复到文件：

```powershell
node scripts\chatgpt-text.js ask --prompt "生成长文本" --output output\answer.md
```

会话管理：

```powershell
node scripts\chatgpt-text.js session status
node scripts\chatgpt-text.js session open
node scripts\chatgpt-text.js session clear
```

脚本规则：

- 没有保存的文本会话时，默认不自动新建。
- 只有 `--allow-new-chat`、`--new-chat` 或 `--reset-session` 才允许创建或替换会话。
- 已有会话时默认打开保存的 `/c/...` 聊天链接并继续使用。

## AI 视频素材流水线

准备项目目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ai-video-pipeline.ps1 `
  -ProjectDir output\my-video-project `
  -Mode prepare
```

常用阶段：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ai-video-pipeline.ps1 -ProjectDir output\my-video-project -Mode plan
powershell -ExecutionPolicy Bypass -File scripts\ai-video-pipeline.ps1 -ProjectDir output\my-video-project -Mode image
powershell -ExecutionPolicy Bypass -File scripts\ai-video-pipeline.ps1 -ProjectDir output\my-video-project -Mode validate
powershell -ExecutionPolicy Bypass -File scripts\ai-video-pipeline.ps1 -ProjectDir output\my-video-project -Mode video-prompts
```

## Codex Skill

Skill 文件在：

```text
skills/chatgpt-web-image/SKILL.md
```

安装到本机 Codex：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills\chatgpt-web-image"
Copy-Item skills\chatgpt-web-image\SKILL.md "$env:USERPROFILE\.codex\skills\chatgpt-web-image\SKILL.md" -Force
```

安装后，图片生成相关任务会优先使用这个 skill。文本生成不会默认启用，必须明确要求本地 ChatGPT 网页版文本生成。

## npm 命令

```powershell
npm run chatgpt:launch
npm run chatgpt:check
npm run chatgpt:image -- --prompt "cat"
npm run chatgpt:text -- --prompt "只回复 OK"
npm run chatgpt:text-check
```

## 注意

- 这些脚本依赖 ChatGPT 网页 UI，ChatGPT 改版后可能需要调整选择器。
- 脚本消耗的是你当前 ChatGPT 网页账号的可用能力。
- 如果网页出现验证码、风控确认、登录过期或升级提示，自动化可能会中断。
- `output/`、Chrome profile 和 `node_modules/` 不应提交到仓库。
