param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$assetDir = $env:BUJI_RELEASE_ASSETS
if (!$assetDir) { throw 'Start Buji using its Start menu shortcut.' }
$stateDir = Join-Path $assetDir 'serving'
$stateFile = Join-Path $stateDir 'state.json'
$mutex = [Threading.Mutex]::new($false, 'Local\CBN-Ai-Buji-Backend')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(120000) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Buji backend startup is already in progress.' }
    function Test-Router {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:18093/health' -TimeoutSec 2
            return $health.status -eq 'ok' -and $health.model -eq 'buji-v2-routed'
        } catch { return $false }
    }
    if (Test-Router) { return }
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $service = Join-Path $PSScriptRoot 'tools\brain\service.cjs'
    $runner = Join-Path $PSScriptRoot 'app\BujiV2.exe'
    $stdout = Join-Path $stateDir 'router.log'
    $stderr = Join-Path $stateDir 'router-error.log'
    $env:ELECTRON_RUN_AS_NODE = '1'
    $process = Start-Process -FilePath $runner -ArgumentList ('"{0}"' -f $service) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline = [DateTime]::UtcNow.AddSeconds(118)
    do {
        $process.Refresh()
        if ($process.HasExited) { throw "The model backend failed. See $stderr and omnicoder.log in $stateDir." }
        if ((Test-Router) -and (Test-Path -LiteralPath $stateFile)) {
            $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            if ($state.pid -eq $process.Id) { return }
        }
        Start-Sleep -Milliseconds 600
    } while ([DateTime]::UtcNow -lt $deadline)
    New-Item -ItemType File -Path (Join-Path $stateDir "stop-$($process.Id)") -Force | Out-Null
    throw "The local model took too long to start. See $stderr and omnicoder.log in $stateDir."
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
