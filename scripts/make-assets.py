from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
(root / 'build').mkdir(exist_ok=True)
image = Image.open(root / 'public' / 'assets' / 'mascot.png').convert('RGBA')
image.thumbnail((512, 512), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
canvas.alpha_composite(image, ((512 - image.width) // 2, (512 - image.height) // 2))
canvas.save(root / 'build' / 'icon.png')
canvas.save(root / 'build' / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Application icons created')
