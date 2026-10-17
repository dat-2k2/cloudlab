"""Build a single self-contained HTML (for the claude.ai artifact preview) from index.html + style.css + app.js.
GitHub Pages serves the three source files directly; this script is only for the inline preview.
Usage: python3 build.py <out.html>
"""
import sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "style.css").read_text()
js = (root / "app.js").read_text()

head_links = (
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">\n'
)
body = html.split("<body>", 1)[1].split("</body>", 1)[0]
body = body.replace('<script src="app.js"></script>', "<script>\n" + js + "\n</script>")
out = "<title>CloudLab</title>\n" + head_links + "<style>\n" + css + "\n</style>\n" + body
pathlib.Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1], len(out), "bytes")
