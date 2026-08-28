#!/usr/bin/env python3
"""verify.py — prove the AINexus generation chain, stdlib only, spec-faithful to rapp/1.

    python3 frames/verify.py                       # frames/chain.jsonl (the app's generations)
    python3 frames/verify.py frames/worlds/*.jsonl # per-world frames (single-frame chains)

Hashing is the rapp/1 rule (copied from kody-w/rapp-1 rapp.py): H(space, v) = sha256(space + 0x0a + JCS(v)),
JCS per RFC 8785 over the I-JSON domain. payload_hash = H("rapp/1:particle", payload);
frame_hash = H("rapp/1:wave", frame minus frame_hash/sig). Chain: prev == predecessor payload_hash.
Also re-derives each frame's embedded html and checks html_sha256 — the negative must reproduce the app.
"""
import hashlib, json, sys, os, glob

def canonical(v):
    if v is None or isinstance(v, bool): return json.dumps(v)
    if isinstance(v, int):
        if abs(v) > 2**53 - 1: raise ValueError("int outside interoperable range")
        return json.dumps(v)
    if isinstance(v, float): raise ValueError("floats not allowed")
    if isinstance(v, str): return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list): return "[" + ",".join(canonical(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v.keys(), key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical(v[k]) for k in keys) + "}"
    raise ValueError(f"non-I-JSON value: {type(v)}")

def H(space, v): return hashlib.sha256(space.encode() + b"\x0a" + canonical(v).encode("utf-8")).hexdigest()

def verify(path):
    frames = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    prev, problems = None, []
    for f in frames:
        seq = f.get("seq")
        if H("rapp/1:particle", f["payload"]) != f["payload_hash"]: problems.append(f"seq {seq}: payload_hash mismatch")
        pre = {k: f[k] for k in f if k not in ("frame_hash", "sig")}
        if H("rapp/1:wave", pre) != f["frame_hash"]: problems.append(f"seq {seq}: frame_hash mismatch")
        html = f["payload"].get("html")
        if html is not None and hashlib.sha256(html.encode()).hexdigest() != f["payload"].get("html_sha256"):
            problems.append(f"seq {seq}: embedded html does not match html_sha256")
        if prev is None:
            if f.get("prev") is not None: problems.append(f"seq {seq}: genesis prev must be null")
        else:
            if f.get("prev") != prev["payload_hash"]: problems.append(f"seq {seq}: prev != predecessor payload_hash")
            if seq != prev["seq"] + 1: problems.append(f"seq {seq}: seq not +1")
        prev = f
    return frames, problems

def main(paths):
    rc = 0
    for path in paths:
        frames, problems = verify(path)
        if problems:
            rc = 1; print(f"FAIL {path}:", *problems, sep="\n  ")
        else:
            print(f"OK {path}: {len(frames)} frame(s), head {frames[-1]['frame_hash'][:16]}…" if frames else f"OK {path}: empty")
    return rc

if __name__ == "__main__":
    args = sys.argv[1:] or [os.path.join(os.path.dirname(__file__), "chain.jsonl")]
    sys.exit(main([p for a in args for p in (glob.glob(a) or [a])]))
