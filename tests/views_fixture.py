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
import shutil
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


PATROL_ASKED = [{"do": "walk", "dir": "forward", "ms": 1200.9}, {"do": "look", "dx": 400}, {"do": "wait", "ms": 500}]
PATROL = [{"do": "walk", "dir": "forward", "ms": 1200}, {"do": "look", "dx": 400, "dy": 0}, {"do": "wait", "ms": 500}]

# Two players think on the second tick, one rests, and one is still scripted: every state a live
# frame can hold. The evidence is in the shape tools/minds.cjs writes (tests/minds.cjs holds the two
# to each other through the real capture path).
MINDS = {
    "wanderer": {"asked": "claude-sonnet-5", "answered": "claude-sonnet-5", "multiplier_x100": 100,
                 "calls": [["world_look", {"dx": 110, "dy": 0, "why": "the greeter is off to my right"}, False, "ok"],
                           # U+2028 and U+0085 are what a model may write, and what must never reach a frame raw
                           ["world_say", {"text": "Hello,\u2028greeter! 👋", "why": "someone is here"}, False, "0"],
                           ["world_tell", {"to": "nobody", "text": "psst, over here", "why": "a private\x85word"}, True,
                            "failed: tell did not happen"],
                           ["world_routine", {"steps": PATROL_ASKED, "why": "patrol until I think again"}, False,
                            "routine set: walk, look, wait (3 steps, looped until you next think)"]],
                 "words": "", "voiced": None, "saw": 3, "tokens": [1480, 61], "ms": 2210},
    "pilgrim": {"asked": "gpt-5-mini", "answered": "gpt-5-mini-2026-08-07", "multiplier_x100": 0,
                "calls": [["world_aim", {"portal": "Nowhere", "why": "I want to see where it leads"}, True,
                           "failed: aim did not happen"],
                          ["world_walk", {"dir": "forward", "ms": 600, "why": "closer to the portals"}, False, "ok"]],
                "words": "Heading for the portals.", "voiced": "Heading for the portals.", "saw": 8,
                "tokens": [1302, 40], "ms": 1675},
}
RESTING = {"greeter": "resting between thoughts (thinks every 3 ticks)"}
# the world's own routines, as the sealer knows them (tests/minds.cjs holds them equal to ai/playout.js)
DEFAULTS = V.DEFAULT_ROUTINES
# the hub's one clock, which every body in it keeps (ai/playout.js PLACE_CLOCK)
PLACE_CLOCK = "America/New_York"
LATER_POSES = {"wanderer": {"x_cm": -1600, "y_cm": 200, "z_cm": 900, "yaw_mrad": -1200, "pitch_mrad": 0},
               "pilgrim": {"x_cm": 300, "y_cm": 200, "z_cm": 1100, "yaw_mrad": 400, "pitch_mrad": 0},
               "greeter": {"x_cm": 0, "y_cm": 200, "z_cm": 0, "yaw_mrad": 700, "pitch_mrad": 0}}
POSES = {"wanderer": {"x_cm": 412, "y_cm": 160, "z_cm": -233, "yaw_mrad": 1571, "pitch_mrad": 0},
         "pilgrim": {"x_cm": -80, "y_cm": 160, "z_cm": 905, "yaw_mrad": -3142, "pitch_mrad": -120},
         "greeter": {"x_cm": 0, "y_cm": 160, "z_cm": 0, "yaw_mrad": 0, "pitch_mrad": 0}}


def exchange_for(pid, spec, picture):
    persona = f"You are {pid}. You are an AI player in a shared 3D world of portals."
    user = [{"type": "text", "text": 'PERCEPTS: {"tick":2,"me":{"x":4,"z":-2}}'}]
    if picture:
        user.append({"type": "image_url", "image_url": {"url": "saw.webp", "sha256": picture}})
    calls = [{"tool": tool, "args": args, "failed": failed, "result": result}
             for tool, args, failed, result in spec["calls"]]
    tool_calls = [{"id": f"call_{i}", "type": "function",
                   "function": {"name": c["tool"], "arguments": json.dumps(c["args"])}} for i, c in enumerate(calls)]
    return {"schema": "ainexus/mind-exchange/1", "player": pid, "provider": "github-copilot",
            "asked": spec["asked"], "multiplier_x100": spec["multiplier_x100"],
            "rounds": [{"status": 200, "ms": spec["ms"],
                        "request": {"model": spec["asked"], "messages": [{"role": "system", "content": persona},
                                                                         {"role": "user", "content": user}],
                                    "tools": [], "max_tokens": 600, "stream": False},
                        "response": {"model": spec["answered"],
                                     "message": {"role": "assistant", "content": spec["words"],
                                                 "tool_calls": tool_calls},
                                     "finish_reason": "tool_calls",
                                     "usage": {"prompt_tokens": spec["tokens"][0],
                                               "completion_tokens": spec["tokens"][1]},
                                     "error": None}}],
            "calls": calls, "words": spec["words"], "voiced": spec["voiced"], "note": ""}


