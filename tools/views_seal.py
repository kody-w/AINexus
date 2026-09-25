#!/usr/bin/env python3
"""views_seal.py — what the AI players saw, sealed as a DOGG dimension.

The public feed on the `dogg-live` branch is bytes: every tick, one webp per AI player, each taken
from that player's own page. Bytes are not a record. This turns a capture into one: a native dogg/0
frame on the `views:@kody-w/ainexus` stream, anchored to the global tick spine (kody-w/dogg) and
carrying the SHA-256 of every view it names.

The chain lives on main under views/ because the stream id alone names the mirror (dogg/0 §3):
raw.githubusercontent.com/kody-w/ainexus/main/views/. The images stay on the rolling feed. A frame
outlives the bytes it names, and while the feed still holds them, anyone can re-hash them.

One frame per spine tick, the rule every federated node keeps (dogg-sky, dogg-markets). The spine
is read BEFORE the capture, so a frame never claims a view from before its own tick, and `verify`
holds every frame to that against the spine's own timestamps. A capture made while the spine has
not advanced since the last seal stays in the feed, unsealed, and the viewer says so rather than
pretending otherwise.

  python3 tools/views_seal.py anchor --out anchor.json            # exit 10: this tick is sealed
  python3 tools/views_seal.py seal   --anchor anchor.json --receipt receipt.json --feed-dir DIR
  python3 tools/views_seal.py verify [--chain URL|DIR] [--spine URL|DIR] [--feed URL|DIR]

rapp.py, chainio.py and verify_thread.py beside this file are the spine's own reference tools,
vendored unmodified from kody-w/dogg, so a frame written here verifies under the same code every
other node is checked by.
"""
import argparse
import datetime
import hashlib
import json
import math
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

TOOLS = pathlib.Path(__file__).resolve().parent
ROOT = TOOLS.parent
sys.path.insert(0, str(TOOLS))
import rapp as R  # noqa: E402
import chainio  # noqa: E402

STREAM = "views:@kody-w/ainexus"
KIND = "views.snapshot"
SPINE_STREAM = "tick:@kody-w/global"
SPINE_REPO = "kody-w/dogg"
SPINE_URL = "https://raw.githubusercontent.com/kody-w/dogg/main/ticks/"
FEED_URL = "https://raw.githubusercontent.com/kody-w/AINexus/dogg-live/recordings/live/"
CHAIN_DIR = ROOT / "views"
TIMEOUT = 20
MAX_PLAYERS = 32

NOT_DUE = 10            # exit code: the spine tick this would anchor to is already sealed

HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
PLAYER_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SEGMENT = re.compile(r"^[0-9A-Za-z._-]{1,96}$")
WORLD = re.compile(r"^[0-9A-Za-z._-]{1,128}\.html$")
UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

ABOUT = ("What AI bodies see. Each frame is one spine tick in the AINexus portal world: every AI "
         "player's own first-person view, taken from its own page, content-addressed by SHA-256 "
         "and anchored to the kody-w/dogg tick spine. The frame is the record; the bytes live on "
         "the rolling dogg-live feed, and any copy of a view proves itself against the hash here.")


class Refusal(Exception):
    """Something would have to be believed rather than checked. Nothing is written."""


def utc_now():
    n = datetime.datetime.now(datetime.timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


def parse_utc(s):
    return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=datetime.timezone.utc)


def sha256(b):
    return hashlib.sha256(b).hexdigest()


