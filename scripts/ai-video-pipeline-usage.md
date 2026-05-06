# AI Video Pipeline 使用说明

`ai-video-pipeline.ps1` 是通用总控脚本，用于把剧本项目整理成图片生成、质量检测、关键帧视频 prompt 输出的一套流程。

底层出图和图片检测使用：

```powershell
D:\codeX\scripts\chatgpt-image.js
```

## 基本命令

完整流程：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "C:\Users\39924\Desktop\ai视频生成\完美世界一分钟宣传片" `
  -Docx "C:\Users\39924\Desktop\ai视频生成\完美世界一分钟宣传片\完美世界.docx" `
  -Mode all
```

只生成图片：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "C:\Users\39924\Desktop\ai视频生成\完美世界一分钟宣传片" `
  -Mode image
```

只做图片质量检测：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "C:\Users\39924\Desktop\ai视频生成\完美世界一分钟宣传片" `
  -Mode validate
```

只生成视频 prompt：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "C:\Users\39924\Desktop\ai视频生成\完美世界一分钟宣传片" `
  -Mode video-prompts
```

## 参数说明

| 参数 | 必填 | 说明 |
|---|---:|---|
| `-ProjectDir` | 是 | 项目根目录。所有图片、prompt、报告都会放在这里。 |
| `-Docx` | 否 | 剧本 Word 文档路径。`extract` 或 `all` 阶段需要。 |
| `-Mode` | 否 | 流程阶段，默认 `all`。 |
| `-Config` | 否 | 自定义配置文件路径，默认使用项目目录下的 `项目配置.json`。 |
| `-Force` | 否 | 强制重新生成已有图片。 |
| `-MaxAttempts` | 否 | 每张图最多生成尝试次数，默认 `3`。 |

## Mode 说明

| Mode | 功能 |
|---|---|
| `extract` | 从 `.docx` 提取剧本文本，输出 `剧本文本.txt`。 |
| `plan` | 创建项目配置、目录和图片提示词模板。已有提示词文件不会覆盖。 |
| `prepare` | 创建标准目录结构。 |
| `image` | 按提示词清单批量调用 ChatGPT 生成图片，并自动检测质量。 |
| `validate` | 遍历 `照片` 目录，生成图片质量检测报告。 |
| `video-prompts` | 根据已生成图片输出关键帧视频生成 prompt，并列出参考图。 |
| `all` | 依次执行 `extract`、`plan`、`image`、`validate`、`video-prompts`。 |

## 项目目录结构

标准结构如下：

```text
项目目录
├─ 项目配置.json
├─ 剧本文本.txt
├─ 重新生成_图片提示词.tsv
├─ 重新生成_分镜与关键词.md
├─ 重新生成_分镜与关键词.csv
├─ 关键帧视频生成Prompt_含参考图.md
├─ 关键帧视频生成Prompt_含参考图.csv
├─ 照片
│  ├─ 01_人物主体白底
│  ├─ 02_人物多视角
│  ├─ 03_环境图
│  ├─ 04_场景图
│  └─ 05_分镜关键帧
└─ 质量报告
   └─ 图片质量检测报告.csv
```

## 图片提示词 TSV 格式

文件：

```text
重新生成_图片提示词.tsv
```

每行 5 列，使用 Tab 分隔：

```text
分类	文件名	类型	图片生成Prompt	视频生成Prompt
```

示例：

```text
05_分镜关键帧	10_大荒开场关键帧	分镜关键帧	大荒深处万山沉寂，远古凶兽黑色剪影在云雾山脉间咆哮，4K超清，无明显噪点。	0:00-0:06，超广角航拍俯冲，云雾被震散，巨兽咆哮带出冲击波。
```

## 生成顺序建议

为了让主体一致，建议提示词清单按下面顺序排列：

1. `01_人物主体白底`
2. `02_人物多视角`
3. `03_环境图`
4. `04_场景图`
5. `05_分镜关键帧`

## 图片质量检测

单张图片检测：

```powershell
node D:\codeX\scripts\chatgpt-image.js validate --image "图片路径"
```

检测内容：

- 图片宽高
- 文件大小
- 清晰度指标
- 噪点指标

默认阈值在 `项目配置.json` 的 `quality` 字段中：

```json
{
  "minWidth": 1024,
  "minHeight": 720,
  "minBytes": 180000,
  "minSharpness": 18,
  "maxNoise": 42
}
```

## ChatGPT 浏览器要求

运行出图前，需要本地 Chrome 已开启远程调试，并已登录 ChatGPT。

检查：

```powershell
node D:\codeX\scripts\chatgpt-image.js check
```

如果不可用，启动可接管 Chrome：

```powershell
node D:\codeX\scripts\chatgpt-image.js launch --force-close
```

## 常见问题

### 1. 图片已经存在但想重新生成

加 `-Force`：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "你的项目目录" `
  -Mode image `
  -Force
```

### 2. ChatGPT 回复文字，不出图

`chatgpt-image.js` 已内置文字回复检测和强化提示词重试：

- `--text-retry-delay`
- `--text-retries`

总控脚本会自动传入默认值。

### 3. 图片质量不通过

总控脚本会自动删除失败图片并重试。可以在配置里调整阈值，但不要把阈值调得过低，否则检测失去意义。

### 4. 视频 prompt 没有参考图

先确认图片已生成：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "你的项目目录" `
  -Mode image
```

再生成视频 prompt：

```powershell
powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir "你的项目目录" `
  -Mode video-prompts
```

## 当前项目示例

```powershell
$project = "C:\Users\39924\Desktop\ai视频生成\完美世界一分钟宣传片"

powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir $project `
  -Mode validate

powershell -ExecutionPolicy Bypass -File D:\codeX\scripts\ai-video-pipeline.ps1 `
  -ProjectDir $project `
  -Mode video-prompts
```

