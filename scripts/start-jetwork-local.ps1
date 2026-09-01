[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$modelName = 'qwen3:4b-instruct'
$ollamaUrl = 'http://127.0.0.1:11434'
$gatewayUrl = 'http://127.0.0.1:11435'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gatewayScript = Join-Path $PSScriptRoot 'ollama-gateway.mjs'
$logDirectory = Join-Path $env:LOCALAPPDATA 'JetWork'
$gatewayOutputLog = Join-Path $logDirectory 'ollama-gateway.log'
$gatewayErrorLog = Join-Path $logDirectory 'ollama-gateway-error.log'
$ollamaOutputLog = Join-Path $logDirectory 'ollama.log'
$ollamaErrorLog = Join-Path $logDirectory 'ollama-error.log'

function Write-Step {
  param([string]$Message)
  Write-Host "[JetWork] $Message"
}

function Get-GatewayToken {
  $token = [string]$env:JETWORK_OLLAMA_GATEWAY_TOKEN
  if (-not [string]::IsNullOrWhiteSpace($token)) {
    return $token.Trim()
  }

  foreach ($scope in @('User', 'Machine')) {
    $token = [Environment]::GetEnvironmentVariable('JETWORK_OLLAMA_GATEWAY_TOKEN', $scope)
    if (-not [string]::IsNullOrWhiteSpace($token)) {
      return $token.Trim()
    }
  }

  return ''
}

function Get-OllamaTags {
  Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -Method Get -TimeoutSec 5
}

function Get-GatewayHealth {
  param([string]$Token)
  Invoke-RestMethod `
    -Uri "$gatewayUrl/health" `
    -Method Get `
    -Headers @{ Authorization = "Bearer $Token" } `
    -TimeoutSec 5
}

function Wait-UntilReady {
  param(
    [scriptblock]$Probe,
    [int]$Seconds = 15
  )

  for ($attempt = 0; $attempt -lt $Seconds; $attempt += 1) {
    try {
      return & $Probe
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  throw 'Servis zamaninda hazir olmadi.'
}

try {
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

  if (-not (Test-Path -LiteralPath $gatewayScript -PathType Leaf)) {
    throw "Gateway dosyasi bulunamadi: $gatewayScript"
  }

  $token = Get-GatewayToken
  if ($token.Length -lt 24) {
    throw @'
JETWORK_OLLAMA_GATEWAY_TOKEN bilgisayarda kayitli degil.
Supabase ile ayni tokeni bir kez User environment variable olarak kaydetmelisin.
Tokenin kendisini sohbet veya loglara yazma.
'@
  }
  $env:JETWORK_OLLAMA_GATEWAY_TOKEN = $token

  Write-Step 'Ollama kontrol ediliyor...'
  try {
    $tags = Get-OllamaTags
  } catch {
    $ollamaCommand = Get-Command 'ollama.exe' -ErrorAction Stop
    Write-Step 'Ollama baslatiliyor...'
    Start-Process `
      -FilePath $ollamaCommand.Source `
      -ArgumentList 'serve' `
      -WindowStyle Hidden `
      -RedirectStandardOutput $ollamaOutputLog `
      -RedirectStandardError $ollamaErrorLog | Out-Null
    $tags = Wait-UntilReady -Probe { Get-OllamaTags }
  }

  $installedModels = @($tags.models | ForEach-Object { [string]$_.name })
  if ($installedModels -notcontains $modelName) {
    throw "$modelName yuklu degil. Once 'ollama pull $modelName' komutunu calistir."
  }

  $listener = Get-NetTCPConnection -State Listen -LocalPort 11435 -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($null -ne $listener) {
    try {
      $health = Get-GatewayHealth -Token $token
      if ($health.ok -ne $true) {
        throw 'Gateway saglik kontrolu basarisiz.'
      }
      Write-Step 'Yerel gateway zaten acik.'
    } catch {
      throw '11435 portu kullaniliyor fakat JetWork gateway dogrulanamadi. Gateway tokenini ve loglari kontrol et.'
    }
  } else {
    $nodeCommand = Get-Command 'node.exe' -ErrorAction Stop
    Write-Step 'Yerel gateway baslatiliyor...'
    $gatewayProcess = Start-Process `
      -FilePath $nodeCommand.Source `
      -ArgumentList $gatewayScript `
      -WorkingDirectory $repoRoot `
      -WindowStyle Hidden `
      -PassThru `
      -RedirectStandardOutput $gatewayOutputLog `
      -RedirectStandardError $gatewayErrorLog

    try {
      $health = Wait-UntilReady -Probe { Get-GatewayHealth -Token $token }
    } catch {
      if (-not $gatewayProcess.HasExited) {
        Stop-Process -Id $gatewayProcess.Id -Force -ErrorAction SilentlyContinue
      }
      throw "Gateway baslatilamadi. Log: $gatewayErrorLog"
    }

    if ($health.ok -ne $true -or [int]$health.upstreamStatus -ne 200) {
      throw 'Gateway acildi fakat Ollama upstream saglik kontrolu basarisiz.'
    }
  }

  $tailscaleCommand = Get-Command 'tailscale.exe' -ErrorAction Stop
  Write-Step 'Tailscale Funnel aciliyor...'
  & $tailscaleCommand.Source funnel --bg --yes $gatewayUrl
  if ($LASTEXITCODE -ne 0) {
    throw "Tailscale Funnel baslatilamadi (exit code: $LASTEXITCODE)."
  }

  Write-Step 'Hazir. Qwen3 4B (Local) kullanilabilir.'
  exit 0
} catch {
  Write-Error $_.Exception.Message
  Write-Host "[JetWork] Log klasoru: $logDirectory"
  exit 1
}