# ── reading a chain wherever it is ───────────────────────────────────────────
class Chain:
    """A dogg/0 chain (HEAD.json + sealed epochs/<k>.jsonl + flat tail), from a directory or over
    HTTPS. Readers use HEAD, never directory listings (PROTOCOL.md, storage layout)."""

    def __init__(self, where):
        self.where = str(where)
        self.remote = self.where.startswith(("https://", "http://"))
        if self.remote and not self.where.endswith("/"):
            self.where += "/"
        self._meta = None
        self._bundles = {}

    def read(self, rel, fresh=False):
        if not self.remote:
            return (pathlib.Path(self.where) / rel).read_bytes()
        url = self.where + rel
        if fresh:               # raw.githubusercontent.com caches for minutes; HEAD must be now
            url += ("&" if "?" in url else "?") + "_=" + str(time.time_ns())
        req = urllib.request.Request(url, headers={"User-Agent": "ainexus-views-seal"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.read()

    def head(self, fresh=False):
        if self._meta is None or fresh:
            self._meta = json.loads(self.read("HEAD.json", fresh=True).decode("utf-8"))
        return self._meta

    def frame(self, seq):
        meta = self.head()
        count = meta.get("count")
        if not isinstance(count, int) or not 0 <= seq < count:
            raise LookupError(f"no frame {seq} on a chain of {count}")
        E = meta.get("epoch_size", chainio.EPOCH_SIZE)
        K = meta.get("sealed_epochs", 0)
        if seq >= K * E:
            return json.loads(self.read(f"{seq}.json").decode("utf-8"))
        k = seq // E
        if k not in self._bundles:
            text = self.read(f"epochs/{k}.jsonl").decode("utf-8")
            self._bundles[k] = [json.loads(line) for line in text.splitlines() if line.strip()]
        return self._bundles[k][seq - k * E]

    def frames(self):
        if not self.remote:
            return chainio.load_chain(self.where)
        return [self.frame(i) for i in range(self.head()["count"])]


# ── one frame on its own ─────────────────────────────────────────────────────
def self_verify(frame, stream):
    """Every rapp/1 consumer check a frame can pass alone (§7.5 steps 1-3 and 5). The link to its
    predecessor is the one thing a lone frame cannot show, so the stand-in head is built from the
    frame's own claims — and a non-genesis frame that names no parent is refused outright."""
    seq = frame.get("seq") if isinstance(frame, dict) else None
    if not isinstance(seq, int) or isinstance(seq, bool):
        return False, "1", "seq not an integer"
    if seq == 0:
        return R.verify_frame(frame, head=None, stream_id_of_record=stream)
    if not (isinstance(frame.get("prev"), str) and HEX64.match(frame["prev"])):
        return False, "4", "a frame after genesis must name its parent"
    stand_in = {"seq": seq - 1, "payload_hash": frame["prev"], "utc": "", "frame_hash": None}
    return R.verify_frame(frame, head=stand_in, stream_id_of_record=stream)


def check_tick(frame, tick, expect_hash=None):
    """A spine tick frame is what it says it is, and is the tick it is asked to be."""
    ok, step, why = self_verify(frame, SPINE_STREAM)
    if not ok:
        raise Refusal(f"spine tick {tick} does not verify: step {step}: {why}")
    if frame["kind"] != "tick.anchor" or frame["seq"] != tick or frame["payload"].get("tick") != tick:
        raise Refusal(f"spine frame {frame['seq']} is not tick anchor {tick}")
    if expect_hash is not None and frame["frame_hash"] != expect_hash:
        raise Refusal(f"spine tick {tick} is {frame['frame_hash'][:16]}…, not {expect_hash[:16]}…")
    return frame


def read_anchor(spine):
    """The tick this moment happens under, checked rather than believed."""
    src = Chain(spine)
    meta = src.head(fresh=True)
    if meta.get("stream_id") != SPINE_STREAM:
        raise Refusal(f"the spine HEAD names {meta.get('stream_id')!r}, not {SPINE_STREAM}")
    count, head_hash = meta.get("count"), meta.get("head_frame")
    if not isinstance(count, int) or count < 1 or not (isinstance(head_hash, str) and HEX64.match(head_hash)):
        raise Refusal("the spine HEAD is not a head")
    tick = count - 1
    frame = check_tick(src.frame(tick), tick, head_hash)
    return {"tick": tick, "tick_frame": frame["frame_hash"], "spine": SPINE_REPO, "fetched_utc": utc_now(),
            "tick_utc": frame["utc"]}


# ── minds: a thought is sealed as what its own evidence says ─────────────────
# A player that thought this tick leaves two files beside its view: mind.json, its exchange with the
# model as it crossed the wire, and saw.webp, the picture the model was shown. The sealer hashes
# both. Everything a frame says about the thought (which model answered, what it did and why, what
# it said, what it cost) is DERIVED from mind.json and never taken from the receipt, and verify
# derives it again: a line whose words disagree with its evidence is a forgery even when every hash
# is right. views.html derives it the same way, so the rules below are written to mean the same
# thing in JavaScript: integral numbers are integers, a cut is by code point, and a lone surrogate
# becomes U+FFFD.
MIND_SCHEMA = "ainexus/mind-exchange/1"
PROVIDER = "github-copilot"
MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}")
VERB = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,39}")
LONE = re.compile("[\ud800-\udfff]")
# JSON leaves these three raw, and the spine's own reader (chainio) splits an epoch bundle's lines on
# them, so a frame that carried one would break the line the day its epoch is sealed.
BREAKS = re.compile("[\x85\u2028\u2029]")
# whitespace as both Python's str.split() and JavaScript's \s find it, the union of the two
SPACES = re.compile("[\\s\x1c-\x1f\x85\ufeff]+")
POSE = ("x_cm", "y_cm", "z_cm", "yaw_mrad", "pitch_mrad")
MAX_DID = 6
MAX_COUNT = 2 ** 53 - 1
MIND_KEYS = {"kind", "provider", "asked", "model", "multiplier_x100", "said", "did", "ms", "tokens_in",
             "tokens_out", "exchange"}
# A clock is the IANA timezone whose hours a body keeps: it sleeps from 23:00 to 07:00 there.
CLOCK = re.compile(r"[A-Za-z][A-Za-z0-9_+-]{0,31}(/[A-Za-z0-9_+-]{1,32}){0,2}")


# ── routines: the standing loop a body runs between frames ──────────────────
# A routine is an autodrive program that the capture and every viewer play forward the same way
# (ai/playout.js), between one frame and the next. It is made canonical by exactly the rules
# there, so a routine a mind wrote is sealed exactly as it ran: numbers cut toward zero and held
# to their bounds, anything else about a step refused, and one refused step refuses the routine.
ROUTINE_DIRS = ("forward", "back", "left", "right")
ROUTINE_MAX_STEPS = 8
TURN_MS = 250


def _whole(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, float) and not math.isfinite(v):
        return None
    return min(hi, max(lo, math.trunc(v)))


def canonical_routine(steps):
    """A routine as ai/playout.js plays it, or None when it is not one."""
    if not isinstance(steps, list) or not 1 <= len(steps) <= ROUTINE_MAX_STEPS:
        return None
    out, timed = [], 0
    for step in steps:
        if not isinstance(step, dict):
            return None
        kind = step.get("do")
        if kind == "walk":
            ms = _whole(step.get("ms"), 100, 3000)
            if step.get("dir") not in ROUTINE_DIRS or ms is None:
                return None
            out.append({"do": "walk", "dir": step["dir"], "ms": ms})
            timed += ms
        elif kind == "look":
            dx = 0 if "dx" not in step else _whole(step["dx"], -2000, 2000)
            dy = 0 if "dy" not in step else _whole(step["dy"], -600, 600)
            if dx is None or dy is None:
                return None
            out.append({"do": "look", "dx": dx, "dy": dy})
            timed += TURN_MS
        elif kind == "wait":
            ms = _whole(step.get("ms"), 100, 10000)
            if ms is None:
                return None
            out.append({"do": "wait", "ms": ms})
            timed += ms
        else:
            return None
    return out if timed >= 300 else None


def routine_line(r):
    who = "default routine" if r["by"] == "default" else r["by"] + "'s routine"
    return clip("↻ " + who + ": " + ", ".join(step["do"] for step in r["steps"]), 64)


def isint(x):
    return isinstance(x, int) and not isinstance(x, bool)


