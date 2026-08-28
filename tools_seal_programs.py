#!/usr/bin/env python3
"""seal_programs.py — put the bytecode on a chain we own.

A tower that merely SHOWS a program's sha256 tells you what it loaded, not whether that is
what was published. So every program is sealed into an append-only rapp/1 chain in this
repo (ai/programs/PROGRAMS.chain.jsonl): one frame per publication, carrying the program's
name, its sha256 and its verb set. The tower fetches the chain, walks it, and refuses any
program whose bytes do not match the newest frame for that name — trust the chain, not the file.

    python3 tools_seal_programs.py            # seal any program whose bytes changed
"""
import hashlib, json, pathlib, sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path.home() / "Documents/GitHub/rapp-1"))
import rapp

ROOT = pathlib.Path(__file__).resolve().parent
PROGS = ROOT / "ai" / "programs"
CHAIN = PROGS / "PROGRAMS.chain.jsonl"


def now():
    n = datetime.now(timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def main():
    rid = json.loads((ROOT / "rappid.json").read_text())["rappid"]
    stream = rid + ":programs"
    frames = [json.loads(l) for l in CHAIN.read_text().splitlines() if l.strip()] if CHAIN.exists() else []
    head = frames[-1] if frames else None
    latest = {}
    for f in frames:
        latest[f["payload"]["program"]] = f["payload"]["sha256"]

    sealed = 0
    for p in sorted(PROGS.glob("*.json")):
        text = p.read_text()
        digest = hashlib.sha256(text.encode()).hexdigest()
        if latest.get(p.stem) == digest:
            continue
        doc = json.loads(text)
        f = rapp.build_frame("body.pulse", stream, (head["seq"] + 1) if head else 0, now(), {
            "event": "program.publish",
            "program": p.stem,
            "path": f"ai/programs/{p.name}",
            "sha256": digest,
            "bytes": len(text),
            "verbs": sorted({s.get("do") for s in doc.get("steps", []) if s.get("do")}),
            "loop": bool(doc.get("loop")),
            "persona": doc.get("persona", "")[:200],
        }, prev=head["payload_hash"] if head else None)
        ok, step, why = rapp.verify_frame(f, head=head)
        assert ok, (p.name, step, why)
        frames.append(f); head = f; sealed += 1
        print(f"sealed {p.stem} {digest[:16]}…")

    CHAIN.write_text("".join(json.dumps(f) + "\n" for f in frames))
    prev = None
    for f in frames:
        ok, step, why = rapp.verify_frame(f, head=prev)
        assert ok, (f["seq"], step, why)
        prev = f
    print(f"chain: {len(frames)} frames, {sealed} newly sealed, walks clean")


if __name__ == "__main__":
    main()
