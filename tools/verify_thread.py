#!/usr/bin/env python3
"""CI oracle: re-verify EVERY frame chain in this repo (any dir with a HEAD.json).
Chains may store frames as flat <seq>.json files, sealed epoch bundles, or both —
tools/chainio.py is the single reader for that layout."""
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import rapp as R
import chainio
root = pathlib.Path(__file__).parent.parent
fail = False
for headf in sorted(root.glob("*/HEAD.json")):
    d = headf.parent
    meta = json.loads(headf.read_text())
    try:
        frames = chainio.load_chain(d)
    except Exception as ex:
        print(f"FAIL {d.name}: storage error: {ex}"); fail = True; continue
    head = None
    for f in frames:
        ok, step, why = R.verify_frame(f, head=head, stream_id_of_record=meta["stream_id"])
        if not ok:
            print(f"FAIL {d.name}/{f.get('seq')}: {step}: {why}"); fail = True; break
        head = f
    else:
        if head is None:
            print(f"FAIL {d.name}: empty chain"); fail = True; continue
        assert head["frame_hash"] == meta["head_frame"], f"{d.name} HEAD mismatch"
        sealed = meta.get("sealed_epochs", 0)
        note = f" ({sealed} sealed epoch(s))" if sealed else ""
        print(f"OK: {d.name} — {meta['count']} frames verify on {meta['stream_id'][:44]}…{note}")
sys.exit(1 if fail else 0)