def count(x, cap=MAX_COUNT):
    """A non-negative integer as JSON means one, whichever way it was spelled; else None."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    if isinstance(x, float) and not x.is_integer():
        return None
    return int(x) if 0 <= x <= cap else None


def clip(s, n):
    """Cut by code point and mark the cut, as tools/minds.cjs and views.html do."""
    s = BREAKS.sub(" ", LONE.sub("\ufffd", s)) if isinstance(s, str) else ""
    return s if len(s) <= n else s[: n - 1] + "…"


def _no_constant(name):
    raise ValueError(f"{name} is not JSON")


def pose_ok(at):
    return (isinstance(at, dict) and set(at) == set(POSE) and all(isint(at[k]) for k in POSE)
            and all(abs(at[k]) <= 10_000_000 for k in ("x_cm", "y_cm", "z_cm"))
            and abs(at["yaw_mrad"]) <= 3142 and abs(at["pitch_mrad"]) <= 3142)


def in_segment(f, segment):
    parts = f.split("/") if isinstance(f, str) else []
    return (isinstance(f, str) and len(f) <= 256 and f.startswith(f"segments/{segment}/")
            and all(part not in ("", ".", "..") for part in parts))


def doing_of(mind, routine=None):
    """The one line a frame shows for a minded player, a function of its mind and the routine its
    body ran, and checked as one. A body resting between thoughts is running its routine; a body
    asleep is not, whatever routine it will wake to."""
    if mind["kind"] == "sleep" or (mind["kind"] == "rest" and not routine):
        return clip("💤 " + mind["why"], 64)
    if mind["kind"] == "rest":
        return routine_line(routine)
    verbs = [d["verb"][6:] if d["verb"].startswith("world_") else d["verb"] for d in mind["did"]]
    return clip("🧠 " + mind["model"] + (": " + ", ".join(verbs) if verbs else ""), 64)


def derive_mind(x, pid):
    """What a frame may say about one thought, from its exchange alone: (mind, picture), where
    picture is the SHA-256 of the image the model was shown, or None."""
    def refuse(why):
        raise Refusal(f"{pid}: {why}")
    if not isinstance(x, dict) or x.get("schema") != MIND_SCHEMA:
        refuse(f"its thought's evidence is not an {MIND_SCHEMA}")
    if x.get("player") != pid:
        refuse("its thought's evidence is another player's")
    if x.get("provider") != PROVIDER:
        refuse("its thought names a provider this line does not know")
    asked, cost = x.get("asked"), count(x.get("multiplier_x100"), 100000)
    if not (isinstance(asked, str) and MODEL.fullmatch(asked)):
        refuse("its thought names no model it asked")
    if cost is None:
        refuse("its thought names no cost")
    rounds, calls, words, voiced = x.get("rounds"), x.get("calls"), x.get("words"), x.get("voiced")
    if not (isinstance(rounds, list) and 1 <= len(rounds) <= 8 and all(isinstance(r, dict) for r in rounds)):
        refuse("its thought has no rounds with the model")
    if not (isinstance(calls, list) and len(calls) <= 64 and all(isinstance(c, dict) for c in calls)):
        refuse("its thought's actions are not a list")
    if not isinstance(words, str) or not (voiced is None or isinstance(voiced, str)):
        refuse("its thought's words are not text")
    ms = tokens_in = tokens_out = 0
    pictures = set()
    for r in rounds:
        request, response, spent = r.get("request"), r.get("response"), count(r.get("ms"))
        if spent is None or count(r.get("status")) is None or not isinstance(request, dict) \
                or not isinstance(response, dict):
            refuse("a round of its thought is not a round")
        ms += spent
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        tokens_in += count(usage.get("prompt_tokens")) or 0
        tokens_out += count(usage.get("completion_tokens")) or 0
        messages = request.get("messages") if isinstance(request.get("messages"), list) else []
        for message in messages:
            content = message.get("content") if isinstance(message, dict) else None
            for part in content if isinstance(content, list) else []:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    shown = part.get("image_url") if isinstance(part.get("image_url"), dict) else {}
                    if not (isinstance(shown.get("sha256"), str) and HEX64.fullmatch(shown["sha256"])):
                        refuse("its thought was shown a picture it does not name by hash")
                    pictures.add(shown["sha256"])
    last = rounds[-1]
    if count(last["status"]) != 200 or not isinstance(last["response"].get("message"), dict):
        refuse("the model never answered its thought")
    if len(pictures) > 1:
        refuse("its thought was shown more than one picture")
    spoken = []
    for c in calls:
        args = c.get("args") if isinstance(c.get("args"), dict) else {}
        if c.get("tool") in ("world_say", "world_tell") and c.get("failed") is False \
                and isinstance(args.get("text"), str) and args["text"]:
            spoken.append(args["text"])
    if voiced:
        spoken.append(voiced)
    did = []
    for c in calls[:MAX_DID]:
        tool, args = c.get("tool"), c.get("args") if isinstance(c.get("args"), dict) else {}
        did.append({"verb": tool if isinstance(tool, str) and VERB.fullmatch(tool) else "?",
                    "why": clip(args.get("why"), 160) if isinstance(args.get("why"), str) else "",
                    "failed": c.get("failed") is not False})
    # the routine it left its body running: the last one it set that the hands accepted
    routine = None
    for c in calls:
        args = c.get("args") if isinstance(c.get("args"), dict) else {}
        if c.get("tool") == "world_routine" and c.get("failed") is False:
            steps = canonical_routine(args.get("steps"))
            if steps is not None:
                routine = steps
    answered = last["response"].get("model")
    mind = {"kind": "model", "provider": PROVIDER, "asked": asked,
            "model": answered if isinstance(answered, str) and MODEL.fullmatch(answered) else asked,
            "multiplier_x100": cost, "said": clip(" ".join(spoken), 240), "did": did, "ms": ms,
            "tokens_in": tokens_in, "tokens_out": tokens_out}
    if routine is not None:
        mind["routine_set"] = routine
    return mind, (next(iter(pictures)) if pictures else None)


def read_exchange(data, pid):
    try:
        return derive_mind(json.loads(data.decode("utf-8"), parse_constant=_no_constant), pid)
    except (UnicodeDecodeError, ValueError, RecursionError) as ex:
        raise Refusal(f"{pid}: its thought's evidence is not JSON: {ex}")


def segment_file(feed_dir, segment, rel, what):
    if not in_segment(rel, segment):
        raise Refusal(f"{what} is not a file in this tick's segment")
    path = (feed_dir / rel).resolve()
    if feed_dir not in path.parents or not path.is_file():
        raise Refusal(f"{what} is not in the feed")
    data = path.read_bytes()
    if not data:
        raise Refusal(f"{what} is empty")
    return data


def sealed_mind(m, pid, segment, feed_dir):
    """What a frame says about a player's mind: a rest in its own words, or a thought derived from
    the evidence beside its view. The receipt says only where to look."""
    if m is None:
        return None
    if not isinstance(m, dict) or m.get("kind") not in ("model", "rest", "sleep"):
        raise Refusal(f"{pid}: the receipt names a mind that is neither a thought, a rest nor a sleep")
    if m["kind"] in ("rest", "sleep"):
        why = m.get("why") if isinstance(m.get("why"), str) else ""
        return {"kind": m["kind"], "why": clip(SPACES.sub(" ", why).strip(" "), 160) or m["kind"]}
    rel = m.get("exchange")
    data = segment_file(feed_dir, segment, rel, f"{pid}: its thought's evidence")
    mind, picture = read_exchange(data, pid)
    mind["exchange"] = {"file": rel, "bytes": len(data), "sha256": sha256(data)}
    saw = m.get("saw")
    if picture is None and saw:
        raise Refusal(f"{pid}: the receipt names a picture its thought was never shown")
    if picture is not None:
        if not saw:
            raise Refusal(f"{pid}: its thought was shown a picture the capture did not keep")
        shown = segment_file(feed_dir, segment, saw, f"{pid}: the picture its thought was shown")
        if sha256(shown) != picture:
            raise Refusal(f"{pid}: the picture beside its view is not the one its thought was shown")
        mind["saw"] = {"file": saw, "bytes": len(shown), "sha256": picture}
    return mind


def plain(s, n):
    """Text a frame may carry: short, whole characters, and nothing that splits a line."""
    return isinstance(s, str) and len(s) <= n and not LONE.search(s) and not BREAKS.search(s)


def mind_problems(pid, m, segment):
    if not isinstance(m, dict):
        return [f"{pid}: mind is not an object"]
    if m.get("kind") in ("rest", "sleep"):
        why = m.get("why")
        if set(m) != {"kind", "why"} or not (plain(why, 160) and why):
            return [f"{pid}: a {'resting' if m['kind'] == 'rest' else 'sleeping'} mind does not say why in a sentence"]
        return []
    if m.get("kind") != "model":
        return [f"{pid}: mind is neither a thought, a rest nor a sleep"]
    if not (MIND_KEYS <= set(m) <= MIND_KEYS | {"saw", "routine_set"}):
        return [f"{pid}: a thought is not {{{', '.join(sorted(MIND_KEYS))}}} with an optional saw and routine_set"]
    out = []
    if "routine_set" in m and canonical_routine(m["routine_set"]) != m["routine_set"]:
        out.append(f"{pid}: routine_set is not a routine")
    if m["provider"] != PROVIDER:
        out.append(f"{pid}: its thought names a provider this line does not know")
    for k in ("asked", "model"):
        if not (isinstance(m[k], str) and MODEL.fullmatch(m[k])):
            out.append(f"{pid}: {k} is not a model id")
    for k, cap in (("multiplier_x100", 100000), ("ms", MAX_COUNT), ("tokens_in", MAX_COUNT), ("tokens_out", MAX_COUNT)):
        if not (isint(m[k]) and 0 <= m[k] <= cap):
            out.append(f"{pid}: {k} is not a count")
    if not plain(m["said"], 240):
        out.append(f"{pid}: said is not a short line")
    did = m["did"]
    if not (isinstance(did, list) and len(did) <= MAX_DID and all(
            isinstance(d, dict) and set(d) == {"verb", "why", "failed"} and isinstance(d["verb"], str)
            and (d["verb"] == "?" or VERB.fullmatch(d["verb"])) and plain(d["why"], 160)
            and isinstance(d["failed"], bool)
            for d in did)):
        out.append(f"{pid}: did is not a list of what it did and why")
    for k, what in (("exchange", "its thought's evidence"), ("saw", "the picture it was shown")):
        e = m.get(k)
        if k in m and not (isinstance(e, dict) and set(e) == {"file", "bytes", "sha256"}
                           and in_segment(e["file"], segment) and isint(e["bytes"]) and e["bytes"] > 0
                           and isinstance(e["sha256"], str) and HEX64.fullmatch(e["sha256"])):
            out.append(f"{pid}: {what} is not a file in this tick's segment")
    return out


def routine_problems(pid, r, tick, mind):
    """A routine on its own, and against the thought beside it. Whether a routine set on an earlier
    tick really was set there is a question about the line, which verify asks."""
    if not (isinstance(r, dict) and set(r) == {"steps", "set_at", "by"}):
        return [f"{pid}: routine is not {{steps, set_at, by}}"]
    out = []
    if canonical_routine(r["steps"]) != r["steps"]:
        out.append(f"{pid}: routine steps are not a routine")
    set_here = isinstance(mind, dict) and mind.get("kind") == "model" and "routine_set" in mind
    if r["set_at"] is None:
        if r["by"] != "default":
            out.append(f"{pid}: a routine no thought set is not the default one")
    elif not (isint(r["set_at"]) and 0 <= r["set_at"] <= tick and isinstance(r["by"], str)
              and MODEL.fullmatch(r["by"]) and r["by"] != "default"):
        out.append(f"{pid}: routine names no tick and model that set it")
    elif r["set_at"] == tick and not (set_here and mind["routine_set"] == r["steps"] and mind["model"] == r["by"]):
        out.append(f"{pid}: routine says it was set this tick by a thought that did not set it")
    if set_here and r.get("set_at") != tick:
        out.append(f"{pid}: its thought set a routine this tick and the body ran another")
    return out


def thought_problem(pid, m, fetch):
    """'' when the feed's evidence says exactly what the frame says about a thought, None when the
    evidence has rolled out of the feed, and otherwise what is wrong."""
    data = fetch(m["exchange"]["file"])
    if data is None:
        return None
    if sha256(data) != m["exchange"]["sha256"] or len(data) != m["exchange"]["bytes"]:
        return f"{pid}'s thought is not the one sealed"
    try:
        derived, picture = read_exchange(data, pid)
    except Refusal as ex:
        return str(ex)
    if {k: m.get(k) for k in derived} != derived:
        return f"{pid}: the frame says what its thought's evidence does not"
    if picture != (m["saw"]["sha256"] if "saw" in m else None):
        return f"{pid}: the frame names a picture its thought was not shown"
    if "saw" in m:
        shown = fetch(m["saw"]["file"])
        if shown is not None and (sha256(shown) != m["saw"]["sha256"] or len(shown) != m["saw"]["bytes"]):
            return f"{pid}'s picture is not the one its thought was shown"
    return ""


# ── the shape of a views payload ─────────────────────────────────────────────
def shape_problems(p):
    """Everything a views frame's payload must be, so the sealer can never write what verify refuses.
    The derived magnitudes are recomputed, not trusted: they are what a mission chant carries."""
    out = []
    if not isinstance(p, dict):
        return ["payload is not an object"]
    allowed = {"tick", "tick_frame", "spine", "fetched_utc", "views", "sources_failed", "about"}
    extra = set(p) - allowed
    if extra:
        out.append(f"unexpected payload keys {sorted(extra)}")
    if not (isinstance(p.get("tick"), int) and not isinstance(p.get("tick"), bool) and p["tick"] >= 0):
        out.append("tick is not a non-negative integer")
    if not (isinstance(p.get("tick_frame"), str) and HEX64.match(p["tick_frame"])):
        out.append("tick_frame is not 64 hex")
    if p.get("spine") != SPINE_REPO:
        out.append(f"spine is not {SPINE_REPO}")
    if not (isinstance(p.get("fetched_utc"), str) and UTC.match(p["fetched_utc"])):
        out.append("fetched_utc is not the fixed utc form")
    failed = p.get("sources_failed")
    if not (isinstance(failed, list) and all(isinstance(x, str) and PLAYER_ID.match(x) for x in failed)):
        out.append("sources_failed is not a list of player ids")
    if "about" in p and not isinstance(p["about"], str):
        out.append("about is not a sentence")
    v = p.get("views")
    if not isinstance(v, dict):
        return out + ["views is not an object"]
    need = {"world", "world_sha256", "tick_id", "segment", "captured_utc", "feed", "players",
            "players_sealed", "presences_seen", "view_bytes", "gap_min"}
    missing = need - set(v)
    if missing:
        return out + [f"views is missing {sorted(missing)}"]
    extra = set(v) - need - {"source_commit", "thoughts", "premium_x100"}
    if extra:
        out.append(f"unexpected views keys {sorted(extra)}")
    if not (isinstance(v["world"], str) and WORLD.match(v["world"])):
        out.append("world is not a page name")
    if not (isinstance(v["world_sha256"], str) and HEX64.match(v["world_sha256"])):
        out.append("world_sha256 is not 64 hex")
    if "source_commit" in v and not (isinstance(v["source_commit"], str) and HEX40.match(v["source_commit"])):
        out.append("source_commit is not a commit")
    if not (isinstance(v["segment"], str) and SEGMENT.match(v["segment"])):
        out.append("segment is not a segment id")
    if not (isinstance(v["tick_id"], str) and v["tick_id"].startswith(str(v["segment"]) + ":")
            and len(v["tick_id"]) <= 128):
        out.append("tick_id does not name its segment")
    if not (isinstance(v["captured_utc"], str) and UTC.match(v["captured_utc"])):
        out.append("captured_utc is not the fixed utc form")
    if not (isinstance(v["feed"], str) and v["feed"].startswith("https://") and v["feed"].endswith("/")):
        out.append("feed is not an https directory")
    for k in ("players_sealed", "presences_seen", "view_bytes", "gap_min"):
        if not (isinstance(v[k], int) and not isinstance(v[k], bool) and v[k] >= 0):
            out.append(f"{k} is not a non-negative integer")
    players = v["players"]
    if not (isinstance(players, list) and 1 <= len(players) <= MAX_PLAYERS):
        return out + [f"players is not a list of 1-{MAX_PLAYERS}"]
    ids, seen_total, byte_total = [], 0, 0
    minded, thinkers = False, []
    base = {"id", "doing", "sees", "file", "bytes", "sha256"}
    for q in players:
        if not isinstance(q, dict) or not base <= set(q) <= base | {"at", "mind", "routine", "clock"}:
            out.append("a player is not {id, doing, sees, file, bytes, sha256} with an optional at, mind, routine and clock")
            continue
        if not (isinstance(q["id"], str) and PLAYER_ID.match(q["id"])):
            out.append(f"player id {q['id']!r} is not an id")
            continue
        ids.append(q["id"])
        if not (isinstance(q["doing"], str) and len(q["doing"]) <= 64):
            out.append(f"{q['id']}: doing is not a short string")
        if "mind" in q:
            minded = True
            bad = mind_problems(q["id"], q["mind"], v["segment"])
            if "routine" in q:
                bad = bad or routine_problems(q["id"], q["routine"], p.get("tick", -1), q["mind"])
            out += bad
            if not bad:
                if q["doing"] != doing_of(q["mind"], q.get("routine")):
                    out.append(f"{q['id']}: doing is not what its mind and routine say")
                if q["mind"]["kind"] == "model":
                    thinkers.append(q["mind"])
        elif "routine" in q:
            out.append(f"{q['id']}: a routine is sealed with the mind that runs it, and there is none")
        if "clock" in q and not (isinstance(q["clock"], str) and len(q["clock"]) <= 64 and CLOCK.fullmatch(q["clock"])):
            out.append(f"{q['id']}: clock is not a timezone")
        if "at" in q and not pose_ok(q["at"]):
            out.append(f"{q['id']}: at is not a pose")
        sees = q["sees"]
        if not (isinstance(sees, list) and len(sees) <= MAX_PLAYERS and len(set(sees)) == len(sees)
                and all(isinstance(x, str) and PLAYER_ID.match(x) and x != q["id"] for x in sees)):
            out.append(f"{q['id']}: sees is not a list of other players")
        else:
            seen_total += len(sees)
        f = q["file"]
        if not in_segment(f, v["segment"]):
            out.append(f"{q['id']}: file is not inside this tick's segment")
        if not (isinstance(q["bytes"], int) and not isinstance(q["bytes"], bool) and q["bytes"] > 0):
            out.append(f"{q['id']}: bytes is not a positive integer")
        else:
            byte_total += q["bytes"]
        if not (isinstance(q["sha256"], str) and HEX64.match(q["sha256"])):
            out.append(f"{q['id']}: sha256 is not 64 hex")
    if len(set(ids)) != len(ids):
        out.append("a player appears twice")
    if v["players_sealed"] != len(players):
        out.append("players_sealed does not count the players")
    if v["presences_seen"] != seen_total:
        out.append("presences_seen does not sum what the players saw")
    if v["view_bytes"] != byte_total:
        out.append("view_bytes does not sum the views")
    # the ledger: what thinking this tick cost, which is what a day's budget is audited from
    ledger = {"thoughts", "premium_x100"}
    if not minded and ledger & set(v):
        out.append("a frame without minds carries a ledger of them")
    elif minded:
        if not ledger <= set(v):
            out.append("a frame with minds does not carry thoughts and premium_x100")
        else:
            if not (isint(v["thoughts"]) and v["thoughts"] == len(thinkers)):
                out.append("thoughts does not count the players who thought")
            if not (isint(v["premium_x100"]) and v["premium_x100"] == sum(m["multiplier_x100"] for m in thinkers)):
                out.append("premium_x100 does not sum what the thoughts cost")
    return out


# ── sealing ──────────────────────────────────────────────────────────────────
def sealed_routine(r, pid, tick, mind, chain):
    """The routine a body ran this tick, resolved from where it was set and never from the receipt,
    which says only which one ran: set by this tick's thought, set by an earlier one on the line,
    or the world's default, whose steps are the capture's to name."""
    set_here = isinstance(mind, dict) and mind.get("kind") == "model" and "routine_set" in mind
    if r is None:
        if set_here:
            raise Refusal(f"{pid}: its thought set a routine and the receipt says none ran")
        return None
    if not isinstance(r, dict) or mind is None:
        raise Refusal(f"{pid}: the receipt names a routine with no mind to run it")
    set_at = r.get("set_at")
    if set_at == "this":
        if not set_here:
            raise Refusal(f"{pid}: the receipt says its thought set a routine, and its evidence says it did not")
        return {"steps": mind["routine_set"], "set_at": tick, "by": mind["model"]}
    if set_here:
        raise Refusal(f"{pid}: its thought set a routine this tick and the receipt says another ran")
    if set_at is None:
        steps = canonical_routine(r.get("steps"))
        if steps is None or r.get("by", "default") != "default":
            raise Refusal(f"{pid}: the receipt names a default routine that is not a routine")
        return {"steps": steps, "set_at": None, "by": "default"}
    if not (isint(set_at) and 0 <= set_at < tick):
        raise Refusal(f"{pid}: the receipt names a routine set at no earlier tick")
    for frame in reversed(chain or []):
        if frame["payload"].get("tick") == set_at:
            q = next((x for x in frame["payload"]["views"]["players"] if x.get("id") == pid), None)
            m = q.get("mind") if q else None
            if m and m.get("kind") == "model" and "routine_set" in m:
                return {"steps": m["routine_set"], "set_at": set_at, "by": m["model"]}
            break
    raise Refusal(f"{pid}: no thought at tick {set_at} set the routine the receipt says it ran")


def build_payload(anchor, receipt, feed_dir, feed_url, head, chain=None):
    """A capture receipt plus the bytes it points at become a views payload. The receipt is trusted
    for NOTHING it can be checked on: every hash and size is computed here from the feed itself."""
    if not isinstance(receipt, dict) or receipt.get("schema") != "ainexus/views-receipt/1":
        raise Refusal("the receipt is not an ainexus/views-receipt/1")
    segment, tick_id = receipt.get("segment"), receipt.get("tick_id")
    if not (isinstance(segment, str) and SEGMENT.match(segment)):
        raise Refusal("the receipt names no usable segment")
    players = receipt.get("players")
    if not (isinstance(players, list) and 1 <= len(players) <= MAX_PLAYERS):
        raise Refusal("the receipt names no players")
    feed_dir = pathlib.Path(feed_dir).resolve()
    sealed, failed = [], []
    for q in players:
        pid = q.get("id") if isinstance(q, dict) else None
        if not (isinstance(pid, str) and PLAYER_ID.match(pid)):
            raise Refusal(f"the receipt names a player {pid!r} that is not an id")
        rel = q.get("file")
        # A shot from an earlier segment is how the stream carries a view forward when a player
        # produced none this tick. That is last tick's view, and sealing it here would date it wrong.
        if not (isinstance(rel, str) and rel.startswith(f"segments/{segment}/")):
            failed.append(pid)
            continue
        path = (feed_dir / rel).resolve()
        if feed_dir not in path.parents or not path.is_file():
            failed.append(pid)
            continue
        data = path.read_bytes()
        if not data:
            failed.append(pid)
            continue
        sees = sorted({s for s in (q.get("sees") or []) if isinstance(s, str) and PLAYER_ID.match(s) and s != pid})
        doing = q.get("doing") if isinstance(q.get("doing"), str) else ""
        entry = {"id": pid, "doing": doing[:64], "sees": sees, "file": rel,
                 "bytes": len(data), "sha256": sha256(data)}
        if pose_ok(q.get("at")):
            entry["at"] = {k: q["at"][k] for k in POSE}
        mind = sealed_mind(q.get("mind"), pid, segment, feed_dir)
        routine = sealed_routine(q.get("routine"), pid, anchor["tick"], mind, chain)
        if mind is not None:
            entry["mind"] = mind
            if routine is not None:
                entry["routine"] = routine
            entry["doing"] = doing_of(mind, routine)
        clock = q.get("clock")
        if isinstance(clock, str) and len(clock) <= 64 and CLOCK.fullmatch(clock):
            entry["clock"] = clock
        sealed.append(entry)
    if not sealed:
        raise Refusal("no player has a view in this tick's segment — there is nothing to seal")
    captured = receipt.get("captured_utc")
    if not (isinstance(captured, str) and UTC.match(captured)):
        raise Refusal("the receipt has no capture time in the fixed utc form")
    if captured < anchor["tick_utc"]:
        raise Refusal(f"the view was captured at {captured}, before spine tick {anchor['tick']} was minted "
                      f"at {anchor['tick_utc']}")
    gap = 0
    if head is not None:
        prev = head["payload"]["views"]["captured_utc"]
        gap = max(0, int((parse_utc(captured) - parse_utc(prev)).total_seconds() // 60))
    views = {
        "world": receipt.get("world"),
        "world_sha256": receipt.get("world_sha256"),
        "tick_id": tick_id,
        "segment": segment,
        "captured_utc": captured,
        "feed": feed_url,
        "players": sealed,
        "players_sealed": len(sealed),
        "presences_seen": sum(len(q["sees"]) for q in sealed),
        "view_bytes": sum(q["bytes"] for q in sealed),
        "gap_min": gap,
    }
    commit = receipt.get("source_commit")
    if isinstance(commit, str) and HEX40.match(commit):
        views["source_commit"] = commit
    if any("mind" in q for q in sealed):
        thinkers = [q["mind"] for q in sealed if q.get("mind", {}).get("kind") == "model"]
        views["thoughts"] = len(thinkers)
        views["premium_x100"] = sum(m["multiplier_x100"] for m in thinkers)
    payload = {"tick": anchor["tick"], "tick_frame": anchor["tick_frame"], "spine": SPINE_REPO,
               "fetched_utc": anchor["fetched_utc"], "views": views, "sources_failed": sorted(failed)}
    if head is None:
        payload["about"] = ABOUT
    return payload


def seal(anchor, receipt, feed_dir, chain_dir=CHAIN_DIR, feed_url=FEED_URL):
    """Append one frame for this anchor, or return None when this tick is already on the line."""
    for k in ("tick", "tick_frame", "fetched_utc", "tick_utc"):
        if k not in anchor:
            raise Refusal(f"the anchor has no {k}")
    if not (isinstance(anchor["tick_frame"], str) and HEX64.match(anchor["tick_frame"])):
        raise Refusal("the anchor's tick_frame is not 64 hex")
    if not (isinstance(anchor["tick_utc"], str) and UTC.match(anchor["tick_utc"])):
        raise Refusal("the anchor's tick_utc is not the fixed utc form")
    chain_dir = pathlib.Path(chain_dir)
    chain = chainio.load_chain(chain_dir)
    head = chain[-1] if chain else None
    if head is not None:
        last = head["payload"].get("tick")
        if last == anchor["tick"]:
            return None
        if isinstance(last, int) and anchor["tick"] < last:
            raise Refusal(f"the anchor is tick {anchor['tick']}, older than the last sealed tick {last}")
    payload = build_payload(anchor, receipt, feed_dir, feed_url, head, chain)
    problems = shape_problems(payload)
    if problems:
        raise Refusal("refusing a payload verify would refuse: " + "; ".join(problems))
    now = utc_now()
    if head is not None and now < head["utc"]:
        now = head["utc"]
    frame = R.build_frame(KIND, STREAM, (head["seq"] + 1) if head else 0, now, payload,
                          prev=(head["payload_hash"] if head else None))
    ok, step, why = R.verify_frame(frame, head=head, stream_id_of_record=STREAM)
    if not ok:
        raise Refusal(f"refusing an invalid frame: step {step}: {why}")
    chainio.append_frame(chain_dir, frame, STREAM)
    return frame


# ── verifying the whole line ─────────────────────────────────────────────────
def verify(chain, spine=SPINE_URL, feed=None, log=print, feed_last=None):
    """The line, every anchor, and every view the feed still holds (or only the newest `feed_last`
    frames' views). Returns the problems found."""
    problems = []
    src = Chain(chain)
    try:
        meta = src.head()
        frames = src.frames()
    except Exception as ex:                                   # unreadable is not verified
        return [f"the chain could not be read: {ex}"]
    if meta.get("stream_id") != STREAM:
        problems.append(f"HEAD names {meta.get('stream_id')!r}, not {STREAM}")
    if not frames:
        return problems + ["the chain is empty"]
    head = None
    by_tick = {}
    for f in frames:
        ok, step, why = R.verify_frame(f, head=head, stream_id_of_record=STREAM)
        if not ok:
            return problems + [f"frame {f.get('seq')}: step {step}: {why}"]
        if f["kind"] != KIND:
            problems.append(f"frame {f['seq']}: kind {f['kind']!r} is not {KIND}")
        for p in shape_problems(f["payload"]):
            problems.append(f"frame {f['seq']}: {p}")
        if head is not None and isinstance(f["payload"].get("tick"), int) \
                and isinstance(head["payload"].get("tick"), int) \
                and f["payload"]["tick"] <= head["payload"]["tick"]:
            problems.append(f"frame {f['seq']}: tick {f['payload']['tick']} does not advance past {head['payload']['tick']}")
        # a routine carried from an earlier tick has to be the one a thought really set there
        for q in f["payload"].get("views", {}).get("players", []) if isinstance(f["payload"].get("views"), dict) else []:
            r = q.get("routine") if isinstance(q, dict) else None
            if isinstance(r, dict) and isint(r.get("set_at")) and r["set_at"] < f["payload"].get("tick", -1):
                src = by_tick.get(r["set_at"])
                sq = next((x for x in src["payload"]["views"]["players"] if x.get("id") == q.get("id")), None) if src else None
                m = sq.get("mind") if sq else None
                if not (m and m.get("kind") == "model" and m.get("routine_set") == r.get("steps")
                        and m.get("model") == r.get("by")):
                    problems.append(f"frame {f['seq']}: {q.get('id')} runs a routine no thought at tick {r['set_at']} set")
        if isinstance(f["payload"].get("tick"), int):
            by_tick[f["payload"]["tick"]] = f
        head = f
    if head["frame_hash"] != meta.get("head_frame"):
        problems.append("HEAD.json does not name the last frame")
    if problems:
        return problems
    log(f"line: {len(frames)} frame(s) verify on {STREAM}, head {head['frame_hash'][:16]}…")

    spine_src = Chain(spine)
    try:
        spine_meta = spine_src.head(fresh=True)
    except Exception as ex:
        return [f"the spine could not be read, so no anchor can be checked: {ex}"]
    for f in frames:
        tick = f["payload"]["tick"]
        if tick >= spine_meta.get("count", 0):
            problems.append(f"frame {f['seq']}: tick {tick} is past the spine's head")
            continue
        try:
            tick_frame = check_tick(spine_src.frame(tick), tick, f["payload"]["tick_frame"])
            # the promise the sealer keeps by reading the spine before it captures, checked here
            if f["payload"]["views"]["captured_utc"] < tick_frame["utc"]:
                problems.append(f"frame {f['seq']}: its view was captured before spine tick {tick} was minted")
        except Refusal as ex:
            problems.append(f"frame {f['seq']}: {ex}")
        except Exception as ex:
            problems.append(f"frame {f['seq']}: spine tick {tick} could not be read: {ex}")
    if problems:
        return problems
    log(f"anchors: all {len(frames)} tick(s) are the spine's own")

    if feed:
        remote = str(feed).startswith(("https://", "http://"))
        base = str(feed) if not remote or str(feed).endswith("/") else str(feed) + "/"

        def fetch(rel):
            """The feed's bytes for a sealed file, or None once they have rolled out of it."""
            try:
                if remote:
                    req = urllib.request.Request(base + rel, headers={"User-Agent": "ainexus-views-seal"})
                    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                        return r.read()
                return (pathlib.Path(base) / rel).read_bytes()
            except FileNotFoundError:
                return None
            except urllib.error.HTTPError as ex:
                if ex.code == 404:
                    return None
                raise

        held = pruned = thoughts = gone = 0
        for f in (frames[-feed_last:] if feed_last else frames):
            for q in f["payload"]["views"]["players"]:
                try:
                    data = fetch(q["file"])
                    if data is None:
                        pruned += 1     # rolled out of the feed; the frame still proves its hash
                    elif sha256(data) != q["sha256"] or len(data) != q["bytes"]:
                        problems.append(f"frame {f['seq']}: {q['id']}'s view is not the one sealed")
                    else:
                        held += 1
                    mind = q.get("mind")
                    if mind and mind["kind"] == "model":
                        why = thought_problem(q["id"], mind, fetch)
                        if why is None:
                            gone += 1
                        elif why:
                            problems.append(f"frame {f['seq']}: {why}")
                        else:
                            thoughts += 1
                except urllib.error.HTTPError as ex:
                    problems.append(f"frame {f['seq']}: {q['id']}: the feed answered {ex.code}")
        if not problems:
            log(f"views: {held} held by the feed hash to their frames"
                + (f"; {pruned} have rolled out of the feed" if pruned else ""))
            if thoughts or gone:
                log(f"minds: {thoughts} thought(s) say exactly what their evidence says"
                    + (f"; {gone} have rolled out of the feed" if gone else ""))
    return problems


# ── the command line ─────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("anchor", help="read and check the spine tick a capture is about to happen under")
    a.add_argument("--spine", default=SPINE_URL)
    a.add_argument("--chain", default=str(CHAIN_DIR))
    a.add_argument("--out", required=True)
    s = sub.add_parser("seal", help="append one frame for a captured tick")
    s.add_argument("--anchor", required=True)
    s.add_argument("--receipt", required=True)
    s.add_argument("--feed-dir", required=True)
    s.add_argument("--feed-url", default=FEED_URL)
    s.add_argument("--chain", default=str(CHAIN_DIR))
    s.add_argument("--summary")
    v = sub.add_parser("verify", help="verify the line, its anchors, and the views the feed still holds")
    v.add_argument("--chain", default=str(CHAIN_DIR))
    v.add_argument("--spine", default=SPINE_URL)
    v.add_argument("--feed")
    v.add_argument("--feed-last", type=int, help="only re-hash the views of the newest N frames")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "anchor":
            anchor = read_anchor(args.spine)
            chain = chainio.load_chain(args.chain)
            last = chain[-1]["payload"].get("tick") if chain else None
            if last == anchor["tick"]:
                print(f"spine tick {anchor['tick']} is already sealed as views frame {chain[-1]['seq']}")
                return NOT_DUE
            pathlib.Path(args.out).write_text(json.dumps(anchor, indent=1) + "\n")
            print(f"anchored to spine tick {anchor['tick']} ({anchor['tick_frame'][:16]}…)")
            return 0
        if args.cmd == "seal":
            anchor = json.loads(pathlib.Path(args.anchor).read_text())
            receipt = json.loads(pathlib.Path(args.receipt).read_text())
            frame = seal(anchor, receipt, args.feed_dir, args.chain, args.feed_url)
            if frame is None:
                print(f"spine tick {anchor['tick']} is already sealed — nothing to do")
                return NOT_DUE
            v = frame["payload"]["views"]
            line = f"frame {frame['seq']} @ spine tick {anchor['tick']}"
            print(f"sealed views {line}: {v['players_sealed']} view(s), {v['presences_seen']} presence(s) seen"
                  + (f", {v['thoughts']} thought(s) costing {v['premium_x100'] / 100:g} premium" if "thoughts" in v else "")
                  + (f", missing {', '.join(frame['payload']['sources_failed'])}" if frame["payload"]["sources_failed"] else ""))
            if args.summary:
                pathlib.Path(args.summary).write_text(line + "\n")
            return 0
        problems = verify(args.chain, args.spine, args.feed, feed_last=args.feed_last)
        for p in problems:
            print("✗ " + p)
        if problems:
            return 1
        print("✓ the views line verifies")
        return 0
    except Refusal as ex:
        print(f"refused: {ex}", file=sys.stderr)
        return 2
    except (urllib.error.URLError, OSError, ValueError, KeyError, LookupError) as ex:
        print(f"could not complete {args.cmd}: {type(ex).__name__}: {ex}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
