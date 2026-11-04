"""Package real desktop-test screenshots as project visuals."""
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source, output = ROOT/'artifacts', ROOT/'docs'/'assets'
output.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source/'welcome.png', output/'welcome.png')
shutil.copyfile(source/'agent-workspace.png', output/'workspace.png')
frames = []
for name in ['01-welcome', '02-task', '03-command-review', '04-result', '05-review']:
    image = Image.open(source/'demo'/(name+'.png')).convert('RGB')
    image.thumbnail((1280, 900), Image.Resampling.LANCZOS)
    frames.append(image.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
frames[0].save(output/'workflow.gif', save_all=True, append_images=frames[1:],
               duration=[1200, 1800, 2200, 2000, 2400], loop=0, optimize=True, disposal=2)
print('Copied actual app captures and encoded a timed workflow walkthrough.')
