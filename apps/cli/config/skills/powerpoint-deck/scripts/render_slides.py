"""render_slides — visual QA for built decks (LibreOffice + PyMuPDF).

    $DSH_OFFICE_PYTHON render_slides.py deck.pptx [--out qa] [--dpi 120]

Writes qa/slide-NN.png (one per slide), qa/sheet.png (contact sheet), and
prints the absolute paths. View sheet.png first; open individual slides for
anything that looks off. Overflow, overlap, and contrast defects are the
usual finds — fix them in the build script and re-render.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path


def ensure_fitz() -> None:
    try:
        import pymupdf  # noqa: F401
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "pymupdf"], check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("deck")
    ap.add_argument("--out", default="qa")
    ap.add_argument("--dpi", type=int, default=120)
    ap.add_argument("--soffice", default="soffice")
    args = ap.parse_args()
    ensure_fitz()
    import pymupdf
    from PIL import Image, ImageDraw

    deck = Path(args.deck).resolve()
    if not deck.exists():
        print(f"not found: {deck}", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("slide-*.png"):
        old.unlink()

    with tempfile.TemporaryDirectory(prefix="qa-render-") as tmp:
        subprocess.run(
            [args.soffice, "--headless", "--norestore",
             f"-env:UserInstallation=file://{tmp}/profile",
             "--convert-to", "pdf", "--outdir", tmp, str(deck)],
            check=True, capture_output=True, timeout=180)
        pdf = next(Path(tmp).glob("*.pdf"))
        doc = pymupdf.open(pdf)
        pages = [p.get_pixmap(dpi=args.dpi) for p in doc]
        pngs = []
        for i, pix in enumerate(pages, 1):
            p = out / f"slide-{i:02d}.png"
            pix.save(p)
            pngs.append(p)

    # contact sheet: 3-wide grid of thumbnails with slide numbers
    thumb_w = 640
    first = Image.open(pngs[0])
    ratio = first.height / first.width
    pad, label_h = 12, 26
    cols = 3
    rows = (len(pngs) + cols - 1) // cols
    cell_w, cell_h = thumb_w + pad * 2, int(thumb_w * ratio) + label_h + pad
    sheet = Image.new("RGB", (cols * cell_w + pad, rows * cell_h + pad), "#E9ECF1")
    draw = ImageDraw.Draw(sheet)
    for i, p in enumerate(pngs):
        img = Image.open(p).resize((thumb_w, int(thumb_w * ratio)))
        cx, cy = pad + (i % cols) * cell_w, pad + (i // cols) * cell_h
        sheet.paste(img, (cx + pad, cy + label_h))
        draw.text((cx + pad, cy + 6), f"slide {i + 1}", fill="#333333")
    sheet_path = out / "sheet.png"
    sheet.save(sheet_path)

    print(f"{len(pngs)} slides -> contact sheet: {sheet_path}")
    print("individual:", " ".join(str(p) for p in pngs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
