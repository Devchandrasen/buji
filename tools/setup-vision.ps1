param([string]$Destination='', [string]$Server='')
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$workspace=[IO.Path]::GetFullPath((Join-Path $repo '..\..'))
if (!$Destination) { $Destination=if(Test-Path -LiteralPath (Join-Path $workspace 'outputs')) {Join-Path $workspace 'outputs\BujiVision'} else {Join-Path $repo 'backend\BujiVision'} }
$Destination=[IO.Path]::GetFullPath($Destination)
if (!$Server) { $Server=Join-Path $workspace 'outputs\Qwen3-Personal-WSP\runtime\llama-server.exe' }
if (!(Test-Path -LiteralPath $Server -PathType Leaf)) { throw 'Pass -Server with the path to an official llama.cpp llama-server.exe installation.' }
$runtime=Join-Path $Destination 'runtime'
$python=Join-Path $runtime 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) { & python -m venv $runtime; if($LASTEXITCODE){throw 'Python 3.12 is required to create the local vision environment.'} }
& $python -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'vision-requirements.txt')
if($LASTEXITCODE){throw 'Local capture dependencies could not be installed.'}
& $python (Join-Path $PSScriptRoot 'setup-vision-model.py') --destination $Destination --server $Server
if($LASTEXITCODE){throw 'Vision model verification/setup failed.'}
Write-Output "Local visual computer-use is installed at $Destination. Restart Buji and select Visual in Computer access."
