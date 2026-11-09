param([string]$Launcher = (Join-Path $PSScriptRoot 'Start-Buji.ps1'))

$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
$definition = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Install-TextModel'
}, $true)
. ([scriptblock]::Create($definition.Extent.Text))

$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-assets.json') -Raw | ConvertFrom-Json
$assetDir = Join-Path ([IO.Path]::GetTempPath()) ('buji-empty-cache-' + [Guid]::NewGuid())
$partialDir = Join-Path $assetDir 'model-download'
New-Item -ItemType Directory -Path $assetDir | Out-Null
function Get-VerifiedAsset($item, [string]$directory) {
    if ($item.name -ne $manifest.model.parts[0].name -or $directory -ne $partialDir) {
        throw 'First launch requested an unexpected model shard.'
    }
    throw 'Reached the first model download.'
}
try {
    $available = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($assetDir)).AvailableFreeSpace
    $required = 2L * [long]$manifest.model.size + 300MB
    $expected = if ($available -lt $required) { 'Setup needs * GB free on *.' } else { 'Reached the first model download.' }
    $failure = $null
    try { Install-TextModel } catch { $failure = $_.Exception.Message }
    if ($failure -notlike $expected) { throw "Empty model cache preflight failed: $failure" }
    Write-Output "First-launch preflight passed for $($manifest.model.size) bytes."

    foreach ($name in 'Get-AssetSha256', 'Get-VerifiedAsset') {
        $functionAst = $ast.Find({
            param($node)
            $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
        }, $true)
        . ([scriptblock]::Create($functionAst.Extent.Text))
    }
    function Get-FileHash { throw 'The checksum cmdlet is unavailable.' }
    [IO.File]::WriteAllText((Join-Path $assetDir 'probe.partial'), 'abc')
    $asset = @{name='probe'; size=3; sha256='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}
    if ((Get-VerifiedAsset $asset $assetDir) -ne (Join-Path $assetDir 'probe')) {
        throw 'The already-downloaded asset could not be verified.'
    }
    Write-Output 'Resumed asset SHA-256 verified without the PowerShell hash cmdlet.'
} finally {
    if (Test-Path -LiteralPath $partialDir) { Remove-Item -LiteralPath $partialDir }
    foreach ($name in 'probe', 'probe.partial') {
        $file = Join-Path $assetDir $name
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
    }
    Remove-Item -LiteralPath $assetDir
}
