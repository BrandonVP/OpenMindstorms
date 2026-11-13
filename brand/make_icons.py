"""Favicons: a brick on a dark rounded tile. Home = all three, each Workbench its own brick.
Writes SVGs to web/shared/icons and (with Pillow + headless Edge renders) PNG/ICO sizes."""
import pathlib, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'web' / 'shared' / 'icons'
BG = '#12161b'

def rcx(x, y, s):
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect width="150" height="96" rx="10" fill="#f5b800"/>
  <path d="M0 80 h150 v6 a10 10 0 0 1 -10 10 h-130 a10 10 0 0 1 -10 -10z" fill="rgba(0,0,0,.18)"/>
  <rect x="38" y="14" width="74" height="40" rx="4" fill="#c8d2b6"/>
  <rect x="42" y="64" width="24" height="16" rx="3" fill="#1f8a4c"/>
  <rect x="84" y="64" width="24" height="16" rx="3" fill="#c0392b"/>
</g>'''

def nxt(x, y, s):
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect width="114" height="144" rx="12" fill="#e9e9e9"/>
  <rect x="14" y="18" width="86" height="54" rx="4" fill="#d9dfd0"/>
  <rect x="43" y="86" width="28" height="26" rx="5" fill="#f28c28"/>
  <rect x="10" y="86" width="26" height="26" rx="5" fill="#9a9a9a"/>
  <rect x="78" y="86" width="26" height="26" rx="5" fill="#9a9a9a"/>
  <rect x="43" y="118" width="28" height="20" rx="5" fill="#5c5c5c"/>
</g>'''

def ev3(x, y, s):
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect width="114" height="144" rx="8" fill="#f2f2f2"/>
  <rect x="12" y="14" width="90" height="58" rx="4" fill="#cfd6c4"/>
  <circle cx="57" cy="104" r="11" fill="#c0392b"/>
  <circle cx="27" cy="104" r="10" fill="#8e8e8e"/>
  <circle cx="87" cy="104" r="10" fill="#8e8e8e"/>
  <circle cx="57" cy="80" r="9" fill="#8e8e8e"/>
  <circle cx="57" cy="128" r="9" fill="#8e8e8e"/>
</g>'''

def tile(body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" rx="96" fill="{BG}"/>{body}</svg>')

ICONS = {
    # single bricks fill ~78% of the tile; the home tile lines all three up
    'rcx':  tile(rcx(46, 112, 2.8)),                      # 150*2.8 = 420 wide, 96*2.8 = 269 tall
    'nxt':  tile(nxt(85, 54, 3.0)),                       # 114*3 = 342 wide, 144*3 = 432 tall
    'ev3':  tile(ev3(85, 54, 3.0)),
    'home': tile(rcx(28, 196, 1.2) + nxt(228, 160, 1.25) + ev3(378, 160, 1.25)),
}

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, svg in ICONS.items():
        (OUT / f'{name}.svg').write_text(svg, encoding='utf-8')
    print('svg written to', OUT)
    if '--png' in sys.argv:
        from PIL import Image
        edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
        tmp = pathlib.Path(sys.argv[sys.argv.index('--png') + 1])
        for name in ICONS:
            html = tmp / f'{name}.html'
            html.write_text(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;overflow:hidden}}img{{display:block}}</style>'
                            f'<img src="{(OUT / (name + ".svg")).as_uri()}" width="512" height="512">', encoding='utf-8')
            png = tmp / f'{name}-512.png'
            if png.exists(): png.unlink()
            subprocess.run([edge, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=512,512',
                            f'--screenshot={png}', html.as_uri()], capture_output=True)
            im = Image.open(png).convert('RGBA')
            im.resize((180, 180), Image.LANCZOS).save(OUT / f'{name}-180.png')
            im.resize((32, 32), Image.LANCZOS).save(OUT / f'{name}-32.png')
            im.save(OUT / f'{name}.ico', sizes=[(16, 16), (32, 32), (48, 48)])
            print(name, 'png/ico ok')
