[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$starterScript = Join-Path $PSScriptRoot 'start-jetwork-local.ps1'
$startupDirectory = [Environment]::GetFolderPath('Startup')
$startupCommand = Join-Path $startupDirectory 'JetWork-Local-AI.cmd'

try {
  if (-not (Test-Path -LiteralPath $starterScript -PathType Leaf)) {
    throw "Baslatici bulunamadi: $starterScript"
  }

  Write-Host '[JetWork] Ilk calisma dogrulaniyor...'
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $starterScript
  if ($LASTEXITCODE -ne 0) {
    throw 'Yerel AI baslatilamadigi icin otomatik baslatma kurulmadı.'
  }

  $commandContents = @"
@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$starterScript"
"@
  Set-Content -LiteralPath $startupCommand -Value $commandContents -Encoding Ascii

  Write-Host '[JetWork] Otomatik baslatma kuruldu.'
  Write-Host '[JetWork] Bundan sonra Windows oturumu acilinca Ollama gateway otomatik acilacak.'
  Write-Host "[JetWork] Startup dosyasi: $startupCommand"
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
