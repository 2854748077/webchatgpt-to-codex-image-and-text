param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir,

  [string]$Docx,

  [ValidateSet("all", "extract", "plan", "prepare", "image", "validate", "video-prompts")]
  [string]$Mode = "all",

  [string]$Config = "",

  [switch]$Force,

  [int]$MaxAttempts = 3
)

$ErrorActionPreference = "Stop"

function U([int[]]$CodePoints) {
  return -join ($CodePoints | ForEach-Object { [char]$_ })
}

function ZH($Key) {
  $map = @{
    Config = @(0x9879,0x76EE,0x914D,0x7F6E)
    Photo = @(0x7167,0x7247)
    PromptFile = @(0x91CD,0x65B0,0x751F,0x6210,0x005F,0x56FE,0x7247,0x63D0,0x793A,0x8BCD)
    StoryMd = @(0x91CD,0x65B0,0x751F,0x6210,0x005F,0x5206,0x955C,0x4E0E,0x5173,0x952E,0x8BCD)
    VideoPrompt = @(0x5173,0x952E,0x5E27,0x89C6,0x9891,0x751F,0x6210,0x0050,0x0072,0x006F,0x006D,0x0070,0x0074,0x005F,0x542B,0x53C2,0x8003,0x56FE)
    ScriptText = @(0x5267,0x672C,0x6587,0x672C)
    QualityReport = @(0x56FE,0x7247,0x8D28,0x91CF,0x68C0,0x6D4B,0x62A5,0x544A)
    VideoPromptDir = @(0x89C6,0x9891,0x0050,0x0072,0x006F,0x006D,0x0070,0x0074)
    QualityDir = @(0x8D28,0x91CF,0x62A5,0x544A)
    Cat1 = @(0x0030,0x0031,0x005F,0x4EBA,0x7269,0x4E3B,0x4F53,0x767D,0x5E95)
    Cat2 = @(0x0030,0x0032,0x005F,0x4EBA,0x7269,0x591A,0x89C6,0x89D2)
    Cat3 = @(0x0030,0x0033,0x005F,0x73AF,0x5883,0x56FE)
    Cat4 = @(0x0030,0x0034,0x005F,0x573A,0x666F,0x56FE)
    Cat5 = @(0x0030,0x0035,0x005F,0x5206,0x955C,0x5173,0x952E,0x5E27)
  }
  return U $map[$Key]
}

function Get-RepoRoot {
  return Split-Path -Parent $PSScriptRoot
}

function Get-ChatGptScript {
  return Join-Path (Get-RepoRoot) "scripts\chatgpt-image.js"
}

function Get-ConfigPath {
  if ($Config) { return $Config }
  return Join-Path $ProjectDir ((ZH Config) + ".json")
}

function Resolve-ProjectPath($PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return Join-Path $ProjectDir $PathValue
}

function Read-JsonFile($Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Encoding UTF8 -Raw | ConvertFrom-Json
}

