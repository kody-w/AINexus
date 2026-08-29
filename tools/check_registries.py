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
import hashlib, json, re, sys
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


def check_bootstrap():
    """Every python file fetched from ANOTHER repository must be pinned and fingerprinted.

    This is the check that was missing when learn.html promised strangers that an agent fetched by
    name is hashed and refused on mismatch. It was true of the eight same-origin agents under
    ai/vb/ and false of the three fetched across origins off a mutable `main` — including
    basic_agent.py, the base class every verified agent inherits from. Adding a fourth such fetch
    must fail here rather than quietly widening the hole.
    """
    global bad
    src = (ROOT / "ai" / "vbrainstem.js").read_text()
    pins = {}
    bp = ROOT / "state" / "bootstrap_agents.json"
    if bp.exists():
        pins = {a["file"]: a for a in json.loads(bp.read_text()).get("agents", [])}

    wanted = set(re.findall(r"file:\s*'([A-Za-z0-9_.-]+\.py)'", src))
    m = re.search(r"BASIC_AGENT_URL\s*=\s*'([^']+)'", src)
    if m:
        wanted.add(m.group(1).rsplit("/", 1)[-1])

    print(f"\ncross-repo bootstrap: {len(wanted)} python files fetched from other repositories")
    for f in sorted(wanted):
        pin = pins.get(f)
        if not pin:
            print(f"  UNPINNED      {f} — fetched from another repo with no published fingerprint")
            bad += 1
        elif len(str(pin.get("sha256", ""))) != 64 or len(str(pin.get("commit", ""))) != 40:
            print(f"  INCOMPLETE    {f} — a pin needs both a 40-char commit and a 64-hex sha256")
            bad += 1
        else:
            print(f"  ok            {f}  {pin['repo']}@{pin['commit'][:8]}")
    for f in sorted(set(pins) - wanted):
        print(f"  ORPHAN PIN    {f} — pinned but nothing fetches it any more")


check_bootstrap()

# WHAT THIS DOES NOT CHECK, said out loud. Every check above walks the registry ROWS, so a world
# or agent that was added and never registered passes silently — and an unregistered world is one
# the forge will simply never offer, with nothing anywhere saying why. Proving that gap: with an
# unregistered 3D world present, the loop above still printed "every published fingerprint matches
# its file". The complete check is to run the builders and see whether they change anything:
#
#     python3 tools/build_world_registry.py && python3 tools/build_agent_registry.py
#     git diff --exit-code -- state/worlds.json state/agent_templates.json
#
# CI runs exactly that on every push (.github/workflows/check-fingerprints.yml). This tool stays
# read-only so it is safe to run anywhere, which is precisely why it cannot see that case.
print("\n(this checks published rows against files; run the builders and diff to catch a world"
      "\n that was added and never registered — CI does that on every push)")

if bad:
    print(f"\n✗ {bad} problem(s): a published fingerprint does not match its file, or a file"
          f"\n  fetched from another repository has no pinned fingerprint at all.")
    print("  A stale fingerprint is not cosmetic: hot-loading REFUSES bytes that do not match it,")
    print("  so whatever drifted here stops loading for everyone.")
    sys.exit(1)
print("\n✓ every published fingerprint matches its file")
