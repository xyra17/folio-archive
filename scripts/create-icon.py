"""Regenerate the geometric application icon with Pillow; iconutil is macOS only."""
from pathlib import Path
from PIL import Image, ImageDraw
import subprocess
root=Path(__file__).resolve().parent.parent
out=root/'build'/'icon.iconset'
out.mkdir(parents=True,exist_ok=True)
scale=4
im=Image.new('RGBA',(1024*scale,1024*scale))
d=ImageDraw.Draw(im)
def box(v):return tuple(x*scale for x in v)
d.rounded_rectangle(box((82,82,942,942)),radius=195*scale,fill='#29664d')
d.rounded_rectangle(box((228,282,510,731)),radius=28*scale,fill='#f3f6ed')
d.rounded_rectangle(box((514,282,796,731)),radius=28*scale,fill='#f3f6ed')
d.polygon([tuple(x*scale for x in v) for v in [(510,316),(510,756),(463,723),(260,723),(260,690),(462,690)]],fill='#c3d5c6')
d.line(box((512,308,512,753)),fill='#29664d',width=22*scale)
for y in (380,458,536):
 d.rounded_rectangle(box((288,y,445,y+17)),radius=8*scale,fill='#98b59c')
 d.rounded_rectangle(box((579,y,736,y+17)),radius=8*scale,fill='#98b59c')
for n in (16,32,128,256,512):
 for factor in (1,2):
  target=out/f'icon_{n}x{n}{"@2x" if factor==2 else ""}.png'
  im.resize((n*factor,n*factor),Image.Resampling.LANCZOS).save(target)
im.resize((512,512),Image.Resampling.LANCZOS).save(root/'build'/'icon.png')
subprocess.run(['iconutil','-c','icns',str(out),'-o',str(root/'build'/'icon.icns')],check=True)
print(root/'build'/'icon.icns')
