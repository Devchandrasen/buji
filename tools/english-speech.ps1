$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$segments = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$english = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en' } | Select-Object -First 1
if (!$english) { throw 'An installed English Windows voice is required for English terms.' }
$synth.SelectVoice($english.VoiceInfo.Name)
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$clips = @()
try {
    foreach ($text in $segments) {
        $stream = New-Object IO.MemoryStream
        try {
            $synth.SetOutputToAudioStream($stream, $format)
            $synth.Speak([string]$text)
            $synth.SetOutputToNull()
            $clips += [Convert]::ToBase64String($stream.ToArray())
        } finally { $stream.Dispose() }
    }
} finally { $synth.Dispose() }
[Console]::Out.Write((ConvertTo-Json -InputObject @($clips) -Compress))
