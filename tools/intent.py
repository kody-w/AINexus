#!/usr/bin/env python3
"""intent.py — the charter that drives every mind working on AINexus, as a rapp/1 stream.

intent:@kody-w/ainexus holds what this world is meant to be, in Kody's own words, and the rules
that the assistant (in any session on this repo) and the heartbeat's world mind (on every tick)
hold their work to. It is a dogg/0 chain in intent/, so the spine's own oracle verifies it with
every other chain here (tools/verify_thread.py). The design changes only by a successor frame that
quotes the words that changed it, so a drift shows up as a diff between two frames, never quietly.

  python3 tools/intent.py show               # the newest charter, as a mind should read it
  python3 tools/intent.py json               # its payload, to hand to a mind
  python3 tools/intent.py verify             # the chain, its shape, and every rule's named checks
  python3 tools/intent.py amend PAYLOAD.json # append a successor frame (it must say why, in quotes)

A rule marked held names the checks that hold it, by file and by text. verify fails when one of
those checks no longer exists, so a rule cannot go on claiming a test nobody runs any more.
"""
import argparse
import json
import pathlib
import re
import sys

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import rapp as R  # noqa: E402
import chainio  # noqa: E402
import views_seal as V  # noqa: E402

STREAM = "intent:@kody-w/ainexus"
KIND = "intent.charter"
CHAIN = ROOT / "intent"
ID = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
STATUS = {"held", "planned", "broken"}
PLAN_STATUS = {"next", "planned", "done", "dropped"}
KEYS = {"about", "owner", "binds", "amend", "tick", "tick_frame", "canon", "standing", "never", "plan"}


def text(x, empty=False):
    return isinstance(x, str) and (empty or bool(x.strip()))


def quotes(x):
    return isinstance(x, list) and len(x) >= 1 and all(text(q) for q in x)


def problems(p, seq, files=False, root=ROOT):
    """Everything a charter must be. With `files`, every check a held rule names must exist."""
    if not isinstance(p, dict):
        return ["the payload is not an object"]
    want = KEYS | ({"amended_because"} if seq > 0 else set())
    if set(p) != want:
        return [f"the payload is not {sorted(want)}"]
    out = []
    for k in ("about", "owner", "amend"):
        if not text(p[k]):
            out.append(f"{k} is not a sentence")
    if not (isinstance(p["binds"], list) and p["binds"] and all(text(b) for b in p["binds"])):
        out.append("binds is not a list of who and what it binds")
    if not (V.isint(p["tick"]) and p["tick"] >= 0 and text(p["tick_frame"]) and V.HEX64.fullmatch(p["tick_frame"])):
        out.append("the charter is not anchored to a spine tick")
    if seq > 0:
        why = p["amended_because"]
        if not (isinstance(why, dict) and set(why) == {"what", "said"} and text(why["what"]) and quotes(why["said"])):
            out.append("an amendment does not say what changed and quote the words that changed it")
    ids = set()

    def entries(name, required, optional=frozenset()):
        items = p[name]
        if not (isinstance(items, list) and items):
            out.append(f"{name} is not a list")
            return []
        good = []
        for e in items:
            if not (isinstance(e, dict) and required <= set(e) <= required | optional and text(e.get("id"))
                    and ID.fullmatch(e["id"])):
                out.append(f"{name}: an entry is not {sorted(required)}")
                continue
            if e["id"] in ids:
                out.append(f"{name}: {e['id']} appears twice")
            ids.add(e["id"])
            good.append(e)
        return good

    for c in entries("canon", {"id", "rule", "said", "status"}, frozenset({"held_by", "note"})):
        if not (text(c["rule"]) and quotes(c["said"])):
            out.append(f"canon {c['id']}: a rule without Kody's words for it is not canon")
        if c["status"] not in STATUS:
            out.append(f"canon {c['id']}: status is not one of {sorted(STATUS)}")
        held_by = c.get("held_by", [])
        if c["status"] == "held" and not held_by:
            out.append(f"canon {c['id']}: a rule marked held names no check that holds it")
        for h in held_by if isinstance(held_by, list) else [None]:
            if not (isinstance(h, dict) and set(h) == {"file", "check"} and text(h["file"]) and text(h["check"])
                    and not h["file"].startswith("/") and ".." not in h["file"].split("/")):
                out.append(f"canon {c['id']}: held_by is not a list of {{file, check}} in this repo")
                continue
            if files:
                path = root / h["file"]
                if not path.is_file() or h["check"] not in path.read_text(encoding="utf-8"):
                    out.append(f"canon {c['id']}: it names a check that {h['file']} does not have: {h['check']!r}")
        if "note" in c and not text(c["note"]):
            out.append(f"canon {c['id']}: note is empty")
    for s in entries("standing", {"id", "rule", "said"}):
        if not (text(s["rule"]) and quotes(s["said"])):
            out.append(f"standing {s['id']}: a standing rule quotes Kody")
    for n in entries("never", {"id", "rule", "because"}):
        if not (text(n["rule"]) and text(n["because"])):
            out.append(f"never {n['id']}: a never says what and why")
    canon = {c["id"] for c in p["canon"] if isinstance(c, dict)} if isinstance(p["canon"], list) else set()
    steps = entries("plan", {"step", "id", "what", "status", "serves"})
    for i, s in enumerate(steps):
        if s["step"] != i or s["status"] not in PLAN_STATUS or not text(s["what"]):
            out.append(f"plan {s['id']}: steps are numbered in order, say what they do, and have a status")
        if not (isinstance(s["serves"], list) and s["serves"] and set(s["serves"]) <= canon):
            out.append(f"plan {s['id']}: it serves no rule of the canon")
    return out


