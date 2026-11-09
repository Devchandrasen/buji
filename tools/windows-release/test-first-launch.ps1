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
} finally {
    if (Test-Path -LiteralPath $partialDir) { Remove-Item -LiteralPath $partialDir }
    Remove-Item -LiteralPath $assetDir
}
