"""Download a pinned original checkpoint, apply the supplied edit and export GGUF."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys

from huggingface_hub import snapshot_download
import numpy as np
from apply_edit import apply_checkpoint

BASE_REPO = 'Qwen/Qwen3-VL-4B-Instruct'
BASE_REVISION = 'ebb281ec70b05090aa6165b016eac8ec08e71b17'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--llama-source', required=True, type=Path)
    parser.add_argument('--quantizer', required=True, type=Path)
    args = parser.parse_args()
    converter = args.llama_source.resolve()/'convert_hf_to_gguf.py'
    if not converter.is_file() or not args.quantizer.is_file():
        parser.error('Provide the llama.cpp converter source and llama-quantize executable.')
    work, output = args.work_dir.resolve(), args.output_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        parser.error('Choose an empty output directory to preserve existing weights.')
    base, edited = work/'base', work/'edited-hf'
    snapshot_download(BASE_REPO, revision=BASE_REVISION, local_dir=str(base),
                      allow_patterns=['*.safetensors', '*.json', '*.txt', 'README.md'])
    direction = np.load(Path(__file__).with_name('refusal-direction.npz'), allow_pickle=False)['direction']
    audit = apply_checkpoint(base, edited, direction)
    env = {**os.environ, 'PYTHONPATH': str(args.llama_source.resolve()/'gguf-py') + os.pathsep + os.environ.get('PYTHONPATH', '')}
    f16 = work/'Qwen3-Personal-WSP-f16.gguf'
    subprocess.run([sys.executable, str(converter), str(edited), '--outtype', 'f16', '--model-name',
                    'Qwen3 Personal WSP', '--outfile', str(f16)], env=env, check=True)
    subprocess.run([str(args.quantizer.resolve()), str(f16), str(output/'Qwen3-Personal-WSP-Q4_K_M.gguf'),
                    'Q4_K_M', '8'], check=True)
    subprocess.run([sys.executable, str(converter), str(edited), '--mmproj', '--outtype', 'f16',
                    '--model-name', 'Qwen3 Personal Vision', '--outfile', str(output/'mmproj-Qwen3-Personal-f16.gguf')],
                   env=env, check=True)
    (output/'model-provenance.json').write_text(json.dumps({'base_repo': BASE_REPO, 'base_revision': BASE_REVISION,
        'llama_cpp_reference': 'b12099', 'edited_tensors': audit['edited_tensors'], 'quantization': 'Q4_K_M',
        'limitation': 'Experimental refusal-reduced checkpoint; no broad capability or full-refusal-removal guarantee.'}, indent=2), encoding='utf-8')
    shutil.copyfile(Path(__file__).with_name('BASE_MODEL_LICENSE.txt'), output/'LICENSE.base-model.txt')
    print('Model exported. Original and intermediate checkpoints remain in the chosen work directory.')


if __name__ == '__main__':
    main()
