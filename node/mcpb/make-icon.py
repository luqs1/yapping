# Draws icon.png for the .mcpb: a white speech bubble with three dots on a
# yapping-green rounded square. Drawn at 4x and scaled down for smooth edges.
#   python3 make-icon.py   → icon.png (512×512)
import sys
from PIL import Image, ImageDraw

S = 512 * 4
GREEN = (37, 211, 102, 255)   # yapping's colour (#25D366, shared/sim.js)
INK = (16, 122, 58, 255)      # the dots: a deeper green
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=GREEN)

# The bubble: a rounded body and a small tail at the bottom left.
l, t, r, b = int(S * 0.19), int(S * 0.22), int(S * 0.81), int(S * 0.68)
d.rounded_rectangle([l, t, r, b], radius=int(S * 0.15), fill='white')
d.polygon([(int(S * 0.30), b - int(S * 0.04)), (int(S * 0.25), int(S * 0.82)), (int(S * 0.45), b - int(S * 0.02))], fill='white')

# Three dots: someone's typing.
cy = (t + b) // 2
rad = int(S * 0.045)
for cx in (S * 0.36, S * 0.50, S * 0.64):
    cx = int(cx)
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=INK)

out = sys.argv[1] if len(sys.argv) > 1 else 'icon.png'
img.resize((512, 512), Image.LANCZOS).save(out, optimize=True)
print('wrote', out)
