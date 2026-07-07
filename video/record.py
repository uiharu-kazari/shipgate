#!/usr/bin/env python3
"""
Record each ShipGate demo scene as a webm using Playwright (Chromium).
Scenes are either a local HTML slide (file://) or a live public page (with a
scroll choreography). Each scene records for its narration's duration + padding.
Output: video/clips/NN.webm  (mux with audio in build.sh)

Run:  cd video && python3 record.py
Needs: playwright (pip install playwright && playwright install chromium)
"""
import os, time, glob, subprocess, pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
SCENES_DIR = HERE / "scenes"
CLIPS_DIR = HERE / "clips"
AUDIO_DIR = HERE / "audio"
W, H = 1280, 720

DASHBOARD = "https://shipgate-agent-maqob3nldq-an.a.run.app/"
PR_URL = "https://github.com/uiharu-kazari/shipgate-demo-shop/pull/1"

def audio_dur(n: str) -> float:
    f = AUDIO_DIR / f"{n}.mp3"
    if not f.exists():
        return 12.0
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)],
        capture_output=True, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 12.0

# id, kind, target, optional scroll choreography
# scene 03 is a faithful local reproduction of the (private) PR conversation using
# the real verdict data — avoids exposing the repo and needs no browser auth.
SCENES = [
    ("01", "slide", "01-hook.html", None),
    ("02", "slide", "02-what.html", None),
    ("03", "scrollslide", "03-pr.html", "scroll"),
    ("04", "page", DASHBOARD, "dashboard"),
    ("05", "slide", "05-injection.html", None),
    ("06", "slide", "06-close.html", None),
]

def choreograph(page, kind, hold):
    """Scroll live pages slowly through the interesting region for `hold` seconds."""
    if kind == "pr":
        # Jump near the ShipGate verdict comment, then creep down through it.
        try:
            page.get_by_text("ShipGate verdict", exact=False).first.scroll_into_view_if_needed(timeout=8000)
        except Exception:
            pass
        page.wait_for_timeout(1500)
        steps = max(1, int((hold - 2) * 10))
        for _ in range(steps):
            page.mouse.wheel(0, 42)
            page.wait_for_timeout(100)
    elif kind == "dashboard":
        page.wait_for_timeout(2000)  # let the card render / fetch evidence
        steps = max(1, int((hold - 2.5) * 10))
        for _ in range(steps):
            page.mouse.wheel(0, 34)
            page.wait_for_timeout(100)
    else:
        page.wait_for_timeout(int(hold * 1000))

def main():
    import sys
    only = set(sys.argv[1:])  # optional scene ids to (re)record, e.g. `python3 record.py 03`
    CLIPS_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb", "--hide-scrollbars"])
        for sid, kind, target, chor in SCENES:
            if only and sid not in only:
                continue
            hold = audio_dur(sid) + 1.2  # pad so the mux has enough footage
            tmp = CLIPS_DIR / f"_raw_{sid}"
            tmp.mkdir(exist_ok=True)
            ctx = browser.new_context(
                viewport={"width": W, "height": H},
                device_scale_factor=1,
                record_video_dir=str(tmp),
                record_video_size={"width": W, "height": H},
            )
            page = ctx.new_page()
            print(f"[{sid}] {kind}: {target}  (hold {hold:.1f}s)")
            if kind == "slide":
                page.goto((SCENES_DIR / target).as_uri())
                page.wait_for_timeout(int(hold * 1000))
            elif kind == "scrollslide":
                # local tall slide: hold at top, then slow-scroll to the bottom
                page.goto((SCENES_DIR / target).as_uri())
                page.wait_for_timeout(2000)
                total = page.evaluate("Math.max(0, document.body.scrollHeight - window.innerHeight)")
                steps = max(1, int((hold - 3.5) * 20))
                for i in range(steps):
                    page.evaluate(f"window.scrollTo(0, {total} * {i + 1} / {steps})")
                    page.wait_for_timeout(50)
                page.wait_for_timeout(1000)
            else:
                try:
                    page.goto(target, wait_until="domcontentloaded", timeout=45000)
                except Exception as e:
                    print(f"   warn: goto {target}: {e}")
                page.wait_for_timeout(2500)
                choreograph(page, chor, hold)
            ctx.close()  # finalizes the webm
            # move the single webm to NN.webm
            vids = sorted(glob.glob(str(tmp / "*.webm")))
            if vids:
                dest = CLIPS_DIR / f"{sid}.webm"
                os.replace(vids[0], dest)
                print(f"   -> {dest}")
            for leftover in glob.glob(str(tmp / "*")):
                os.remove(leftover)
            os.rmdir(tmp)
        browser.close()
    print("Done. Raw clips in video/clips/*.webm")

if __name__ == "__main__":
    main()
