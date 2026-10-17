"""Build a single self-contained HTML (for the claude.ai artifact preview) from index.html + style.css + app.js.
GitHub Pages serves the three source files directly; this script is only for the inline preview.
Usage: python3 build.py <out.html>
"""
import sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "style.css").read_text()
js = (root / "app.js").read_text()

import base64
for f in ("Geist-Variable.woff2", "GeistMono-Variable.woff2"):  # self-hosted fonts → data URIs for the single-file preview
    b64 = base64.b64encode((root / "fonts" / f).read_bytes()).decode()
    css = css.replace(f'url("fonts/{f}")', f'url("data:font/woff2;base64,{b64}")')
head_links = (
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<script>try{var t=localStorage.getItem("cloudlab:theme");if(t)document.documentElement.dataset.theme=JSON.parse(t)}catch(_){}</script>\n'
)
body = html.split("<body>", 1)[1].split("</body>", 1)[0]
body = body.replace('<script src="app.js"></script>', "<script>\n" + js + "\n</script>")
out = "<title>CloudLab</title>\n" + head_links + "<style>\n" + css + "\n</style>\n" + body
pathlib.Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1], len(out), "bytes")
