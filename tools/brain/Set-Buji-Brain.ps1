param([ValidateSet('Standard','FastMath','Legacy')][string]$Preset='Standard')
$ErrorActionPreference='Stop'
# Stage this script beside service.cjs in the existing BujiV2-Router installation.
$brainDirectory=$PSScriptRoot
$brainConfig=Join-Path $brainDirectory 'brain.json'
$brainPrevious=if(Test-Path -LiteralPath $brainConfig) {[IO.File]::ReadAllText($brainConfig)}else{'{"schema":1,"profile":"current-wsp","context":4096}'}
$brainState=Join-Path $brainDirectory '..\..\work\buji-v2-router\serving\state.json'
if (!(Test-Path -LiteralPath (Join-Path $brainDirectory 'Start-Buji-V2-Backend.ps1'))) {throw 'Run the installed copy in outputs/BujiV2-Router.'}
if(Test-Path -LiteralPath $brainState) {
    $brainRunning=Get-Content -LiteralPath $brainState -Raw | ConvertFrom-Json
    if($brainRunning.status -eq 'ready') {
        if($brainRunning.nativePort -ne 8092){throw 'Unexpected native model port.'}
        $brainSlots=Invoke-RestMethod 'http://127.0.0.1:8092/slots' -Headers @{Authorization="Bearer $($brainRunning.apiKey)"} -TimeoutSec 3
        if(@($brainSlots | Where-Object {$_.is_processing}).Count){throw 'Finish the current model request before switching brains.'}
        & (Join-Path $brainDirectory 'Stop-Buji-V2-Backend.ps1')
    } elseif($brainRunning.status -eq 'loading') {throw 'Wait for model startup before switching profiles.'}
}
if(Test-Path -LiteralPath $brainConfig) {Copy-Item -LiteralPath $brainConfig -Destination ($brainConfig+'.before-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))}
$brainSelected=if($Preset -eq 'FastMath') {'concise-original'}else{'current-wsp'}
$brainContext=if($Preset -eq 'Legacy') {4096}else{8192}
$brainJson=@{schema=1;profile=$brainSelected;context=$brainContext} | ConvertTo-Json
try {
    [IO.File]::WriteAllText($brainConfig,$brainJson,(New-Object Text.UTF8Encoding($false)))
    & (Join-Path $brainDirectory 'Start-Buji-V2-Backend.ps1') -NoBrowser
} catch {
    $brainFailure=$_
    [IO.File]::WriteAllText($brainConfig,$brainPrevious,(New-Object Text.UTF8Encoding($false)))
    try {& (Join-Path $brainDirectory 'Start-Buji-V2-Backend.ps1') -NoBrowser} catch {Write-Warning 'The previous configuration was restored, but its backend could not restart. Check the local serving logs.'}
    throw $brainFailure
}
Invoke-RestMethod 'http://127.0.0.1:8093/health' -TimeoutSec 3 | Select-Object model,brain,context
