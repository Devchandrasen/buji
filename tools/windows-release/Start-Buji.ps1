param([switch]$Vision, [switch]$Hindi, [switch]$Cuda, [switch]$Cpu, [switch]$SetupOnly)
$ErrorActionPreference = 'Stop'
$assetDir = if ($env:BUJI_RELEASE_ASSETS) { $env:BUJI_RELEASE_ASSETS } else { Join-Path $env:LOCALAPPDATA 'CBN.Ai\Buji Assets' }
$profile = if ($env:BUJI_DATA_DIR) { $env:BUJI_DATA_DIR } else { Join-Path $env:APPDATA 'CBN.Ai\Buji' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-assets.json') -Raw | ConvertFrom-Json
$python = Join-Path $PSScriptRoot 'voice\hindi-runtime\Scripts\python.exe'
$curl = Join-Path $env:WINDIR 'System32\curl.exe'

function Get-VerifiedAsset($item, [string]$directory) {
    $target = Join-Path $directory $item.name
    if ((Test-Path -LiteralPath $target) -and (Get-Item -LiteralPath $target).Length -eq $item.size -and
        (Get-FileHash -LiteralPath $target).Hash -eq $item.sha256) { return $target }
    $partial = "$target.partial"
    if ((Test-Path -LiteralPath $partial) -and (Get-Item -LiteralPath $partial).Length -ge $item.size) {
        if ((Get-Item -LiteralPath $partial).Length -eq $item.size -and
            (Get-FileHash -LiteralPath $partial).Hash -eq $item.sha256) {
            Move-Item -LiteralPath $partial -Destination $target -Force
            return $target
        }
        Remove-Item -LiteralPath $partial -Force
    }
    Write-Host ("Downloading {0} ({1:N1} MB)" -f $item.name, ($item.size / 1e6))
    & $curl --fail --location --retry 3 --connect-timeout 25 --proto '=https' --proto-redir '=https' --continue-at - --output $partial $item.url
    if ($LASTEXITCODE) { throw "Download interrupted. Open the same shortcut to resume $($item.name)." }
    if ((Get-Item -LiteralPath $partial).Length -ne $item.size -or (Get-FileHash -LiteralPath $partial).Hash -ne $item.sha256) {
        Remove-Item -LiteralPath $partial -Force
        throw "SHA-256 verification failed for $($item.name). Open the same shortcut to retry."
    }
    Move-Item -LiteralPath $partial -Destination $target -Force
    return $target
}
function Install-Wheels([string]$requirements) {
    $target = Join-Path $PSScriptRoot 'voice\hindi-runtime\Scripts\Lib\site-packages'
    & $python -I -m pip --isolated --disable-pip-version-check install --index-url https://pypi.org/simple --no-cache-dir --only-binary=:all: --require-hashes --target $target -r (Join-Path $PSScriptRoot $requirements)
    if ($LASTEXITCODE) { throw 'The optional Python components failed to install.' }
}
function Install-TextModel {
    $model = Join-Path $assetDir 'omni-parent-Q4_K_M.gguf'
    $stamp = "$model.sha256"
    $modelSize = [long]$manifest.model.size
    if ((Test-Path -LiteralPath $model) -and (Get-Item -LiteralPath $model).Length -eq $modelSize) {
        if ((Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $manifest.model.sha256) { return }
        if ((Get-FileHash -LiteralPath $model).Hash -eq $manifest.model.sha256) {
            Set-Content -LiteralPath $stamp -Value $manifest.model.sha256 -Encoding ascii
            return
        }
    }
    Write-Host 'Buji downloads its text model once. Inference then runs on this PC.'
    $partialDir = Join-Path $assetDir 'model-download'
    New-Item -ItemType Directory -Path $partialDir -Force | Out-Null
    if ($manifest.model.parts.Count -eq 1) {
        $download = Get-VerifiedAsset $manifest.model.parts[0] $partialDir
        Move-Item -LiteralPath $download -Destination $model -Force
    } else {
        $cached = [long](Get-ChildItem -LiteralPath $partialDir -File | Measure-Object Length -Sum).Sum
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($assetDir))
        $needed = $modelSize + [Math]::Max([long]0, $modelSize - $cached) + 300MB
        if ($drive.AvailableFreeSpace -lt $needed) { throw ('Setup needs {0:N1} GB free on {1}.' -f ($needed / 1e9), $drive.Name) }
        $parts = foreach ($part in $manifest.model.parts) { Get-VerifiedAsset $part $partialDir }
        $tempModel = "$model.assembling"
        $output = [IO.File]::Open($tempModel, [IO.FileMode]::Create)
        try {
            foreach ($part in $parts) {
                $inputStream = [IO.File]::OpenRead($part)
                try { $inputStream.CopyTo($output, 4MB) } finally { $inputStream.Dispose() }
            }
        } finally { $output.Dispose() }
        if ((Get-Item -LiteralPath $tempModel).Length -ne $modelSize -or (Get-FileHash -LiteralPath $tempModel).Hash -ne $manifest.model.sha256) {
            Remove-Item -LiteralPath $tempModel -Force
            throw 'The assembled model did not match the release checksum.'
        }
        Move-Item -LiteralPath $tempModel -Destination $model -Force
        foreach ($part in $parts) { Remove-Item -LiteralPath $part -Force }
    }
    Set-Content -LiteralPath $stamp -Value $manifest.model.sha256 -Encoding ascii
}
function Install-Hindi {
    Write-Host 'Installing optional Hindi speech. The Pratham voice uses a CC BY-NC-SA 4.0 dataset. See its model card for terms.'
    Install-Wheels 'hindi-wheels.txt'
    $directory = Join-Path $PSScriptRoot 'voice\hindi'
    foreach ($item in $manifest.hindi) { Get-VerifiedAsset $item $directory | Out-Null }
}
function Install-Cuda {
    Write-Host 'Downloading the optional CUDA 12.4 runtime from llama.cpp.'
    $directory = Join-Path $assetDir 'cuda'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    foreach ($item in $manifest.cuda) {
        $archive = Get-VerifiedAsset $item $assetDir
        & (Join-Path $env:WINDIR 'System32\tar.exe') -xf $archive -C $directory
        if ($LASTEXITCODE) { throw 'Could not unpack the verified CUDA runtime.' }
        Remove-Item -LiteralPath $archive -Force
    }
    & (Join-Path $directory 'llama-server.exe') --list-devices
    if ($LASTEXITCODE) { throw 'The CUDA runtime could not start. Update your NVIDIA driver or use CPU mode.' }
    Set-Content -LiteralPath (Join-Path $assetDir 'inference-device') -Value 'cuda' -Encoding ascii
}
function Install-Vision {
    Write-Host 'Installing optional Windows capture components and the Qwen vision model (1.55 GB).'
    Install-Wheels 'vision-wheels.txt'
    $directory = Join-Path $assetDir 'vision'
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $files = @(foreach ($item in $manifest.vision) { Get-VerifiedAsset $item $directory })
    $hashes = @{}
    foreach ($item in $manifest.vision) { $hashes[$item.name] = $item.sha256 }
    $config = @{
        schema = 1
        source = 'Qwen/Qwen3-VL-2B-Instruct-GGUF'
        revision = $manifest.visionRevision
        license = 'Apache-2.0'
        endpoint = 'http://127.0.0.1:8096/v1'
        model = 'buji-vision-local'
        server = (Join-Path $PSScriptRoot 'runtime\llama-server.exe')
        python = $python
        weights = $files[0]
        projector = $files[1]
        sha256 = $hashes
        gpuLayers = 0
        context = 4096
    } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText((Join-Path $directory 'vision.json'), $config)
}

$mutex = [Threading.Mutex]::new($false, 'Local\CBN-Ai-Buji-Setup')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Buji setup is already open.' }
    New-Item -ItemType Directory -Path $assetDir -Force | Out-Null
    $device = Join-Path $assetDir 'inference-device'
    if ($Vision -or $Hindi -or $Cuda -or $Cpu) {
        if (Get-Process BujiV2 -ErrorAction SilentlyContinue | Where-Object Path -eq (Join-Path $PSScriptRoot 'app\BujiV2.exe')) {
            throw 'Close this installation of Buji before changing its setup.'
        }
    }
    Install-TextModel
    if ($Hindi) { Install-Hindi }
    if ($Vision) { Install-Vision }
    if ($Cuda) { Install-Cuda }
    if ($Cpu) { Set-Content -LiteralPath $device -Value 'cpu' -Encoding ascii }
    if (!$SetupOnly) {
        $env:BUJI_RELEASE_ASSETS = $assetDir
        $env:BUJI_DATA_DIR = $profile
        $env:BUJI_VISION_CONFIG = Join-Path $assetDir 'vision\vision.json'
        $env:BUJI_RELEASE_CUDA = if ((Test-Path -LiteralPath $device) -and (Get-Content -LiteralPath $device -Raw).Trim() -eq 'cuda') { '1' } else { '0' }
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        Start-Process -FilePath (Join-Path $PSScriptRoot 'app\BujiV2.exe') -WorkingDirectory $PSScriptRoot -WindowStyle Normal
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if (!$SetupOnly) { Read-Host 'Press Enter to close setup' | Out-Null }
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
