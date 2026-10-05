"""Rebuild public/fonts/material-symbols-rounded.woff2 from the `material-symbols` npm package.

The upstream variable font is ~5.4 MB. The UI only uses weight 400 at the default grade and optical
size, so those axes are pinned and only FILL (outlined vs filled icons) stays variable: ~0.5 MB with
every icon kept, since admins can pick any icon name for subjects and career nodes.

    pip install fonttools brotli && python scripts/build-icon-font.py
"""
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

root = Path(__file__).resolve().parent.parent
font = TTFont(root / "node_modules/material-symbols/material-symbols-rounded.woff2")
out = instancer.instantiateVariableFont(font, {"wght": 400, "GRAD": 0, "opsz": 24})
out.flavor = "woff2"
out.save(root / "public/fonts/material-symbols-rounded.woff2")
