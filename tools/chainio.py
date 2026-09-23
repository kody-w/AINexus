#!/usr/bin/env python3
"""Chain storage for high-frequency streams: sealed epoch bundles + a flat tail.

A chain directory holds:
  HEAD.json                    {count, stream_id, head_frame, updated,
                                epoch_size: E, sealed_epochs: K}
  epochs/<k>.jsonl             frames k*E .. (k+1)*E-1, one per line, SEALED —
                               written once, never modified
  <seq>.json                   the flat tail: every frame >= K*E

Why: a beat every 10 minutes is ~144 files/day; a flat directory passes 1,000 entries
inside a week (web UIs truncate, git slows) and re-verifying file-by-file grows
without bound. Epochs keep the directory bounded (tail stays between E and 2E files)
while every byte of history remains in the repo and every frame stays addressable:
recent frames at <seq>.json, older frames inside their epoch bundle at line seq - k*E.

Reader contract (also in PROTOCOL.md): read HEAD.json; frames 0..K*E-1 come from the
K bundles in order; frames K*E..count-1 from flat files. Chains below 2E frames have
no bundles at all — old readers keep working until a chain actually grows.
"""
import json, pathlib, datetime

EPOCH_SIZE = 288          # ~2 days at a 10-minute cadence; tail holds 288..576 files

def _utc():
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"

def load_chain(d):
    d = pathlib.Path(d)
    if not (d / "HEAD.json").exists():
        return []
    meta = json.loads((d / "HEAD.json").read_text())
    count, sealed = meta["count"], meta.get("sealed_epochs", 0)
    E = meta.get("epoch_size", EPOCH_SIZE)
    frames = []
    for k in range(sealed):
        lines = (d / "epochs" / f"{k}.jsonl").read_text().splitlines()
        frames += [json.loads(l) for l in lines if l.strip()]
    for i in range(sealed * E, count):
        frames.append(json.loads((d / f"{i}.json").read_text()))
    if len(frames) != count:
        raise ValueError(f"{d.name}: HEAD says {count} frames, storage holds {len(frames)}")
    return frames

def append_frame(d, frame, stream_id):
    """Write one frame + HEAD, then compact if the tail has outgrown its window."""
    d = pathlib.Path(d)
    d.mkdir(exist_ok=True)
    meta = json.loads((d / "HEAD.json").read_text()) if (d / "HEAD.json").exists() else \
        {"count": 0, "sealed_epochs": 0, "epoch_size": EPOCH_SIZE}
    (d / f"{frame['seq']}.json").write_text(
        json.dumps(frame, indent=2, ensure_ascii=False) + "\n")
    meta.update({"count": frame["seq"] + 1, "stream_id": stream_id,
                 "head_frame": frame["frame_hash"], "updated": _utc()})
    meta.setdefault("epoch_size", EPOCH_SIZE)
    meta.setdefault("sealed_epochs", 0)
    (d / "HEAD.json").write_text(json.dumps(meta, indent=2) + "\n")
    compact(d)

def compact(d):
    """Seal full epochs whenever the flat tail exceeds 2*E files. Sealing is atomic per
    epoch: bundle written first, flat files removed after, HEAD updated last — a crash
    mid-seal leaves duplicates (harmless: bundle wins on next run), never a gap."""
    d = pathlib.Path(d)
    if not (d / "HEAD.json").exists():
        return
    meta = json.loads((d / "HEAD.json").read_text())
    E = meta.get("epoch_size", EPOCH_SIZE)
    sealed = meta.get("sealed_epochs", 0)
    changed = False
    while meta["count"] - sealed * E >= 2 * E:
        k = sealed
        lines = []
        for i in range(k * E, (k + 1) * E):
            lines.append(json.dumps(json.loads((d / f"{i}.json").read_text()),
                                    ensure_ascii=False, separators=(",", ":")))
        (d / "epochs").mkdir(exist_ok=True)
        (d / "epochs" / f"{k}.jsonl").write_text("\n".join(lines) + "\n")
        for i in range(k * E, (k + 1) * E):
            (d / f"{i}.json").unlink()
        sealed += 1
        changed = True
    if changed:
        meta["sealed_epochs"] = sealed
        (d / "HEAD.json").write_text(json.dumps(meta, indent=2) + "\n")