def chain(where=CHAIN):
    return chainio.load_chain(where) if (pathlib.Path(where) / "HEAD.json").exists() else []


def newest(where=CHAIN):
    frames = chain(where)
    return frames[-1] if frames else None


def verify(where=CHAIN, root=ROOT):
    """The problems with the charter: the chain under the spine's own verifier, and every frame's
    shape; the newest frame's named checks must also exist."""
    frames = chain(where)
    if not frames:
        return ["there is no charter"]
    out, head = [], None
    for f in frames:
        ok, step, why = R.verify_frame(f, head=head, stream_id_of_record=STREAM)
        if not ok:
            return out + [f"frame {f.get('seq')}: step {step}: {why}"]
        if f["kind"] != KIND:
            out.append(f"frame {f['seq']}: kind {f['kind']!r} is not {KIND}")
        if head is not None and f["payload"].get("tick", -1) < head["payload"].get("tick", -1):
            out.append(f"frame {f['seq']}: anchored before the frame it amends")
        out += [f"frame {f['seq']}: {x}" for x in problems(f["payload"], f["seq"], files=f is frames[-1], root=root)]
        head = f
    meta = json.loads((pathlib.Path(where) / "HEAD.json").read_text())
    if meta.get("head_frame") != head["frame_hash"] or meta.get("stream_id") != STREAM:
        out.append("HEAD.json does not name the newest charter")
    return out


def amend(payload, where=CHAIN, spine=V.SPINE_URL, root=ROOT):
    """Append the next charter. The anchor is read here, never taken from the payload."""
    frames = chain(where)
    head = frames[-1] if frames else None
    anchor = V.read_anchor(spine)
    payload = dict(payload, tick=anchor["tick"], tick_frame=anchor["tick_frame"])
    seq = head["seq"] + 1 if head else 0
    bad = problems(payload, seq, files=True, root=root)
    if bad:
        raise V.Refusal("refusing a charter verify would refuse: " + "; ".join(bad))
    now = V.utc_now()
    if head is not None and now < head["utc"]:
        now = head["utc"]
    frame = R.build_frame(KIND, STREAM, seq, now, payload, prev=head["payload_hash"] if head else None)
    ok, step, why = R.verify_frame(frame, head=head, stream_id_of_record=STREAM)
    if not ok:
        raise V.Refusal(f"refusing an invalid frame: step {step}: {why}")
    pathlib.Path(where).mkdir(parents=True, exist_ok=True)
    chainio.append_frame(where, frame, STREAM)
    return frame


def show(frame):
    p = frame["payload"]
    mark = {"held": "✓", "planned": "○", "broken": "✗"}
    lines = [f"AINexus intent · frame {frame['seq']} of {STREAM} · {frame['frame_hash'][:16]}… "
             f"(anchored to spine tick {p['tick']})", "", p["about"], "", "CANON: hold every change to these"]
    for c in p["canon"]:
        status = "" if c["status"] == "held" else f" [{c['status']}]"
        lines.append(f"  {mark[c['status']]} {c['id']}{status}: {c['rule']}")
        lines += [f"      “{q}”" for q in c["said"]]
        if c.get("note"):
            lines.append(f"      note: {c['note']}")
    lines += ["", "STANDING: from Kody, across this estate"]
    lines += [f"  · {s['id']}: {s['rule']}" for s in p["standing"]]
    lines += ["", "NEVER: each one is a drift that already happened"]
    lines += [f"  ✗ {n['id']}: {n['rule']} ({n['because']})" for n in p["never"]]
    lines += ["", "PLAN"]
    lines += [f"  {s['step']} [{s['status']}] {s['id']}: {s['what']}" for s in p["plan"]]
    lines += ["", "AMEND: " + p["amend"]]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("show")
    sub.add_parser("json")
    sub.add_parser("verify")
    a = sub.add_parser("amend")
    a.add_argument("payload")
    a.add_argument("--spine", default=V.SPINE_URL)
    args = ap.parse_args(argv)
    if args.cmd == "amend":
        try:
            frame = amend(json.loads(pathlib.Path(args.payload).read_text()), spine=args.spine)
        except V.Refusal as ex:
            print(f"✗ {ex}")
            return 1
        print(f"charter frame {frame['seq']} · {frame['frame_hash'][:16]}… at spine tick {frame['payload']['tick']}")
        return 0
    if args.cmd == "verify":
        found = verify()
        for x in found:
            print("✗ " + x)
        if not found:
            print(f"✓ the charter verifies: {len(chain())} frame(s) on {STREAM}, every held rule's checks exist")
        return 1 if found else 0
    frame = newest()
    if frame is None:
        print("there is no charter")
        return 1
    print(json.dumps(frame["payload"], indent=1, ensure_ascii=False) if args.cmd == "json" else show(frame))
    return 0


if __name__ == "__main__":
    sys.exit(main())
