#!/usr/bin/env python3
"""check_portable.py — source rules that only fail somewhere else, or later.

Two rules, both for defects that look fine on the machine and day they are written.

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

# RULE 2: a frame's seq may not be taken from the length of the array holding the chain. It is
# correct right up until the chain is windowed, and then seq stalls at the cap and repeats — the
# line stops verifying and reads as a life that keeps restarting. This estate had it in FOUR
# places (the player chain, the vbrainstem chain, the world chain and the ensemble chain), each
# found and fixed separately, weeks apart. seq counts the life; the array is just what is kept.
SEQ_FROM_LENGTH = re.compile(r"seq\s*:\s*[A-Za-z_$][\w.$]*\.length\b")
seq_bad = []
for rel in tracked():
    if any(rel.startswith(d) for d in SKIP_DIRS) or Path(rel).suffix.lower() not in {".js", ".cjs", ".mjs"}:
        continue
    f = ROOT / rel
    if not f.exists():
        continue
    for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        if SEQ_FROM_LENGTH.search(line):
            seq_bad.append((rel, n, line.strip()[:118]))

print(f"{checked} source files checked for machine-specific paths")
for rel, n, line in seq_bad:
    print(f"  SEQ FROM LENGTH  {rel}:{n}\n                   {line}")
if seq_bad:
    print(f"\n  a seq taken from an array length is correct until that array is windowed,"
          f"\n  and then the chain stops verifying. Keep a counter for the line itself.")
    bad.extend(seq_bad)
for rel, n, line in bad:
    print(f"  HARDCODED  {rel}:{n}\n             {line}")

if bad:
    paths = len(bad) - len(seq_bad)
    parts = []
    if paths:
        parts.append(f"{paths} hardcoded path(s), which work here and nowhere else")
    if seq_bad:
        parts.append(f"{len(seq_bad)} seq(s) taken from an array length, which work until the chain is windowed")
    print(f"\n✗ " + "; and ".join(parts) + ".")
    print("  Both are the worst kind of green: correct on the machine and the day they were written.")
    sys.exit(1)
print("\n✓ nothing is anchored to one machine, and every chain numbers the line rather than the array")
