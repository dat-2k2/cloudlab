"""Build a single self-contained HTML (for the claude.ai artifact preview) from index.html + style.css + src/*.js.
GitHub Pages serves the three source files directly; this script is only for the inline preview.
Usage: python3 build.py <out.html>
"""
import sys, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text()
css = (root / "style.css").read_text()
SCRIPTS = ["vendor/js-yaml.min.js", "src/prices.js", "src/shell/core.js", "src/shell/model.js", "src/shell/sim.js", "src/aws/catalog.js", "src/aws/cfn.js", "src/aws/infra.js", "src/aws/org.js", "src/aws/eli5.js", "src/aws/iam.js", "src/aws/sim.js", "src/aws/streaming.js", "src/aws/lessons.js", "src/aws/lessons-org.js", "src/aws/lessons-stream.js", "src/aws/bank.js", "src/aws/iac.js", "src/aws/lint.js", "src/aws/views.js", "src/shell/editor.js", "src/shell/ui.js", "src/shell/webmcp.js", "src/aws/changelog.js", "src/shell/tour.js"]
import os
kit = pathlib.Path(os.environ.get("KIT_DIR", root.parent / "dat-2k2.github.io" / "kit"))  # served at ../kit/ on GitHub Pages
kit_css = (kit / "layout.css").read_text()
kit_js = (kit / "layout.js").read_text()
# inline <script> must not contain a literal closing tag (the kit header comment has one)
kit_js = kit_js.replace("</script", "<\\/script")

import base64
for f in ("Geist-Variable.woff2", "GeistMono-Variable.woff2"):  # self-hosted fonts → data URIs for the single-file preview
    b64 = base64.b64encode((root / "fonts" / f).read_bytes()).decode()
    css = css.replace(f'url("fonts/{f}")', f'url("data:font/woff2;base64,{b64}")')
head_links = (
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<script>try{var t=localStorage.getItem("cloudlab:theme");if(t)document.documentElement.dataset.theme=JSON.parse(t)}catch(_){}</script>\n'
)
body = html.split("<body>", 1)[1].split("</body>", 1)[0]
import re
for src in SCRIPTS:
    code = (root / src).read_text().replace("</script", "<\\/script")
    body = re.sub(r'<script src="%s"></script>' % re.escape(src), lambda m: "<script>\n" + code + "\n</script>", body)
body = body.replace('<script src="../kit/layout.js"></script>', "<script>\n" + kit_js + "\n</script>")
out = "<title>CloudLab</title>\n" + head_links + "<style>\n" + kit_css + "\n" + css + "\n</style>\n" + body
pathlib.Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1], len(out), "bytes")

# plain-text / static HTML versions of the lessons for LLM readers and search engines (needs node; skipped if missing)
import shutil, subprocess, os as _os
if shutil.which("node"):
    for tool in ("export-text.js", "export-k8s.js", "export-gcp.js", "export-pricing.js"):
        subprocess.run(["node", _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "tools", tool)], check=False)
