#!/usr/bin/env python3
"""check_portable.py — no source file may hardcode a path that exists on one machine.

tests/browser/dimension_seed.cjs carried an absolute path to one laptop's scratchpad as its
document root. Everywhere else, every file lookup 404'd and the browser loaded an empty error
body, so the suite waited forty-five seconds for modules that were never going to arrive. It
could not have passed on any other machine, and it sat in the suite looking green for days
because the only machine that ran it was the one it was written on.

The failure was expensive twice over: two rounds of investigation blamed CI timing, because a
path that resolves locally is invisible until something else runs it.

    python3 tools/check_portable.py
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE = {".js", ".cjs", ".mjs", ".py", ".html", ".json", ".yml", ".yaml", ".sh"}

# A path anchored in somebody's home directory or a private temp sandbox. GitHub's own runner
# path is included because copying one out of a CI log into a file is the same mistake.
HARDCODED = re.compile(r"""(?:^|['"\s=(])(/Users/[A-Za-z0-9._-]+/|/home/(?!runner/work\b)[A-Za-z0-9._-]+/|/private/tmp/claude-\d+/|/home/runner/work/)""")

# Things that legitimately name a machine path: documentation ABOUT paths, archived captures,
# and the workflow files that necessarily talk about the runner's own checkout.
SKIP_DIRS = ("archive/", "tests/node_modules/", ".git/", ".claude/")
SKIP_FILES = (".github/workflows/",)


def tracked():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
    return [p for p in out.stdout.splitlines() if p.strip()]


bad = []
checked = 0
for rel in tracked():
    if any(rel.startswith(d) for d in SKIP_DIRS) or any(rel.startswith(f) for f in SKIP_FILES):
        continue
    if Path(rel).suffix.lower() not in CODE:
        continue
    f = ROOT / rel
    if not f.exists():
        continue
    checked += 1
    try:
        text = f.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    for n, line in enumerate(text.splitlines(), 1):
        m = HARDCODED.search(line)
        if m:
            # a $HOME-relative join is fine; a literal one is not
            if "process.env.HOME" in line or "expanduser" in line or "os.environ" in line:
                continue
            bad.append((rel, n, line.strip()[:118]))

print(f"{checked} source files checked for machine-specific paths")
for rel, n, line in bad:
    print(f"  HARDCODED  {rel}:{n}\n             {line}")

if bad:
    print(f"\n✗ {len(bad)} hardcoded path(s). These work here and nowhere else — which is the"
          f"\n  worst kind of green, because only the machine that wrote them ever runs them.")
    sys.exit(1)
print("\n✓ nothing is anchored to one machine")