function Write-JsonFile($Path, $Object) {
  $Object | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Ensure-Config {
  $configPath = Get-ConfigPath
  $configObject = Read-JsonFile $configPath
  if ($null -ne $configObject) { return $configObject }

  $default = [ordered]@{
    title = Split-Path -Leaf $ProjectDir
    scriptDocx = $Docx
    promptFile = (ZH PromptFile) + ".tsv"
    storyboardMarkdown = (ZH StoryMd) + ".md"
    storyboardCsv = (ZH StoryMd) + ".csv"
    videoPromptMarkdown = (ZH VideoPrompt) + ".md"
    videoPromptCsv = (ZH VideoPrompt) + ".csv"
    photoDir = ZH Photo
    imageCategories = @((ZH Cat1), (ZH Cat2), (ZH Cat3), (ZH Cat4), (ZH Cat5))
    quality = [ordered]@{
      minWidth = 1024
      minHeight = 720
      minBytes = 180000
      minSharpness = 18
      maxNoise = 42
    }
    generation = [ordered]@{
      timeout = 900000
      textRetryDelay = 60000
      textRetries = 2
      maxAttempts = $MaxAttempts
    }
  }
  New-Item -ItemType Directory -Force -Path $ProjectDir | Out-Null
  Write-JsonFile $configPath $default
  return Read-JsonFile $configPath
}

function Invoke-Extract {
  $cfg = Ensure-Config
  $sourceDocx = $Docx
  if (-not $sourceDocx -and $cfg.scriptDocx) { $sourceDocx = Resolve-ProjectPath ([string]$cfg.scriptDocx) }
  if (-not $sourceDocx -or -not (Test-Path -LiteralPath $sourceDocx)) {
    throw "Docx not found. Pass -Docx or set scriptDocx in config."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($sourceDocx)
  try {
    $entry = $zip.GetEntry("word/document.xml")
    if (-not $entry) { throw "word/document.xml not found in docx." }
    $reader = [System.IO.StreamReader]::new($entry.Open(), [System.Text.Encoding]::UTF8)
    try { $xml = $reader.ReadToEnd() } finally { $reader.Close() }
  } finally {
    $zip.Dispose()
  }

  $matches = [regex]::Matches($xml, '<w:t[^>]*>(.*?)</w:t>')
  $parts = foreach ($m in $matches) { [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value) }
  $text = ($parts -join "") -replace "(\u3002|\uFF01|\uFF1F|\uFF1B)", "`$1`n"
  $out = Join-Path $ProjectDir ((ZH ScriptText) + ".txt")
  $text | Set-Content -LiteralPath $out -Encoding UTF8
  Write-Host "Extracted script text: $out"
}

function Invoke-Prepare {
  $cfg = Ensure-Config
  $photoDir = Resolve-ProjectPath ([string]$cfg.photoDir)
  New-Item -ItemType Directory -Force -Path $photoDir | Out-Null
  foreach ($category in $cfg.imageCategories) {
    New-Item -ItemType Directory -Force -Path (Join-Path $photoDir ([string]$category)) | Out-Null
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir (ZH VideoPromptDir)) | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir (ZH QualityDir)) | Out-Null
  Write-Host "Prepared project directories under: $ProjectDir"
}

function Invoke-Plan {
  $cfg = Ensure-Config
  Invoke-Prepare
  $promptFile = Resolve-ProjectPath ([string]$cfg.promptFile)
  if (-not (Test-Path -LiteralPath $promptFile)) {
    $template = @(
      ((ZH Cat1) + "`t01_subject_white_bg`tcharacter`tFill character white background prompt here.`tReference only."),
      ((ZH Cat2) + "`t02_subject_turnaround`tcharacter_views`tFill character turnaround prompt here.`tReference only."),
      ((ZH Cat3) + "`t03_environment`tenvironment`tFill environment prompt here.`tFill environment video movement prompt here."),
      ((ZH Cat4) + "`t04_scene`tscene`tFill scene prompt here.`tFill scene video movement prompt here."),
      ((ZH Cat5) + "`t05_keyframe`tkeyframe`tFill storyboard keyframe prompt here.`tFill video generation prompt here.")
    )
    $template | Set-Content -LiteralPath $promptFile -Encoding UTF8
    Write-Host "Created prompt template: $promptFile"
  } else {
    Write-Host "Prompt file already exists: $promptFile"
  }
}

function Get-PromptItems {
  $cfg = Ensure-Config
  $promptFile = Resolve-ProjectPath ([string]$cfg.promptFile)
  if (-not (Test-Path -LiteralPath $promptFile)) {
    throw "Prompt file not found: $promptFile. Run -Mode plan first."
  }
  return Get-Content -LiteralPath $promptFile -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object {
    $parts = $_ -split "`t", 5
    if ($parts.Count -lt 5) { throw "Bad prompt row, expected 5 tab-separated fields: $_" }
    [pscustomobject]@{
      Category = $parts[0]
      Name = $parts[1]
      Type = $parts[2]
      Prompt = $parts[3]
      VideoPrompt = $parts[4]
    }
  }
}

function Get-SafeFileName([string]$Name) {
  return $Name -replace '[\\/:*?"<>|]', "_"
}

function Get-RelativeProjectPath([string]$FullPath) {
  $base = (Resolve-Path -LiteralPath $ProjectDir).Path.TrimEnd('\') + '\'
  $full = (Resolve-Path -LiteralPath $FullPath).Path
  if ($full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $full.Substring($base.Length)
  }
  return $full
}

function Get-RetrySuffix {
  return " Retry: sharper, cleaner, consistent subject, 4K look, no visible noise, no text, no watermark."
}

function Invoke-ValidateImage($ImagePath) {
  $cfg = Ensure-Config
  $q = $cfg.quality
  $chatgptScript = Get-ChatGptScript
  node $chatgptScript validate --image $ImagePath --min-width $q.minWidth --min-height $q.minHeight --min-bytes $q.minBytes --min-sharpness $q.minSharpness --max-noise $q.maxNoise
  return $LASTEXITCODE -eq 0
}

function Invoke-Image {
  Invoke-Prepare
  $cfg = Ensure-Config
  $photoDir = Resolve-ProjectPath ([string]$cfg.photoDir)
  $chatgptScript = Get-ChatGptScript
  $items = Get-PromptItems
  $max = [int]$cfg.generation.maxAttempts
  if ($MaxAttempts -gt 0) { $max = $MaxAttempts }

  foreach ($item in $items) {
    $safeName = Get-SafeFileName $item.Name
    $categoryDir = Join-Path $photoDir $item.Category
    New-Item -ItemType Directory -Force -Path $categoryDir | Out-Null
    $existing = Get-ChildItem -LiteralPath $categoryDir -File -Filter "$safeName.*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and -not $Force) {
      if (Invoke-ValidateImage $existing.FullName) {
        Write-Host "Skip existing valid image: $safeName"
        continue
      }
      Remove-Item -LiteralPath $existing.FullName -Force
    } elseif ($existing -and $Force) {
      Remove-Item -LiteralPath $existing.FullName -Force
    }

    $generated = $false
    for ($attempt = 1; $attempt -le $max; $attempt += 1) {
      Write-Host "Generating: $safeName attempt $attempt"
      $before = @(Get-ChildItem -LiteralPath $categoryDir -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
      $prompt = $item.Prompt
      if ($attempt -gt 1) { $prompt = $prompt + (Get-RetrySuffix) }
      node $chatgptScript generate --prompt $prompt --output $categoryDir --timeout $cfg.generation.timeout --new-chat --text-retry-delay $cfg.generation.textRetryDelay --text-retries $cfg.generation.textRetries
      if ($LASTEXITCODE -ne 0) { continue }
      $after = Get-ChildItem -LiteralPath $categoryDir -File -ErrorAction SilentlyContinue |
        Where-Object { $before -notcontains $_.FullName } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
      if (-not $after) { continue }
      $targetPath = Join-Path $categoryDir "$safeName$($after.Extension)"
      Move-Item -LiteralPath $after.FullName -Destination $targetPath -Force
      if (Invoke-ValidateImage $targetPath) {
        Write-Host "Saved valid image: $targetPath"
        $generated = $true
        break
      }
      Remove-Item -LiteralPath $targetPath -Force
    }
    if (-not $generated) { throw "Failed to generate a valid image for $safeName" }
  }
}

function Invoke-ValidateAll {
  $cfg = Ensure-Config
  $photoDir = Resolve-ProjectPath ([string]$cfg.photoDir)
  $reportDir = Join-Path $ProjectDir (ZH QualityDir)
  New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
  $report = Join-Path $reportDir ((ZH QualityReport) + ".csv")
  $rows = @()
  foreach ($file in (Get-ChildItem -LiteralPath $photoDir -Recurse -File | Sort-Object FullName)) {
    $chatgptScript = Get-ChatGptScript
    $q = $cfg.quality
    $json = node $chatgptScript validate --image $file.FullName --min-width $q.minWidth --min-height $q.minHeight --min-bytes $q.minBytes --min-sharpness $q.minSharpness --max-noise $q.maxNoise | Out-String
    $obj = $json | ConvertFrom-Json
    $rows += [pscustomobject]@{
      Category = $file.Directory.Name
      Name = $file.Name
      Pass = $obj.pass
      Width = $obj.width
      Height = $obj.height
      Bytes = $obj.bytes
      Sharpness = $obj.sharpness
      Noise = $obj.noise
      Failures = ($obj.failures -join "; ")
      Path = $file.FullName
    }
  }
  $rows | Export-Csv -LiteralPath $report -NoTypeInformation -Encoding UTF8
  $failed = @($rows | Where-Object { -not $_.Pass })
  Write-Host "Validation report: $report"
  if ($failed.Count -gt 0) { throw "Validation failed for $($failed.Count) image(s)." }
}

function Invoke-VideoPrompts {
  $cfg = Ensure-Config
  $photoDir = Resolve-ProjectPath ([string]$cfg.photoDir)
  $items = @(Get-PromptItems)
  $characterRefs = @(
    (Join-Path (Join-Path ([string]$cfg.photoDir) (ZH Cat1)) ((U @(0x0030,0x0031,0x005F,0x77F3,0x660A,0x4E3B,0x4F53,0x767D,0x5E95,0x6B63,0x9762)) + ".png")),
    (Join-Path (Join-Path ([string]$cfg.photoDir) (ZH Cat2)) ((U @(0x0030,0x0032,0x005F,0x77F3,0x660A,0x4E09,0x89C6,0x56FE)) + ".png")),
    (Join-Path (Join-Path ([string]$cfg.photoDir) (ZH Cat2)) ((U @(0x0030,0x0033,0x005F,0x77F3,0x660A,0x8868,0x60C5,0x52A8,0x4F5C,0x8BBE,0x5B9A)) + ".png"))
  ) | Where-Object { Test-Path -LiteralPath (Join-Path $ProjectDir $_) }
  $keyframes = @($items | Where-Object { $_.Category -eq (ZH Cat5) -or $_.Type -like "*keyframe*" -or $_.Category -like "05_*" })
  if ($keyframes.Count -eq 0) { throw "No keyframe rows found in prompt file." }
  $rows = @()
  $markdown = @("# Keyframe Video Prompts With Reference Images", "", "Rules: upload main keyframe first; upload character reference images for shots with the main character; keep 16:9, 4K look, sharp, clean, no text or watermark.", "")
  $index = 1
  foreach ($item in $keyframes) {
    $safeName = Get-SafeFileName $item.Name
    $categoryDir = Join-Path $photoDir $item.Category
    $mainFile = Get-ChildItem -LiteralPath $categoryDir -File -Filter "$safeName.*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $mainFile) { throw "Main keyframe image not found for $($item.Name)" }
    $mainRel = Get-RelativeProjectPath $mainFile.FullName
    $refs = @($mainRel)
    if ($item.Category -eq (ZH Cat5) -and $index -gt 1) { $refs += $characterRefs }
    $refs = @($refs | Select-Object -Unique)
    $no = "{0:D2}" -f $index
    $duration = if ($index -eq 8) { "8s" } elseif ($index -in 4,6,7,9) { "7s" } else { "6s" }
    $prompt = "Use the main keyframe as the first frame. $($item.VideoPrompt) Keep motion natural, subject consistent, sharp 4K look, low noise."
    $negative = "No text, no watermark, no subtitles, no face drift, no outfit change, no age change, no distorted limbs, no flicker, no blur."
    $markdown += @("## $no $($item.Name)", "- Duration: $duration", "- Main keyframe: $mainRel", "- Reference images: $($refs -join '; ')", "- Video prompt: $prompt", "- Negative prompt: $negative", "")
    $rows += [pscustomobject]@{
      No = $no
      Shot = $item.Name
      Duration = $duration
      MainKeyframe = $mainRel
      ReferenceImages = ($refs -join " | ")
      VideoPrompt = $prompt
      NegativePrompt = $negative
    }
    $index += 1
  }
  $mdPath = Resolve-ProjectPath ([string]$cfg.videoPromptMarkdown)
  $csvPath = Resolve-ProjectPath ([string]$cfg.videoPromptCsv)
  $markdown | Set-Content -LiteralPath $mdPath -Encoding UTF8
  $rows | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
  Write-Host "Video prompts: $mdPath"
  Write-Host "Video prompt table: $csvPath"
}

switch ($Mode) {
  "extract" { Invoke-Extract }
  "plan" { Invoke-Plan }
  "prepare" { Invoke-Prepare }
  "image" { Invoke-Image }
  "validate" { Invoke-ValidateAll }
  "video-prompts" { Invoke-VideoPrompts }
  "all" {
    Ensure-Config | Out-Null
    if ($Docx) { Invoke-Extract }
    Invoke-Plan
    Invoke-Image
    Invoke-ValidateAll
    Invoke-VideoPrompts
  }
}
