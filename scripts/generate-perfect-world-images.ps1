$ErrorActionPreference = "Stop"

function U([int[]]$CodePoints) {
  return -join ($CodePoints | ForEach-Object { [char]$_ })
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$chatgptScript = Join-Path $repoRoot "scripts\chatgpt-image.js"

$aiVideo = "ai" + (U @(0x89C6, 0x9891, 0x751F, 0x6210))
$projectName = U @(0x5B8C, 0x7F8E, 0x4E16, 0x754C, 0x4E00, 0x5206, 0x949F, 0x5BA3, 0x4F20, 0x7247)
$promptFileName = (U @(0x91CD, 0x65B0, 0x751F, 0x6210)) + "_" + (U @(0x56FE, 0x7247, 0x63D0, 0x793A, 0x8BCD)) + ".tsv"
$photoDirName = U @(0x7167, 0x7247)
$retrySuffix = (U @(0x3002, 0x91CD, 0x65B0, 0x751F, 0x6210, 0xFF0C, 0x5FC5, 0x987B, 0x66F4, 0x6E05, 0x6670, 0x9510, 0x5229, 0xFF0C, 0x4E3B, 0x4F53, 0x4E00, 0x81F4, 0xFF0C)) + "4K" + (U @(0x753B, 0x8D28, 0xFF0C, 0x65E0, 0x660E, 0x663E, 0x566A, 0x70B9, 0xFF0C, 0x4E0D, 0x8981, 0x6587, 0x5B57, 0xFF0C, 0x4E0D, 0x8981, 0x6C34, 0x5370, 0x3002))

$projectDir = Join-Path $env:USERPROFILE ("Desktop\" + $aiVideo + "\" + $projectName)
$promptFile = Join-Path $projectDir $promptFileName
$photoDir = Join-Path $projectDir $photoDirName

New-Item -ItemType Directory -Force -Path $photoDir | Out-Null

$items = Get-Content -LiteralPath $promptFile -Encoding UTF8 | Where-Object { $_.Trim() } | ForEach-Object {
  $parts = $_ -split "`t", 5
  [pscustomobject]@{
    Category = $parts[0]
    Name = $parts[1]
    Type = $parts[2]
    Prompt = $parts[3]
    VideoPrompt = $parts[4]
  }
}

foreach ($item in $items) {
  $safeName = $item.Name -replace '[\\/:*?"<>|]', "_"
  $categoryDir = Join-Path $photoDir $item.Category
  New-Item -ItemType Directory -Force -Path $categoryDir | Out-Null

  $existing = Get-ChildItem -LiteralPath $categoryDir -File -Filter "$safeName.*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) {
    node $chatgptScript validate --image $existing.FullName | Out-Host
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Skip existing valid image: $safeName"
      continue
    }
    Write-Host "Existing image failed validation; regenerating: $safeName"
    Remove-Item -LiteralPath $existing.FullName -Force
  }

  $generated = $false
  for ($attempt = 1; $attempt -le 3; $attempt += 1) {
    Write-Host "Generating: $safeName attempt $attempt"
    $before = @(Get-ChildItem -LiteralPath $categoryDir -File -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)

    $prompt = $item.Prompt
    if ($attempt -gt 1) {
      $prompt = $prompt + $retrySuffix
    }

    node $chatgptScript generate --prompt $prompt --output $categoryDir --timeout 900000 --new-chat --text-retry-delay 60000 --text-retries 2
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Generation command failed for $safeName"
      continue
    }

    $after = Get-ChildItem -LiteralPath $categoryDir -File -ErrorAction SilentlyContinue |
      Where-Object { $before -notcontains $_.FullName } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if (-not $after) {
      Write-Host "No generated image found for $safeName"
      continue
    }

    $targetPath = Join-Path $categoryDir "$safeName$($after.Extension)"
    Move-Item -LiteralPath $after.FullName -Destination $targetPath -Force
    node $chatgptScript validate --image $targetPath | Out-Host
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Saved valid image: $targetPath"
      $generated = $true
      break
    }

    Write-Host "Image failed validation; deleting and retrying: $targetPath"
    Remove-Item -LiteralPath $targetPath -Force
  }

  if (-not $generated) {
    throw "Failed to generate a valid image for $safeName"
  }
}
