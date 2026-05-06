# ChatGPT Text Web Automation 使用说明

`chatgpt-text.js` 用于调用本地已打开的 Chrome ChatGPT 网页版，提交文本提示词，并把 ChatGPT 的文字回复输出到控制台或保存到文件。

## 前置条件

Chrome 必须开启远程调试，并且 ChatGPT 网页已登录。

检查：

```powershell
node D:\codeX\scripts\chatgpt-text.js check
```

如果不可用，先启动可接管 Chrome：

```powershell
node D:\codeX\scripts\chatgpt-image.js launch --force-close
```

## 基本用法

第一次使用需要你明确允许创建文本会话：

```powershell
node D:\codeX\scripts\chatgpt-text.js ask --prompt "只回复 OK" --allow-new-chat
```

之后默认复用同一个网页版聊天：

```powershell
node D:\codeX\scripts\chatgpt-text.js ask --prompt "继续刚才的话题，只回复 OK2"
```

保存回复到文件：

```powershell
node D:\codeX\scripts\chatgpt-text.js ask `
  --prompt "把这个剧本整理成 9 个分镜" `
  --output "D:\codeX\output\answer.md"
```

从提示词文件读取：

```powershell
node D:\codeX\scripts\chatgpt-text.js ask `
  --prompt-file "D:\codeX\prompt.txt" `
  --output "D:\codeX\output\answer.md"
```

## 会话管理

默认会话文件：

```text
D:\codeX\output\chatgpt-text-session.json
```

查看当前会话：

```powershell
node D:\codeX\scripts\chatgpt-text.js session status
```

打开当前会话：

```powershell
node D:\codeX\scripts\chatgpt-text.js session open
```

清空当前会话记录：

```powershell
node D:\codeX\scripts\chatgpt-text.js session clear
```

主动换新会话：

```powershell
node D:\codeX\scripts\chatgpt-text.js ask --prompt "开启新的文本会话" --new-chat
```

如果没有会话文件，脚本默认不会擅自创建新会话。你需要明确允许：

```powershell
node D:\codeX\scripts\chatgpt-text.js ask --prompt "初始化文本会话" --allow-new-chat
```

## npm 快捷命令

```powershell
npm run chatgpt:text-check
npm run chatgpt:text -- --prompt "只回复 OK" --new-chat
```

## 参数

| 参数 | 说明 |
|---|---|
| `--prompt` | 直接传入提示词。 |
| `--prompt-file` | 从文本文件读取提示词。 |
| `--output` | 保存 ChatGPT 回复到指定文件。 |
| `--new-chat` | 主动创建并保存新文本会话。 |
| `--reset-session` | 主动重置并保存新文本会话。 |
| `--allow-new-chat` | 当没有会话文件时，允许初始化新文本会话。 |
| `--session-file` | 指定会话文件，默认 `D:\codeX\output\chatgpt-text-session.json`。 |
| `--timeout` | 等待回复超时时间，默认 `300000` 毫秒。 |
| `--cdp-url` | 指定 Chrome CDP 地址，默认 `http://127.0.0.1:9222`。 |
| `--port` | 指定调试端口，默认 `9222`。 |

## 适用场景

- 生成分镜文本。
- 生成关键帧图片 prompt。
- 生成视频 prompt。
- 整理文案、摘要、表格内容。
- 任何需要使用 ChatGPT 网页版输出文本的自动化任务。
