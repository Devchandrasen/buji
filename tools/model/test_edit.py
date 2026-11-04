"""Small mathematical/integrity test; does not download a model."""
from pathlib import Path
import tempfile
import unittest
import torch
from safetensors.torch import save_file, load_file
from apply_edit import apply_checkpoint


class EditInvariantTests(unittest.TestCase):
    def test_projection_and_untouched_tensors(self):
        parent = Path(__file__).resolve().parents[2]/'work'/'model-recipe-tests'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            root = Path(temporary).resolve()
            self.assertTrue(root.is_relative_to(parent.resolve()))
            base, output = root/'base', root/'edited'
            base.mkdir()
            torch.manual_seed(17)
            names = ['model.language_model.layers.16.mlp.down_proj.weight',
                     'model.language_model.layers.16.self_attn.o_proj.weight']
            tensors = {name: torch.randn(4, 8) for name in names}
            tensors['model.visual.example.weight'] = torch.randn(3, 5)
            save_file(tensors, base/'model.safetensors')
            direction = torch.tensor([1., 2., 3., 4.]); direction /= direction.norm()
            report = apply_checkpoint(base, output, direction.numpy(), expected_tensors=2)
            changed, source = load_file(output/'model.safetensors'), load_file(base/'model.safetensors')
            self.assertEqual(report['edited_tensors'], 2)
            for name in names:
                self.assertTrue(torch.equal(source[name], tensors[name]))
                self.assertLess(float((direction @ changed[name]).norm()), 1e-5)
                delta = changed[name]-source[name]
                orthogonal = torch.eye(4)-direction[:, None]*direction[None, :]
                self.assertLess(float((orthogonal @ delta).norm()), 1e-5)
            self.assertTrue(torch.equal(changed['model.visual.example.weight'], tensors['model.visual.example.weight']))


if __name__ == '__main__':
    unittest.main()
