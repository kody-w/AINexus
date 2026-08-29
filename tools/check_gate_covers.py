#!/usr/bin/env python3
"""check_gate_covers.py — every suite is either gated or named as excluded, with a reason.

A suite can fall out of CI in silence: nobody adds it to the gate, and nobody writes down why.
It then looks like part of a passing build while running nowhere. That is the same shape as a
suite that asserts nothing, one level up — and this estate has already had both.

The rule is deliberately weak on purpose: it does not judge WHETHER a reason is good, only that
somebody wrote the suite's name in the workflow. A human reading a name and a reason can argue
with it. A silent omission gives them nothing to argue with.

    python3 tools/check_gate_covers.py
"""
import glob, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
wf = (ROOT / ".github" / "workflows" / "suites.yml").read_text()

# The invocation is a YAML block scalar continued with backslashes. Take the lines that follow
# run_suites.cjs while they keep continuing, and nothing else — an earlier version of this regex
# swallowed the whole file, so every suite counted as "gated" and the split it printed was
# fiction. A checker that misdescribes what it found is the defect it is meant to catch.
lines = wf.splitlines()
gated = set()
for i, line in enumerate(lines):
    if "run_suites.cjs" in line and "node" in line:
        j = i
        while j < len(lines):
            gated |= set(re.findall(r"(?<![\w./-])[a-z][a-z_0-9]+(?![\w./-])", lines[j]))
            if not lines[j].rstrip().endswith("\\"):
                break
            j += 1
gated -= {"node", "tools", "run_suites", "cjs", "run"}
suites = sorted(os.path.basename(f)[:-4] for f in glob.glob(str(ROOT / "tests" / "browser" / "*.cjs")))

run, named, silent = [], [], []
for n in suites:
    if n in gated:
        run.append(n)
    elif re.search(r"(?<![\w-])" + re.escape(n) + r"(?![\w-])", wf):
        named.append(n)
    else:
        silent.append(n)

print(f"{len(suites)} suites: {len(run)} in the gate, {len(named)} excluded and named")
if named:
    print("  excluded with a stated reason: " + ", ".join(named))
if silent:
    print("\n  SILENTLY OUT: " + ", ".join(silent))
    print("  Each of these runs in no gate and is mentioned nowhere in the workflow, so it looks")
    print("  like part of a passing build while running nowhere. Add it to the gate, or say why not.")
    sys.exit(1)
print("\n✓ every suite is either gated or accounted for")
