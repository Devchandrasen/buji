"""Create Buji's editable vector assets and Windows icon. No generated UI imagery."""
from pathlib import Path
import math
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
DOCS = ROOT / 'docs' / 'assets'
ASSETS.mkdir(exist_ok=True)
DOCS.mkdir(parents=True, exist_ok=True)
mark_path = 'M78 54V202H136C170 202 190 185 190 159S170 118 136 118H78M78 54H128C158 54 178 71 178 94S158 118 128 118'
logo = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Buji logo">
<rect x="8" y="8" width="240" height="240" rx="64" fill="#202821"/>
<path d="{mark_path}" fill="none" stroke="#faf9f4" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
<rect x="198" y="198" width="29" height="29" rx="8" fill="#a6c6ae"/></svg>'''
(ASSETS / 'buji.svg').write_text(logo, encoding='utf-8')
(DOCS / 'logo.svg').write_text(logo, encoding='utf-8')
banner = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-label="Buji V1. Your personal AI workbench. Local models, real files, reviewable actions.">
<rect width="1280" height="640" fill="#edf0e6"/>
<path d="M0 596H1280M48 0V640M1232 0V640" stroke="#d8dfd0"/>
<g font-family="Segoe UI,Arial,sans-serif" fill="#202821">
<rect x="78" y="61" width="238" height="29" rx="14.5" fill="#dce7d7"/>
<circle cx="94" cy="75.5" r="3.5" fill="#427751"/>
<text x="107" y="80" font-size="11" font-weight="600" letter-spacing="1.8">OPEN SOURCE · LOCAL FIRST</text>
<text x="73" y="238" font-size="113" font-weight="700" letter-spacing="-7">Buji</text>
<rect x="329" y="174" width="66" height="44" rx="9" fill="#202821"/>
<text x="345" y="204" font-size="26" font-weight="600" fill="#edf0e6">V1</text>
<text x="78" y="324" font-size="40" font-weight="500" letter-spacing="-1.3">Your personal AI workbench.</text>
<text x="79" y="382" font-size="20" fill="#697761">Local models. Real files. Reviewable actions.</text>
<text x="79" y="427" font-size="16" fill="#697761">A personal alternative for coding and text-file work.</text>
<g font-size="12" font-weight="500" fill="#4c624e"><rect x="78" y="495" width="96" height="32" rx="6" fill="none" stroke="#b6c6af"/><text x="96" y="516">WINDOWS</text><rect x="186" y="495" width="65" height="32" rx="6" fill="none" stroke="#b6c6af"/><text x="204" y="516">MIT</text><rect x="263" y="495" width="178" height="32" rx="6" fill="none" stroke="#b6c6af"/><text x="280" y="516">BRING YOUR OWN MODEL</text></g>
<text x="79" y="621" font-size="11" fill="#74806b" letter-spacing=".7">github.com/Devchandrasen/buji</text>
</g><g transform="translate(853 157) scale(1.18)"><rect x="-16" y="-16" width="288" height="288" rx="79" fill="none" stroke="#cad6c1"/>
<rect x="8" y="8" width="240" height="240" rx="64" fill="#202821"/><path d="{mark_path}" fill="none" stroke="#faf9f4" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><rect x="198" y="198" width="29" height="29" rx="8" fill="#a6c6ae"/></g>
</svg>'''
(DOCS / 'banner.svg').write_text(banner, encoding='utf-8')

