"""Download the official, pinned Qwen vision GGUFs. Inference stays on localhost."""
import hashlib
import json
import pathlib
import urllib.request
import argparse

ROOT = pathlib.Path(__file__).resolve().parents[3]
DEST = ROOT / 'outputs' / 'BujiVision'
REPO = 'Qwen/Qwen3-VL-2B-Instruct-GGUF'
REVISION = '52d6c8ffea26cc873ac5ad116f8631268d7eb503'
FILES = {
    'Qwen3VL-2B-Instruct-Q4_K_M.gguf': (1107409952, '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae'),
    'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf': (445053216, 'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82'),
}


def digest(file):
    checksum = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def main():
    global DEST
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=pathlib.Path, default=DEST)
    parser.add_argument('--server', type=pathlib.Path, default=ROOT / 'outputs/Qwen3-Personal-WSP/runtime/llama-server.exe')
    args = parser.parse_args()
    DEST = args.destination.resolve()
    server = args.server.resolve()
    if not server.is_file():
        raise RuntimeError('Supply --server with your official llama.cpp llama-server.exe path.')
    model_dir = DEST / 'models'
    model_dir.mkdir(parents=True, exist_ok=True)
    revision = REVISION
    for name, (size, sha) in FILES.items():
        target = model_dir / name
        if target.exists() and target.stat().st_size == size and digest(target) == sha:
            print(f'Already verified: {name}', flush=True)
            continue
        part = target.with_suffix('.gguf.part')
        start = part.stat().st_size if part.exists() else 0
        request = urllib.request.Request(f'https://huggingface.co/{REPO}/resolve/{revision}/{name}',
                                         headers={'Range': f'bytes={start}-'} if start else {})
        with urllib.request.urlopen(request, timeout=60) as response:
            append = start > 0 and response.status == 206
            total = start if append else 0
            announced = total // (100 * 1024 * 1024)
            with part.open('ab' if append else 'wb') as output:
                while chunk := response.read(4 * 1024 * 1024):
                    output.write(chunk)
                    total += len(chunk)
                    if total // (100 * 1024 * 1024) > announced:
                        announced = total // (100 * 1024 * 1024)
                        print(f'{name}: {total // (1024 * 1024)} / {size // (1024 * 1024)} MiB', flush=True)
        if part.stat().st_size != size or digest(part) != sha:
            raise RuntimeError(f'Size/SHA-256 mismatch: {name}. The incomplete file was retained for inspection.')
        part.replace(target)
        print(f'Verified SHA-256: {name}', flush=True)
    config = {'schema': 1, 'source': REPO, 'revision': revision, 'license': 'Apache-2.0',
              'endpoint': 'http://127.0.0.1:8096/v1', 'model': 'buji-vision-local',
              'server': str(server),
              'python': str(DEST / 'runtime/Scripts/python.exe'),
              'weights': str(model_dir / next(iter(FILES))),
              'projector': str(model_dir / 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf'),
              'sha256': {name: sha for name, (_, sha) in FILES.items()},
              'gpuLayers': 20, 'context': 4096}
    (DEST / 'vision.json').write_text(json.dumps(config, indent=2), encoding='utf8')
    with urllib.request.urlopen(f'https://huggingface.co/{REPO}/resolve/{revision}/README.md', timeout=30) as response:
        (DEST / 'MODEL-CARD.md').write_bytes(response.read())
    with urllib.request.urlopen('https://raw.githubusercontent.com/QwenLM/Qwen3-VL/main/LICENSE', timeout=30) as response:
        (DEST / 'LICENSE-QWEN.txt').write_bytes(response.read())
    print(f'Local vision configured: {DEST}', flush=True)


if __name__ == '__main__':
    main()
