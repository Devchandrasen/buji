"""Direct gradient-free rank-one editing of a pinned Qwen checkpoint.

The optional model recipe is separate from Buji's application runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct

import numpy as np
import torch
from safetensors import safe_open


def apply_checkpoint(base, destination, direction, min_layer=16, max_layer=30, expected_tensors=30):
    base, destination = Path(base).resolve(), Path(destination).resolve()
    if base == destination or base in destination.parents or destination in base.parents:
        raise ValueError('Use separate, non-nested base and output directories.')
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError('The output directory must be empty; existing checkpoints are preserved.')
    vector = torch.as_tensor(direction, dtype=torch.float32)
    if vector.ndim != 1 or not torch.isfinite(vector).all() or not np.isclose(float(torch.linalg.vector_norm(vector)), 1, atol=1e-5):
        raise ValueError('Provide a finite unit direction vector.')
    torch.set_num_threads(4)
    records = []
    for source in sorted(base.iterdir()):
        if not source.is_file():
            continue
        output = destination/source.name
        shutil.copy2(source, output)
        if source.suffix != '.safetensors':
            continue
        with source.open('rb') as stream:
            header_size = struct.unpack('<Q', stream.read(8))[0]
            header = json.loads(stream.read(header_size))
        with safe_open(str(source), framework='pt', device='cpu') as reader, output.open('r+b') as writer:
            for name, info in header.items():
                if not (name.startswith('model.language_model.layers.') and name.endswith(('self_attn.o_proj.weight', 'mlp.down_proj.weight'))):
                    continue
                if not min_layer <= int(name.split('.')[3]) <= max_layer:
                    continue
                original = reader.get_tensor(name)
                if original.ndim != 2 or original.shape[0] != vector.numel():
                    raise ValueError('Unexpected tensor shape: '+name)
                weight = original.float()
                projection = vector @ weight
                weight.add_(vector[:, None] * projection[None, :], alpha=-1)
                edited = weight.to(original.dtype)
                if not torch.isfinite(edited).all():
                    raise ValueError('Non-finite tensor: '+name)
                before = memoryview(original.view(torch.uint8).numpy())
                after = memoryview(edited.view(torch.uint8).numpy())
                start, end = info['data_offsets']
                writer.seek(8+header_size+start)
                if writer.write(after) != end-start:
                    raise IOError('Tensor size mismatch: '+name)
                records.append({'tensor': name, 'before_sha256': hashlib.sha256(before).hexdigest(),
                                'after_sha256': hashlib.sha256(after).hexdigest(), 'shape': list(original.shape)})
                del original, weight, projection, edited, before, after
    if len(records) != expected_tensors:
        raise ValueError(f'Expected {expected_tensors} edited tensors, got {len(records)}. Do not use this output until reviewed.')
    report = {'method': 'W_new = W - outer(r, r @ W)', 'min_layer': min_layer, 'max_layer': max_layer,
              'edited_tensors': len(records), 'vision_tensors_targeted': 0, 'tensors': records}
    (destination/'buji-weight-edit.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--direction', type=Path, default=Path(__file__).with_name('refusal-direction.npz'))
    args = parser.parse_args()
    direction = np.load(args.direction, allow_pickle=False)['direction']
    report = apply_checkpoint(args.base, args.output, direction)
    print(json.dumps({'edited_tensors': report['edited_tensors'], 'output': str(args.output)}))


if __name__ == '__main__':
    main()
