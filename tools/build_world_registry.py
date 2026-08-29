#!/usr/bin/env python3
"""build_world_registry.py — the published worlds, with their hashes.

The forge does not invent a world from a blank page. It adapts a REAL one, and it will not touch
bytes it cannot verify — the same rule kody-w/RAR's learn_new_agent applies to agents. That rule
needs a registry, and a registry needs to be built from the files rather than typed by hand.

Walks the world pages in this repo, reads what each one actually is, and writes state/worlds.json
with a sha256 per world. Nothing downstream is allowed to use a world whose bytes do not match.
"""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "state" / "worlds.json"

# pages that are not worlds: tooling, viewers, copies, archives
SKIP = re.compile(r"^(views|house|frontier|autodrive|spectate|index_heavy|index_slim|newindex|"
                  r"index2\.0|v3|404|record-review-app|brainstormer|brian-tracy-list)\.html$"
                  r"|copy|archive/", re.I)


def title_of(text):
    m = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def describe(text):
    m = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', text, re.S | re.I)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def traits(text):
    """What a world actually contains — read off the source, not guessed."""
    low = text.lower()
    return {
        "three": "three.min.js" in low or "three.module" in low,
        "portals": low.count("portal"),
        "lights": len(re.findall(r"new\s+THREE\.\w*Light", text)),
        "meshes": len(re.findall(r"new\s+THREE\.Mesh", text)),
        "fog": "scene.fog" in low,
        "audio": "audiocontext" in low or "new audio(" in low,
        "multiplayer": "multiplayer" in low,
        "bytes": len(text),
    }


def main():
    worlds = []
    for f in sorted(ROOT.glob("*.html")):
        if SKIP.search(f.name):
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        t = traits(text)
        if not t["three"] or t["meshes"] < 3:
            continue                                  # not a 3D world, whatever else it is
        worlds.append({
            "file": f.name,
            "title": title_of(text) or f.stem.replace("-", " ").replace("_", " "),
            "description": describe(text),
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "traits": t,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"schema": "nexus-worlds/1", "count": len(worlds), "worlds": worlds},
        indent=1, sort_keys=True) + "\n")
    print(f"✓ {OUT.relative_to(ROOT)} — {len(worlds)} published worlds, each with its sha256")
    for w in worlds[:6]:
        print(f"    {w['file']:<38} {w['sha256'][:12]}…  {w['traits']['meshes']:>4} meshes  {w['traits']['portals']:>4} portal refs")
    if len(worlds) > 6:
        print(f"    … and {len(worlds) - 6} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
