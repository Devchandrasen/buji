param(
    [Parameter(Mandatory = $true)][string]$ModelPath,
    [Parameter(Mandatory = $true)][string]$ProjectorPath,
    [Parameter(Mandatory = $true)][string]$RuntimeDirectory,
    [string]$Destination = (Join-Path $PSScriptRoot '..\models\backend'),
    [string]$ModelId = 'qwen3-personal-wsp',
    [ValidateRange(1024, 32768)][int]$Context = 8192,
    [ValidateRange(0, 99)][int]$GpuLayers = 99,
    [ValidateRange(1024, 65535)][int]$Port = 8088
)
$ErrorActionPreference = 'Stop'
$resolvedModel = (Resolve-Path -LiteralPath $ModelPath).Path
$resolvedProjector = (Resolve-Path -LiteralPath $ProjectorPath).Path
$resolvedRuntime = (Resolve-Path -LiteralPath $RuntimeDirectory).Path
$serverExecutable = Join-Path $resolvedRuntime 'llama-server.exe'
if (-not (Test-Path -LiteralPath $serverExecutable -PathType Leaf)) { throw 'llama-server.exe was not found in the runtime directory.' }
if ($ModelId -notmatch '^[A-Za-z0-9._:/-]+$') { throw 'Use a simple model ID containing letters, digits, dots, underscores, colons, slashes or hyphens.' }
$profileDirectory = [System.IO.Path]::GetFullPath($Destination)
$startPath = Join-Path $profileDirectory 'Start-Model.ps1'
$stopPath = Join-Path $profileDirectory 'Stop-Model.ps1'
if ((Test-Path -LiteralPath $startPath) -or (Test-Path -LiteralPath $stopPath)) { throw 'This profile already exists. Choose another destination to preserve it.' }
New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
function PsLiteral([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }
$template = @'
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$model = __MODEL__
$projector = __PROJECTOR__
$runtime = __RUNTIME__
$modelId = __MODEL_ID__
$contextSize = __CONTEXT__
$gpuLayers = __GPU_LAYERS__
$portNumber = __PORT__
$serverExecutable = Join-Path $runtime 'llama-server.exe'
$url = 'http://127.0.0.1:' + $portNumber
$runDirectory = Join-Path $PSScriptRoot 'run'
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
try {
    $models = Invoke-RestMethod "$url/v1/models" -TimeoutSec 2
    if ($models.data.id -contains $modelId) { Write-Host "Model ready: $url"; exit 0 }
    throw 'The port is occupied by a different model.'
} catch { if ($_.Exception.Message -like '*occupied*') { throw } }
$arguments = @('--model', ('"{0}"' -f $model), '--mmproj', ('"{0}"' -f $projector),
    '--alias', $modelId, '--host', '127.0.0.1', '--port', $portNumber,
    '--n-gpu-layers', $gpuLayers, '--ctx-size', $contextSize, '--parallel', '1',
    '--flash-attn', 'on', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0',
    '--batch-size', '512', '--ubatch-size', '256', '--threads', '8', '--jinja')
$server = Start-Process -FilePath $serverExecutable -ArgumentList $arguments -WorkingDirectory $runtime -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $runDirectory 'stdout.log') -RedirectStandardError (Join-Path $runDirectory 'stderr.log')
@{pid=$server.Id; executable=$serverExecutable; modelId=$modelId} | ConvertTo-Json | Set-Content (Join-Path $runDirectory 'server.json') -Encoding utf8
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    Start-Sleep -Seconds 1
    $server.Refresh()
    if ($server.HasExited) { throw 'Model server exited. See the profile run/stderr.log file.' }
    try { $health = Invoke-RestMethod "$url/health" -TimeoutSec 2; if ($health.status -eq 'ok') { Write-Host "Model ready: $url"; exit 0 } } catch { }
}
throw 'Model startup timed out. See the profile logs.'
'@
$template = $template.Replace('__MODEL__', (PsLiteral $resolvedModel)).Replace('__PROJECTOR__', (PsLiteral $resolvedProjector))
$template = $template.Replace('__RUNTIME__', (PsLiteral $resolvedRuntime)).Replace('__MODEL_ID__', (PsLiteral $ModelId))
$template = $template.Replace('__CONTEXT__', [string]$Context).Replace('__GPU_LAYERS__', [string]$GpuLayers).Replace('__PORT__', [string]$Port)
$template | Set-Content -LiteralPath $startPath -Encoding utf8
$stop = @'
$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot 'run\server.json'
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Host 'No saved server process.'; exit 0 }
$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)"
if (-not $process) { Write-Host 'The server is already stopped.'; exit 0 }
if ($process.ExecutablePath -ne $state.executable -or $process.CommandLine -notlike "*$($state.modelId)*") { throw 'The saved process no longer matches this model profile.' }
Stop-Process -Id $state.pid -ErrorAction Stop
Write-Host 'Model server stopped.'
'@
$stop | Set-Content -LiteralPath $stopPath -Encoding utf8
Write-Host "Backend profile created: $profileDirectory"
Write-Host "Select $startPath in Buji Settings. Endpoint: http://127.0.0.1:$Port/v1 ; model ID: $ModelId"
