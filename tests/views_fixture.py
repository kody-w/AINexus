#!/usr/bin/env python3
"""views_fixture.py — a small, real views line for the tests.

A spine, a feed in the shape tools/dogg_stream.cjs writes, and frames sealed by tools/views_seal.py
itself. Nothing here imitates the sealer; it drives it, so a test that passes on this fixture passed
on the real seal path. It also writes the forgeries the tests throw at the line: a view whose bytes
changed, a history rewritten with valid hashes, and a spine tick that is not the spine's.

  python3 tests/views_fixture.py <out-dir>      # builds the fixture and prints a JSON map of it
"""
import datetime
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import rapp as R  # noqa: E402
import chainio  # noqa: E402
import views_seal as V  # noqa: E402

PLAYERS = ["wanderer", "greeter", "pilgrim", "watcher"]
SHOTS = ROOT / "recordings" / "latest"
T0 = datetime.datetime(2026, 9, 23, 12, 0, 0, tzinfo=datetime.timezone.utc)


def stamp(t):
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def add_tick(spine_dir, when):
    """Mint the next tick anchor on a fixture spine, exactly as the spine's own beat does."""
    chain = chainio.load_chain(spine_dir)
    head = chain[-1] if chain else None
    seq = head["seq"] + 1 if head else 0
    utc = stamp(when)
    frame = R.build_frame("tick.anchor", V.SPINE_STREAM, seq, utc,
                          {"tick": seq, "beat_utc": utc, "minted_by": "views fixture"},
                          prev=head["payload_hash"] if head else None)
    ok, step, why = R.verify_frame(frame, head=head, stream_id_of_record=V.SPINE_STREAM)
    assert ok, (step, why)
    chainio.append_frame(spine_dir, frame, V.SPINE_STREAM)
    return frame


def empty_manifest():
    return {"version": 2, "live": True, "stream": "DOGG", "recorded": "", "updated": "",
            "world": "index.html", "playbackFps": 4, "tickSeconds": 300, "frames": 0,
            "maxFrames": 2016, "droppedFrames": 0, "ticks": [],
            "players": [{"id": p, "label": "🤖 " + p, "shots": [], "doing": [], "epochs": []}
                        for p in PLAYERS]}


def add_capture(feed_dir, manifest, segment, when, shot, doing="wander", carry=()):
    """One tick of the feed, and the receipt tools/record_views.cjs would write for it. A player in
    `carry` produced no view this tick, so the stream carries its previous shot forward."""
    feed_dir = pathlib.Path(feed_dir)
    captured = stamp(when)
    tick_id = f"{segment}:0000"
    manifest["ticks"].append({"id": tick_id, "capturedAt": captured, "segment": segment})
    players = []
    for rec in manifest["players"]:
        pid = rec["id"]
        if pid in carry and rec["shots"]:
            rel = rec["shots"][-1]
        else:
            rel = f"segments/{segment}/{pid}/0000.webp"
            path = feed_dir / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((SHOTS / pid / f"{shot:04d}.webp").read_bytes())
        rec["shots"].append(rel)
        rec["doing"].append(doing)
        rec["epochs"].append("")
        players.append({"id": pid, "doing": doing, "file": rel,
                        "sees": [q for q in PLAYERS if q != pid]})
    manifest["frames"] = len(manifest["ticks"])
    manifest["recorded"] = manifest["ticks"][0]["capturedAt"]
    manifest["updated"] = captured
    (feed_dir / "manifest.json").write_text(json.dumps(manifest))
    world = (ROOT / "index.html").read_bytes()
    return {"schema": "ainexus/views-receipt/1", "world": "index.html",
            "world_sha256": hashlib.sha256(world).hexdigest(), "segment": segment,
            "tick_id": tick_id, "captured_utc": captured, "players": players}


def rehash(frame, **payload_changes):
    """The same frame with its payload edited and every hash recomputed: valid on its own, which is
    exactly the forgery only the chain's links can catch."""
    payload = json.loads(json.dumps(frame["payload"]))
    for dotted, value in payload_changes.items():
        obj = payload
        *path, last = dotted.split("__")
        for part in path:
            obj = obj[int(part)] if isinstance(obj, list) else obj[part]
        obj[int(last) if isinstance(obj, list) else last] = value
    return R.build_frame(frame["kind"], frame["stream_id"], frame["seq"], frame["utc"], payload,
                         prev=frame["prev"], prev_wave=frame["prev_wave"], sig=frame["sig"])


