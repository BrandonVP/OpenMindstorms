import base64, pathlib
b64 = open('cp.b64').read()
FONT = f"@font-face{{font-family:'Chakra Petch';font-weight:700;src:url(data:font/woff2;base64,{b64}) format('woff2');}}"

def rcx(x, y, s=1.0):
    # 150x96 brick, matches the home page CSS drawing
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect width="150" height="96" rx="8" fill="#f5b800"/>
  <path d="M0 80 h150 v8 a8 8 0 0 1 -8 8 h-134 a8 8 0 0 1 -8 -8z" fill="rgba(0,0,0,.18)"/>
  <rect x="40" y="16" width="70" height="36" rx="3" fill="#c8d2b6"/>
  <rect x="40" y="16" width="70" height="4" rx="2" fill="rgba(0,0,0,.18)"/>
  <rect x="44" y="64" width="22" height="16" rx="3" fill="#1f8a4c"/>
  <rect x="84" y="64" width="22" height="16" rx="3" fill="#c0392b"/>
</g>'''

def nxt(x, y, s=1.0):
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect x="1" y="1" width="112" height="142" rx="10" fill="#e9e9e9" stroke="#cfcfcf" stroke-width="2"/>
  <rect x="16" y="20" width="78" height="50" rx="3" fill="#d9dfd0"/>
  <rect x="16" y="20" width="78" height="5" rx="2" fill="rgba(0,0,0,.18)"/>
  <rect x="44" y="88" width="22" height="22" rx="4" fill="#f28c28"/>
  <rect x="14" y="88" width="22" height="22" rx="4" fill="#9a9a9a"/>
  <rect x="74" y="88" width="22" height="22" rx="4" fill="#9a9a9a"/>
  <rect x="44" y="118" width="22" height="22" rx="4" fill="#5c5c5c"/>
</g>'''

def ev3(x, y, s=1.0):
    return f'''<g transform="translate({x} {y}) scale({s})">
  <rect x="1" y="1" width="112" height="142" rx="6" fill="#f2f2f2" stroke="#d0d0d0" stroke-width="2"/>
  <rect x="14" y="16" width="82" height="56" rx="3" fill="#cfd6c4"/>
  <rect x="14" y="16" width="82" height="5" rx="2" fill="rgba(0,0,0,.18)"/>
  <circle cx="55" cy="103" r="9" fill="#c0392b"/>
  <circle cx="27" cy="103" r="9" fill="#8e8e8e"/>
  <circle cx="83" cy="103" r="9" fill="#8e8e8e"/>
  <circle cx="55" cy="81" r="9" fill="#8e8e8e"/>
  <circle cx="55" cy="125" r="9" fill="#8e8e8e"/>
</g>'''

def word(x, y, size, ink, anchor="middle"):
    return (f'<text x="{x}" y="{y}" font-family="Chakra Petch" font-weight="700" font-size="{size}" '
            f'text-anchor="{anchor}" letter-spacing="{size*0.01:.1f}"><tspan fill="{ink}">Open</tspan>'
            f'<tspan fill="#f5b800">Mindstorms</tspan></text>')

def svg(w, h, bg, body, radius=0):
    bgrect = f'<rect width="{w}" height="{h}" rx="{radius}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<style>{FONT}</style>{bgrect}{body}</svg>')

def square(bg, ink, radius):
    # 512x512: bricks across the top, wordmark below. Brick row width: 150 + 110 + 110 + 2 gaps of 28 = 426
    row_y = 126
    body = rcx(43, row_y + 22) + nxt(221, row_y) + ev3(359, row_y) + word(256, 372, 50, ink)
    return svg(512, 512, bg, body, radius)

def wide(bg, ink):
    # 1600x500: bricks left, wordmark right
    row_y = 170
    body = (rcx(90, row_y + 24, 1.1) + nxt(300, row_y, 1.1) + ev3(460, row_y, 1.1)
            + word(660, 288, 96, ink, "start"))
    return svg(1600, 500, bg, body)

out = pathlib.Path('.')
(out/'logo-square-dark.svg').write_text(square('#12161b', '#e5e9ee', 64), encoding='utf-8')
(out/'logo-square-light.svg').write_text(square('#ffffff', '#18212b', 64), encoding='utf-8')
(out/'logo-square-transparent.svg').write_text(square('', '#e5e9ee', 0), encoding='utf-8')
(out/'logo-wide-dark.svg').write_text(wide('#12161b', '#e5e9ee'), encoding='utf-8')
(out/'logo-wide-light.svg').write_text(wide('#ffffff', '#18212b'), encoding='utf-8')
for name, w, h in [('logo-square-dark',512,512),('logo-square-light',512,512),('logo-wide-dark',1600,500),('logo-wide-light',1600,500)]:
    (out/f'{name}.html').write_text(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent;overflow:hidden}}img{{display:block}}</style><img src="{name}.svg" width="{w}" height="{h}">', encoding='utf-8')
print('ok')