def add_minds(feed_dir, receipt, minds=None, resting=None, poses=None, routines=None, clock=PLACE_CLOCK):
    """Give a capture's players the minds tools/record_views.cjs gives them: evidence files beside
    the view, and a receipt that says only where they are and which routine ran."""
    feed_dir = pathlib.Path(feed_dir)
    segment = receipt["segment"]
    for q in receipt["players"]:
        pid = q["id"]
        spec = (MINDS if minds is None else minds).get(pid)
        if spec:
            where = f"segments/{segment}/{pid}/"
            picture = None
            if spec.get("saw") is not None:
                shown = (SHOTS / pid / f"{spec['saw']:04d}.webp").read_bytes()
                (feed_dir / where / "saw.webp").write_bytes(shown)
                picture = hashlib.sha256(shown).hexdigest()
            (feed_dir / where / "mind.json").write_text(
                json.dumps(exchange_for(pid, spec, picture), indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            q["mind"] = {"kind": "model", "exchange": where + "mind.json"}
            if picture:
                q["mind"]["saw"] = where + "saw.webp"
        elif pid in (RESTING if resting is None else resting):
            q["mind"] = {"kind": "rest", "why": (RESTING if resting is None else resting)[pid]}
        if pid in (POSES if poses is None else poses):
            q["at"] = dict((POSES if poses is None else poses)[pid])
        ran = ({"wanderer": {"set_at": "this"}, "greeter": {"set_at": None, "by": "default", "steps": DEFAULTS["greeter"]},
                "pilgrim": {"set_at": None, "by": "default", "steps": DEFAULTS["pilgrim"]}}
               if routines is None else routines)
        if pid in ran and "mind" in q:
            q["routine"] = dict(ran[pid])
    if clock and any("mind" in q for q in receipt["players"]):
        receipt["clock"] = clock
    return receipt


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
    add_minds(feed, second)
    frame1 = V.seal(anchor2, second, feed, chain, feed_url="https://kody-w.github.io/AINexus/test/live/")

    forged = out / "forged"
    forged.mkdir(exist_ok=True)
    (forged / "chain-0.json").write_text(json.dumps(
        rehash(frame0, views__players__0__doing="rewritten afterwards"), indent=2) + "\n")
    # The newest frame re-sealed with words its mind never said. Every hash and link is right, so
    # only the evidence can catch it.
    said = rehash(frame1, views__players__0__mind__said="I was never here.")
    (forged / "chain-1-said.json").write_text(json.dumps(said, indent=2) + "\n")
    head_said = json.loads((chain / "HEAD.json").read_text())
    head_said["head_frame"] = said["frame_hash"]
    (forged / "HEAD-said.json").write_text(json.dumps(head_said, indent=2) + "\n")
    # ...and with a routine the pilgrim's thought never set, carried by its body in the model's name
    k = next(n for n, q in enumerate(frame1["payload"]["views"]["players"]) if q["id"] == "pilgrim")
    pilgrim = frame1["payload"]["views"]["players"][k]
    claimed = rehash(frame1, **{f"views__players__{k}__mind__routine_set": PATROL,
                                f"views__players__{k}__routine": {"steps": PATROL, "set_at": frame1["payload"]["tick"],
                                                                  "by": pilgrim["mind"]["model"]}})
    (forged / "chain-1-routine.json").write_text(json.dumps(claimed, indent=2) + "\n")
    head_claimed = dict(head_said, head_frame=claimed["frame_hash"])
    (forged / "HEAD-routine.json").write_text(json.dumps(head_claimed, indent=2) + "\n")
    # ...and the claim alone, its body still on the world's default: only the thought's key set shows it
    bare = rehash(frame1, **{f"views__players__{k}__mind__routine_set": PATROL})
    (forged / "chain-1-routine-only.json").write_text(json.dumps(bare, indent=2) + "\n")
    (forged / "HEAD-routine-only.json").write_text(json.dumps(dict(head_said, head_frame=bare["frame_hash"]), indent=2) + "\n")
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

    # The next minded frame, which the line has not received yet: sealed on copies of the chain and
    # the spine (with tick 3 minted), from a capture made after tick 3. Its wanderer rests and runs
    # the routine its thought on tick 2 set, from somewhere new; the viewer tests deliver it while a
    # page is open and watch each body walk to meet its twin.
    later = out / "later"
    later.mkdir(exist_ok=True)
    shutil.copytree(spine, later / "spine")
    shutil.copytree(chain, later / "chain")
    add_tick(later / "spine", T0 + datetime.timedelta(minutes=30))
    fourth = add_capture(feed, json.loads(published), "2026-09-23T12-31-00.000Z-minded04",
                         T0 + datetime.timedelta(minutes=31), 25)
    add_minds(feed, fourth, minds={"pilgrim": MINDS["pilgrim"]},
              resting={"wanderer": "resting between thoughts (thinks every 3 ticks)", "greeter": "resting"},
              poses=LATER_POSES,
              routines={"wanderer": {"set_at": 2}, "greeter": {"set_at": None, "steps": DEFAULTS["greeter"]},
                        "pilgrim": {"set_at": None, "steps": DEFAULTS["pilgrim"]}})
    frame2 = V.seal(V.read_anchor(str(later / "spine")), fourth, feed, later / "chain",
                    feed_url="https://kody-w.github.io/AINexus/test/live/")
    (later / "chain-2.json").write_text(json.dumps(frame2, indent=2) + "\n")
    (later / "HEAD-3.json").write_text((later / "chain" / "HEAD.json").read_text())
    (later / "manifest-5.json").write_text((feed / "manifest.json").read_text())
    (feed / "manifest.json").write_text(published)
    return {"root": str(out), "spine": str(spine), "feed": str(feed), "chain": str(chain),
            "ticks": [legacy["tick_id"], first["tick_id"], second["tick_id"], third["tick_id"]],
            "frames": [frame0["frame_hash"], frame1["frame_hash"]],
            "anchors": [anchor1["tick"], anchor2["tick"]],
            "first": first, "second": second, "third": third, "fourth": fourth, "players": PLAYERS,
            "minds": {q["id"]: q["mind"] for q in frame1["payload"]["views"]["players"] if "mind" in q}}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tests/views_fixture.py <out-dir>")
    print(json.dumps(build(sys.argv[1])))
