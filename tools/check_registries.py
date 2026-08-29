#!/usr/bin/env python3
"""check_registries.py — the published fingerprints must match the files on disk.

Loading an agent now VERIFIES it against state/agent_templates.json and refuses on mismatch, which
is what learn.html promises a stranger. That protection has a cost: a fingerprint left stale by an
edit no longer fails soft. It refuses the agent, and the world quietly loses a capability for a
reason nobody edited anything to cause.

So the registries have to be checked, not merely built once. This says which files drifted, and CI
runs it on every push. Rebuild with tools/build_agent_registry.py / tools/build_world_registry.py.

    python3 tools/check_registries.py
"""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
bad = 0


def check(name, path, key, rebuild):
    global bad
    p = ROOT / path
    if not p.exists():
        print(f"  MISSING  {path} — run {rebuild}")
        bad += 1
        return
    reg = json.loads(p.read_text())
    rows = reg.get(key) or []
    missing, drifted, ok = [], [], 0
    for row in rows:
        f = ROOT / row["file"]
        if not f.exists():
            missing.append(row["file"])
            continue
        actual = hashlib.sha256(f.read_bytes()).hexdigest()
        published = row.get("sha256")
        if len(str(published)) != 64:
            drifted.append((row["file"], "published fingerprint is not 64 hex", ""))
        elif actual != published:
            drifted.append((row["file"], published[:16], actual[:16]))
        else:
            ok += 1
    print(f"\n{name}: {len(rows)} entries")
    print(f"  {ok} match their file")
    for f in missing:
        print(f"  MISSING FILE  {f}")
    for f, want, got in drifted:
        print(f"  DRIFTED       {f}\n                published {want}…  on disk {got}…")
    if missing or drifted:
        print(f"  → rebuild with {rebuild}")
        bad += len(missing) + len(drifted)


check("agents", "state/agent_templates.json", "templates", "python3 tools/build_agent_registry.py")
check("worlds", "state/worlds.json", "worlds", "python3 tools/build_world_registry.py")

if bad:
    print(f"\n✗ {bad} registry entries do not describe the files on disk.")
    print("  A stale fingerprint is not cosmetic: hot-loading REFUSES bytes that do not match it,")
    print("  so whatever drifted here stops loading for everyone.")
    sys.exit(1)
print("\n✓ every published fingerprint matches its file")
