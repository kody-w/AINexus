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
    extra = set(v) - need - {"source_commit"}
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
    for q in players:
        if not isinstance(q, dict) or set(q) != {"id", "doing", "sees", "file", "bytes", "sha256"}:
            out.append("a player is not {id, doing, sees, file, bytes, sha256}")
            continue
        if not (isinstance(q["id"], str) and PLAYER_ID.match(q["id"])):
            out.append(f"player id {q['id']!r} is not an id")
            continue
        ids.append(q["id"])
        if not (isinstance(q["doing"], str) and len(q["doing"]) <= 64):
            out.append(f"{q['id']}: doing is not a short string")
        sees = q["sees"]
        if not (isinstance(sees, list) and len(sees) <= MAX_PLAYERS and len(set(sees)) == len(sees)
                and all(isinstance(x, str) and PLAYER_ID.match(x) and x != q["id"] for x in sees)):
            out.append(f"{q['id']}: sees is not a list of other players")
        else:
            seen_total += len(sees)
        f = q["file"]
        parts = f.split("/") if isinstance(f, str) else []
        if not (isinstance(f, str) and len(f) <= 256 and f.startswith(f"segments/{v['segment']}/")
                and all(part not in ("", ".", "..") for part in parts)):
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
    return out


# ── sealing ──────────────────────────────────────────────────────────────────
def build_payload(anchor, receipt, feed_dir, feed_url, head):
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
        sealed.append({"id": pid, "doing": doing[:64], "sees": sees, "file": rel,
                       "bytes": len(data), "sha256": sha256(data)})
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
    payload = build_payload(anchor, receipt, feed_dir, feed_url, head)
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
        held = pruned = 0
        for f in (frames[-feed_last:] if feed_last else frames):
            for q in f["payload"]["views"]["players"]:
                try:
                    if remote:
                        req = urllib.request.Request(base + q["file"], headers={"User-Agent": "ainexus-views-seal"})
                        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                            data = r.read()
                    else:
                        data = (pathlib.Path(base) / q["file"]).read_bytes()
                except (FileNotFoundError, urllib.error.HTTPError) as ex:
                    if isinstance(ex, urllib.error.HTTPError) and ex.code != 404:
                        problems.append(f"frame {f['seq']}: {q['id']}: the feed answered {ex.code}")
                    else:
                        pruned += 1     # rolled out of the feed; the frame still proves its hash
                    continue
                if sha256(data) != q["sha256"] or len(data) != q["bytes"]:
                    problems.append(f"frame {f['seq']}: {q['id']}'s view is not the one sealed")
                else:
                    held += 1
        if not problems:
            log(f"views: {held} held by the feed hash to their frames"
                + (f"; {pruned} have rolled out of the feed" if pruned else ""))
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