architecture = '''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640" viewBox="0 0 1200 640" role="img" aria-label="Buji desktop architecture: isolated UI bridge, main process agent, localhost model, project tools and reviewed commands.">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#73856c"/></marker></defs>
<rect width="1200" height="640" rx="18" fill="#f4f5ef"/>
<g font-family="Segoe UI,Arial,sans-serif" fill="#253126"><text x="45" y="57" font-size="25" font-weight="600">A local work loop you can inspect.</text><text x="46" y="87" font-size="13" fill="#73816a">BUJI V1 · DESKTOP, FILES AND MODEL</text></g>
<rect x="30" y="113" width="1140" height="479" rx="16" fill="none" stroke="#cdd7c6" stroke-dasharray="6 6"/><text x="50" y="141" fill="#7e8b75" font-family="Segoe UI,Arial" font-size="11">YOUR COMPUTER</text>
<g stroke="#73856c" stroke-width="1.7" fill="none" marker-end="url(#arrow)"><path d="M230 254H286"/><path d="M456 254H520"/><path d="M770 254H885"/><path d="M643 310V394H836"/><path d="M593 310V508H836"/><path d="M570 310V412H309"/></g>
<g font-family="Segoe UI,Arial,sans-serif" text-anchor="middle">
<rect x="55" y="202" width="175" height="106" rx="12" fill="#fff" stroke="#d7dfd1"/><text x="143" y="244" font-size="17" fill="#253126" font-weight="600">Desktop UI</text><text x="143" y="272" font-size="12" fill="#73816a">Chats · editor · diffs</text>
<rect x="286" y="202" width="170" height="106" rx="12" fill="#fff" stroke="#d7dfd1"/><text x="371" y="244" font-size="17" fill="#253126" font-weight="600">IPC bridge</text><text x="371" y="272" font-size="12" fill="#73816a">Isolated preload</text>
<rect x="520" y="182" width="250" height="128" rx="14" fill="#253a2c"/><text x="645" y="226" font-size="19" fill="#fff" font-weight="600">Buji main process</text><text x="645" y="258" font-size="13" fill="#bfd2b8">Agent loop · tool execution</text><text x="645" y="282" font-size="12" fill="#bfd2b8">One active turn · up to 16 rounds</text>
<rect x="885" y="202" width="253" height="106" rx="12" fill="#dfead8" stroke="#bbcdb1"/><text x="1011" y="241" font-size="17" fill="#253126" font-weight="600">Your local model</text><text x="1011" y="269" font-size="12" fill="#66795b">localhost chat API · GPU / CPU</text>
<rect x="91" y="374" width="218" height="83" rx="12" fill="#fff" stroke="#d7dfd1"/><text x="200" y="409" font-size="15" fill="#253126" font-weight="600">Local history</text><text x="200" y="433" font-size="12" fill="#73816a">Chats · preferences · edit journal</text>
<rect x="836" y="355" width="302" height="83" rx="12" fill="#fff" stroke="#d7dfd1"/><text x="987" y="389" font-size="15" fill="#253126" font-weight="600">Selected project files</text><text x="987" y="413" font-size="12" fill="#73816a">Scoped paths · recorded edits · guarded undo</text>
<rect x="836" y="467" width="302" height="83" rx="12" fill="#fff" stroke="#d7dfd1"/><text x="987" y="501" font-size="15" fill="#253126" font-weight="600">Reviewed PowerShell commands</text><text x="987" y="525" font-size="12" fill="#73816a">Normal user permissions · not an OS sandbox</text>
</g><text x="45" y="622" fill="#7e8b75" font-family="Segoe UI,Arial" font-size="11">Model output proposes work. File and command results record what actually happened.</text></svg>'''
(DOCS / 'architecture.svg').write_text(architecture, encoding='utf-8')

def cubic(p0, p1, p2, p3):
    return [tuple((1-t)**3*p0[i]+3*(1-t)**2*t*p1[i]+3*(1-t)*t*t*p2[i]+t**3*p3[i] for i in (0,1)) for t in [j/40 for j in range(41)]]
im = Image.new('RGBA', (256, 256), (0,0,0,0)); draw = ImageDraw.Draw(im)
draw.rounded_rectangle((8,8,248,248), radius=64, fill='#202821')
draw.line([(78,54),(78,202),(136,202)] + cubic((136,202),(170,202),(190,185),(190,159)) + cubic((190,159),(190,135),(170,118),(136,118)) + [(78,118)], fill='#faf9f4', width=16, joint='curve')
draw.line([(78,54),(128,54)] + cubic((128,54),(158,54),(178,71),(178,94)) + cubic((178,94),(178,108),(158,118),(128,118)), fill='#faf9f4', width=16, joint='curve')
draw.rounded_rectangle((198,198,227,227), radius=8, fill='#a6c6ae')
im.save(ASSETS/'buji.png'); im.save(ASSETS/'buji.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('Buji logo, banner, architecture diagram and Windows icon written.')
