"""Synthesize Hindi and mixed Hindi/English text with the installed local Piper model."""
import json
import base64
import io
from pathlib import Path
import re
import subprocess
import sys
import wave

import numpy as np
from piper import PiperVoice


text = json.loads(sys.stdin.buffer.read().decode('utf-8'))['text']
# Common technical terms have established Hindi pronunciations.
pronunciations = {
    'buji': 'बूजी', 'python': 'पाइथन', 'list': 'लिस्ट', 'example': 'एग्ज़ाम्पल', 'code': 'कोड',
    'coding': 'कोडिंग', 'script': 'स्क्रिप्ट', 'javascript': 'जावास्क्रिप्ट', 'typescript': 'टाइपस्क्रिप्ट',
    'github': 'गिटहब', 'api': 'ए पी आई', 'function': 'फ़ंक्शन', 'file': 'फ़ाइल', 'folder': 'फ़ोल्डर',
    'browser': 'ब्राउज़र', 'server': 'सर्वर', 'model': 'मॉडल', 'debug': 'डीबग', 'test': 'टेस्ट'
}
text = re.sub(r'\b[A-Za-z]+\b', lambda match: pronunciations.get(match[0].lower(), match[0]), text)
# Keep English technical terms intelligible while Hindi uses its local neural voice.
parts = [part.strip() for part in re.split(r'([A-Za-z][A-Za-z0-9_+.#/-]*(?:[ \t]+[A-Za-z][A-Za-z0-9_+.#/-]*)*)', text) if part.strip()]
english = [part for part in parts if re.match(r'[A-Za-z]', part)]
english_audio = iter([])
if english:
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', str(Path(__file__).with_name('english-speech.ps1'))],
                            input=json.dumps(english).encode('utf-8'), capture_output=True, check=True, timeout=60,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    english_audio = iter(json.loads(result.stdout.decode('utf-8-sig')))

voice = PiperVoice.load(sys.argv[1], use_cuda=False)


def speech_pcm(data):
    samples = np.frombuffer(data, dtype='<i2').astype(np.float32) / 32768
    audible = np.flatnonzero(np.abs(samples) > 0.004)
    if not audible.size:
        return b''
    padding = 1102
    samples = samples[max(0, audible[0] - padding):audible[-1] + padding + 1]
    rms = float(np.sqrt(np.mean(samples * samples)))
    peak = float(np.max(np.abs(samples)))
    samples *= min(0.15 / max(rms, 0.001), 0.92 / max(peak, 0.001))
    return (samples * 32767).astype('<i2').tobytes() + bytes(1102 * 2)


with wave.open(sys.argv[2], 'wb') as output:
    output.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
    for part in parts:
        if re.match(r'[A-Za-z]', part):
            output.writeframes(speech_pcm(base64.b64decode(next(english_audio))))
            continue
        elif re.search(r'[\u0900-\u097f\d]', part):
            audio = io.BytesIO()
            with wave.open(audio, 'wb') as clip:
                voice.synthesize_wav(part, clip)
            audio.seek(0)
        else:
            continue
        with wave.open(audio, 'rb') as clip:
            if (clip.getnchannels(), clip.getsampwidth(), clip.getframerate()) != (1, 2, 22050):
                raise ValueError('The speech segments must share the same PCM format.')
            output.writeframes(speech_pcm(clip.readframes(clip.getnframes())))