def build(out):
    """legacy tick (before the line) → seal t1 under spine tick 1 → seal t2 under spine tick 2,
    then an unsealable t3 and the forgeries."""
    out = pathlib.Path(out)
    spine, feed, chain = out / "spine", out / "live", out / "chain"
    for d in (spine, feed, chain):
        d.mkdir(parents=True, exist_ok=True)
    manifest = empty_manifest()
    add_tick(spine, T0)
    legacy = add_capture(feed, manifest, "2026-09-23T12-02-00.000Z-legacy00", T0 + datetime.timedelta(minutes=2), 0)
    add_tick(spine, T0 + datetime.timedelta(minutes=10))
    anchor1 = V.read_anchor(str(spine))
    first = add_capture(feed, manifest, "2026-09-23T12-12-00.000Z-sealed01", T0 + datetime.timedelta(minutes=12), 5)
    frame0 = V.seal(anchor1, first, feed, chain, feed_url="https://kody-w.github.io/AINexus/test/live/")
    (out / "HEAD-1.json").write_text((chain / "HEAD.json").read_text())
    (out / "manifest-2.json").write_text((feed / "manifest.json").read_text())
    add_tick(spine, T0 + datetime.timedelta(minutes=20))
    anchor2 = V.read_anchor(str(spine))
    second = add_capture(feed, manifest, "2026-09-23T12-23-00.000Z-sealed02", T0 + datetime.timedelta(minutes=23), 10)
    frame1 = V.seal(anchor2, second, feed, chain, feed_url="https://kody-w.github.io/AINexus/test/live/")

    forged = out / "forged"
    forged.mkdir(exist_ok=True)
    (forged / "chain-0.json").write_text(json.dumps(
        rehash(frame0, views__players__0__doing="rewritten afterwards"), indent=2) + "\n")
    tick2 = json.loads((spine / "2.json").read_text())
    other = R.build_frame(tick2["kind"], tick2["stream_id"], tick2["seq"], tick2["utc"],
                          dict(tick2["payload"], minted_by="somebody else's spine"), prev=tick2["prev"])
    (forged / "spine-2.json").write_text(json.dumps(other, indent=2) + "\n")

    # A capture after the last seal, made while the spine still stood on tick 2 — which can never be
    # sealed — plus the spine as it would read once tick 3 is minted.
    extra = out / "extra"
    extra.mkdir(exist_ok=True)
    published = (feed / "manifest.json").read_text()
    third = add_capture(feed, json.loads(published), "2026-09-23T12-26-00.000Z-unseal03",
                        T0 + datetime.timedelta(minutes=26), 20)
    (extra / "manifest-4.json").write_text((feed / "manifest.json").read_text())
    (feed / "manifest.json").write_text(published)
    at = stamp(T0 + datetime.timedelta(minutes=30))
    tick3 = R.build_frame("tick.anchor", V.SPINE_STREAM, 3, at,
                          {"tick": 3, "beat_utc": at, "minted_by": "views fixture"}, prev=tick2["payload_hash"])
    (extra / "spine-3.json").write_text(json.dumps(tick3, indent=2) + "\n")
    head = json.loads((spine / "HEAD.json").read_text())
    head.update({"count": 4, "head_frame": tick3["frame_hash"], "updated": at})
    (extra / "spine-HEAD-4.json").write_text(json.dumps(head, indent=2) + "\n")
    return {"root": str(out), "spine": str(spine), "feed": str(feed), "chain": str(chain),
            "ticks": [legacy["tick_id"], first["tick_id"], second["tick_id"], third["tick_id"]],
            "frames": [frame0["frame_hash"], frame1["frame_hash"]],
            "anchors": [anchor1["tick"], anchor2["tick"]],
            "first": first, "second": second, "third": third, "players": PLAYERS}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tests/views_fixture.py <out-dir>")
    print(json.dumps(build(sys.argv[1])))
