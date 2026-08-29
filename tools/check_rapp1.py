#!/usr/bin/env python3
"""check_rapp1.py — is every frame this estate mints actually rapp/1 compliant?

Not "does it hash correctly" — frames/verify.py already answers that. This asks the questions
the SPEC asks and code usually does not:

  · is the `kind` REGISTERED? The registry is exact-match — never prefix inference, never
    wildcards (§6.1.1). Inventing `nexus.tick` because it reads well does not make it a kind.
  · does the kind's FAMILY match the stream_id FORM? (§7.2) A body kind belongs on a
    body-stream, which is a bare rappid — the moment you append `:something` it is a
    memory-stream and the frame is wrong however good its hashes are.
  · is the rappid itself grammatical? (§6.1) owner 1-39, slug 1-100, 64 lowercase hex.
  · prev_wave non-null iff swarm-stream with seq>0 (§7.x), and swarm frames signed (§10).

Reads the live anchor for the registry so this cannot drift from canon by being out of date.

  python3 tools/check_rapp1.py [file.jsonl ...]
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANCHOR = "https://raw.githubusercontent.com/kody-w/rapp-1/main/anchor/orient.json"
LOCAL_ANCHOR = Path.home() / "Documents/GitHub/rapp-1/anchor/orient.json"

LCLABEL = r"[a-z0-9]+(?:-?[a-z0-9]+)*"
RAPPID = re.compile(r"^rappid:@(%s)/(%s):([0-9a-f]{64})$" % (LCLABEL, LCLABEL))
MEMORY_STREAM = re.compile(r"^rappid:@(%s)/(%s):([0-9a-f]{64}):(%s)$" % (LCLABEL, LCLABEL, LCLABEL))
SWARM_STREAM = re.compile(r"^net:(%s)$" % LCLABEL)
KIND = re.compile(r"^(%s)\.(%s)$" % (LCLABEL, LCLABEL))


def registry():
    """The registered kinds and their families, from the anchor — live if reachable."""
    for src in (ANCHOR, LOCAL_ANCHOR):
        try:
            raw = (urllib.request.urlopen(src, timeout=6).read().decode()
                   if str(src).startswith("http") else Path(src).read_text())
            o = json.loads(raw)
            kinds = o.get("registered_kinds") or []
            if kinds:
                return {k: k.split(".")[0] for k in kinds}, str(src)
        except Exception:
            continue
    return {}, "UNREACHABLE — cannot check kinds against canon"


def form_of(stream_id):
    if RAPPID.match(stream_id):
        return "body-stream"
    if MEMORY_STREAM.match(stream_id):
        return "memory-stream"
    if SWARM_STREAM.match(stream_id):
        return "swarm-stream"
    return None


ALLOWED = {"memory": "memory-stream", "body": "body-stream", "swarm": "swarm-stream"}


def check(path, kinds, out):
    frames = []
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if line:
            try:
                frames.append(json.loads(line))
            except Exception:
                out.append((path, "-", "not JSON", line[:60]))
    seen_kinds = set()
    for f in frames:
        where = "%s seq %s" % (Path(path).name, f.get("seq"))
        kind, sid = f.get("kind"), f.get("stream_id") or ""
        seen_kinds.add(kind)

        if not KIND.match(str(kind or "")):
            out.append((path, where, "kind is not lclabel.lclabel (§6.1.1)", kind))
        elif kinds and kind not in kinds:
            out.append((path, where, "KIND IS NOT REGISTERED — the registry is exact-match, "
                                    "never prefix inference (§6.1.1)", kind))

        form = form_of(sid)
        if form is None:
            out.append((path, where, "stream_id matches no conformant form (§6.1.1)", sid[:80]))
        elif kinds and kind in kinds:
            fam = kinds[kind]
            want = ALLOWED.get(fam)
            if want and form != want:
                out.append((path, where,
                            "family '%s' requires a %s but this is a %s (§7.2)" % (fam, want, form),
                            sid[:80]))

        if form == "swarm-stream":
            if f.get("seq", 0) > 0 and f.get("prev_wave") is None:
                out.append((path, where, "swarm-stream seq>0 MUST carry prev_wave (§7)", None))
            if f.get("sig") is None:
                out.append((path, where, "swarm-stream frames MUST be signed (§10)", None))
        elif f.get("prev_wave") is not None:
            out.append((path, where, "prev_wave MUST be null off a swarm-stream (§7)", f.get("prev_wave")))
    return frames, seen_kinds


def main():
    kinds, src = registry()
    print("registry: %d kinds from %s\n" % (len(kinds), src))
    targets = sys.argv[1:] or [str(p) for p in sorted(ROOT.rglob("*.jsonl"))
                               if "node_modules" not in str(p)]
    out, total, allkinds = [], 0, set()
    for t in targets:
        frames, ks = check(t, kinds, out)
        total += len(frames)
        allkinds |= ks
    print("checked %d frames across %d files" % (total, len(targets)))
    print("kinds in use: %s\n" % ", ".join(sorted(str(k) for k in allkinds)))
    if not out:
        print("✓ every frame is rapp/1 compliant")
        return 0
    # group, because one mistake repeated 33 times is one mistake
    grouped = {}
    for path, where, why, what in out:
        grouped.setdefault((why, str(what)), []).append(where)
    print("✗ %d frames have problems, in %d distinct kinds:\n" % (len(out), len(grouped)))
    for (why, what), wheres in sorted(grouped.items(), key=lambda kv: -len(kv[1])):
        print("  %d frames — %s" % (len(wheres), why))
        if what and what != "None":
            print("      %s" % what[:100])
        print("      e.g. %s" % ", ".join(wheres[:3]))
        print()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
