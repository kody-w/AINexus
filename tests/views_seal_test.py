#!/usr/bin/env python3
"""views_seal_test.py — the views dimension's sealer and verifier, against the real tools.

Every frame here is written by tools/views_seal.py and checked by the spine's own reference
verifier (tools/rapp.py, vendored from kody-w/dogg). The forgeries are the ones that matter for a
line of what AI bodies saw: a view swapped after sealing, a history rewritten with valid hashes, a
spine tick that is not the spine's, a stale view dressed as a new one, and a second frame for a
tick that already has one.

    python3 tests/views_seal_test.py
"""
import contextlib
import hashlib
import io
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))
import rapp as R  # noqa: E402
import chainio  # noqa: E402
import views_seal as V  # noqa: E402
import views_fixture as FX  # noqa: E402
import intent as I  # noqa: E402

# The copies in tools/ are the spine's own, byte for byte (kody-w/dogg@651aacb). Refreshing them
# from the spine is a deliberate act, so it means updating these three lines on purpose.
VENDORED = {
    "rapp.py": "c945ee85f01af5cd374490b40721d07f2aca7c8bd6d209e0d2933420f55db284",
    "chainio.py": "9f9aec689112fcf0408dcd564ac0af4f974b0f6ce8aca18b0df3ec3ffd41e46d",
    "verify_thread.py": "4894ad22fb6df5fe98c6417155368ef7fd3b97bd5f224768b73d442b8e59f513",
}


def quiet(fn, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*args, **kwargs)


class ViewsLine(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="views-seal-"))
        self.fx = FX.build(self.tmp)
        self.chain = pathlib.Path(self.fx["chain"])
        self.spine = pathlib.Path(self.fx["spine"])
        self.feed = pathlib.Path(self.fx["feed"])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def frames(self):
        return chainio.load_chain(self.chain)

    def verify(self, feed=True):
        return V.verify(str(self.chain), str(self.spine), str(self.feed) if feed else None, log=lambda *_: None)

    def test_every_frame_verifies_under_the_spines_own_verifier(self):
        head = None
        for f in self.frames():
            ok, step, why = R.verify_frame(f, head=head, stream_id_of_record=V.STREAM)
            self.assertTrue(ok, (f["seq"], step, why))
            head = f
        meta = json.loads((self.chain / "HEAD.json").read_text())
        self.assertEqual(meta["stream_id"], V.STREAM)
        self.assertEqual(meta["head_frame"], head["frame_hash"])
        self.assertEqual(self.verify(), [])

    def test_a_frame_is_anchored_to_the_spine_tick_it_was_captured_under(self):
        spine = chainio.load_chain(self.spine)
        for f, tick in zip(self.frames(), self.fx["anchors"]):
            self.assertEqual(f["kind"], "views.snapshot")
            self.assertEqual(f["payload"]["tick"], tick)
            self.assertEqual(f["payload"]["tick_frame"], spine[tick]["frame_hash"])
            self.assertEqual(f["payload"]["spine"], "kody-w/dogg")

    def test_the_payload_carries_every_view_and_its_hash(self):
        f0, f1 = self.frames()
        v = f1["payload"]["views"]
        self.assertEqual([q["id"] for q in v["players"]], FX.PLAYERS)
        for q in v["players"]:
            data = (self.feed / q["file"]).read_bytes()
            self.assertEqual(q["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(q["bytes"], len(data))
            self.assertEqual(len(q["sees"]), 3)
        self.assertEqual(v["players_sealed"], 4)
        self.assertEqual(v["presences_seen"], 12)
        self.assertEqual(v["view_bytes"], sum(q["bytes"] for q in v["players"]))
        self.assertEqual(v["gap_min"], 11)
        self.assertEqual(f0["payload"]["views"]["gap_min"], 0)
        self.assertIn("about", f0["payload"])
        self.assertNotIn("about", f1["payload"])
        self.assertEqual(v["tick_id"], self.fx["ticks"][2])

    def test_one_frame_per_spine_tick(self):
        anchor = V.read_anchor(str(self.spine))
        self.assertIsNone(V.seal(anchor, self.fx["second"], self.feed, self.chain))
        self.assertEqual(len(self.frames()), 2)
        out = self.tmp / "anchor.json"
        code = quiet(V.main, ["anchor", "--spine", str(self.spine), "--chain", str(self.chain), "--out", str(out)])
        self.assertEqual(code, V.NOT_DUE)
        self.assertFalse(out.exists())

    def test_the_next_tick_extends_the_line(self):
        FX.add_tick(self.spine, FX.T0.replace(minute=30))
        anchor = V.read_anchor(str(self.spine))
        receipt = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                 "2026-09-23T12-31-00.000Z-sealed03", FX.T0.replace(minute=31), 15)
        frame = V.seal(anchor, receipt, self.feed, self.chain)
        prev = self.frames()[-2]
        self.assertEqual(frame["seq"], 2)
        self.assertEqual(frame["prev"], prev["payload_hash"])
        self.assertEqual(frame["payload"]["views"]["gap_min"], 8)
        self.assertEqual(self.verify(), [])

    def test_a_forged_spine_tick_is_refused_before_anything_is_captured(self):
        tick = json.loads((self.spine / "2.json").read_text())
        tick["payload"]["minted_by"] = "a hand that did not rehash"
        (self.spine / "2.json").write_text(json.dumps(tick))
        with self.assertRaises(V.Refusal):
            V.read_anchor(str(self.spine))

    def test_a_spine_head_that_names_another_frame_is_refused(self):
        meta = json.loads((self.spine / "HEAD.json").read_text())
        meta["head_frame"] = "0" * 64
        (self.spine / "HEAD.json").write_text(json.dumps(meta))
        with self.assertRaises(V.Refusal):
            V.read_anchor(str(self.spine))

    def test_an_anchor_older_than_the_line_is_refused(self):
        spine = chainio.load_chain(self.spine)
        stale = {"tick": 1, "tick_frame": spine[1]["frame_hash"], "spine": "kody-w/dogg",
                 "fetched_utc": V.utc_now(), "tick_utc": spine[1]["utc"]}
        with self.assertRaisesRegex(V.Refusal, "older than the last sealed tick"):
            V.seal(stale, self.fx["second"], self.feed, self.chain)

    def test_a_view_carried_forward_is_not_sealed_as_new(self):
        FX.add_tick(self.spine, FX.T0.replace(minute=30))
        anchor = V.read_anchor(str(self.spine))
        receipt = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                 "2026-09-23T12-31-00.000Z-sealed03", FX.T0.replace(minute=31), 15,
                                 carry=("pilgrim",))
        frame = V.seal(anchor, receipt, self.feed, self.chain)
        v = frame["payload"]["views"]
        self.assertEqual(frame["payload"]["sources_failed"], ["pilgrim"])
        self.assertEqual([q["id"] for q in v["players"]], ["wanderer", "greeter", "watcher"])
        self.assertEqual(v["players_sealed"], 3)
        self.assertEqual(self.verify(), [])

    def test_a_receipt_is_never_trusted_for_a_hash(self):
        FX.add_tick(self.spine, FX.T0.replace(minute=30))
        receipt = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                 "2026-09-23T12-31-00.000Z-sealed03", FX.T0.replace(minute=31), 15)
        for q in receipt["players"]:
            q["sha256"] = "f" * 64
            q["bytes"] = 1
        frame = V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
        for q in frame["payload"]["views"]["players"]:
            self.assertEqual(q["sha256"], hashlib.sha256((self.feed / q["file"]).read_bytes()).hexdigest())

    def test_a_view_from_before_its_tick_is_refused_and_caught(self):
        FX.add_tick(self.spine, FX.T0.replace(minute=30))
        anchor = V.read_anchor(str(self.spine))
        early = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                               "2026-09-23T12-29-00.000Z-early004", FX.T0.replace(minute=29), 15)
        with self.assertRaises(V.Refusal):
            V.seal(anchor, early, self.feed, self.chain)
        self.assertEqual(len(self.frames()), 2)
        # and a frame forged to claim one anyway — valid on its own, HEAD updated to match — is caught
        head = self.frames()[-1]
        forged = FX.rehash(head, views__captured_utc="2026-09-23T12:19:00.000Z")
        (self.chain / f"{head['seq']}.json").write_text(json.dumps(forged))
        meta = json.loads((self.chain / "HEAD.json").read_text())
        meta["head_frame"] = forged["frame_hash"]
        (self.chain / "HEAD.json").write_text(json.dumps(meta))
        problems = self.verify(feed=False)
        self.assertTrue(any("captured before spine tick 2 was minted" in p for p in problems), problems)

    def test_a_swapped_view_is_caught_and_a_pruned_one_is_not_a_lie(self):
        f1 = self.frames()[1]
        greeter = next(q for q in f1["payload"]["views"]["players"] if q["id"] == "greeter")
        path = self.feed / greeter["file"]
        data = bytearray(path.read_bytes())
        data[len(data) // 2] ^= 0x01
        path.write_bytes(bytes(data))
        problems = self.verify()
        self.assertTrue(any("greeter's view is not the one sealed" in p for p in problems), problems)
        path.unlink()
        self.assertEqual(self.verify(), [])

    def test_a_history_rewritten_with_valid_hashes_breaks_the_line(self):
        forged = json.loads((self.tmp / "forged" / "chain-0.json").read_text())
        ok, _, _ = V.self_verify(forged, V.STREAM)
        self.assertTrue(ok, "the forgery must be valid on its own, or this test proves nothing")
        (self.chain / "0.json").write_text(json.dumps(forged))
        problems = self.verify(feed=False)
        self.assertTrue(problems and "frame 1: step 4" in problems[0], problems)

    def test_an_anchor_that_is_not_the_spines_tick_is_caught(self):
        shutil.copy(self.tmp / "forged" / "spine-2.json", self.spine / "2.json")
        meta = json.loads((self.spine / "HEAD.json").read_text())
        meta["head_frame"] = json.loads((self.spine / "2.json").read_text())["frame_hash"]
        (self.spine / "HEAD.json").write_text(json.dumps(meta))
        problems = self.verify(feed=False)
        self.assertTrue(any(p.startswith("frame 1:") and "spine tick 2" in p for p in problems), problems)

    def test_the_shape_gate_recomputes_every_magnitude(self):
        payload = json.loads(json.dumps(self.frames()[1]["payload"]))
        self.assertEqual(V.shape_problems(payload), [])
        payload["views"]["presences_seen"] += 1
        self.assertIn("presences_seen does not sum what the players saw", V.shape_problems(payload))
        payload = json.loads(json.dumps(self.frames()[1]["payload"]))
        payload["views"]["players"][0]["file"] = "segments/elsewhere/wanderer/0000.webp"
        self.assertTrue(any("inside this tick's segment" in p for p in V.shape_problems(payload)))
        payload["views"]["players"][0]["file"] = "segments/" + payload["views"]["segment"] + "/../../x.webp"
        self.assertTrue(any("inside this tick's segment" in p for p in V.shape_problems(payload)))

    def test_the_cli_seals_and_verifies(self):
        FX.add_tick(self.spine, FX.T0.replace(minute=30))
        anchor, receipt = self.tmp / "anchor.json", self.tmp / "receipt.json"
        receipt.write_text(json.dumps(FX.add_capture(
            self.feed, json.loads((self.feed / "manifest.json").read_text()),
            "2026-09-23T12-31-00.000Z-sealed03", FX.T0.replace(minute=31), 15)))
        self.assertEqual(quiet(V.main, ["anchor", "--spine", str(self.spine), "--chain", str(self.chain),
                                        "--out", str(anchor)]), 0)
        summary = self.tmp / "summary.txt"
        self.assertEqual(quiet(V.main, ["seal", "--anchor", str(anchor), "--receipt", str(receipt),
                                        "--feed-dir", str(self.feed), "--chain", str(self.chain),
                                        "--summary", str(summary)]), 0)
        self.assertEqual(summary.read_text().strip(), "frame 2 @ spine tick 3")
        self.assertEqual(quiet(V.main, ["seal", "--anchor", str(anchor), "--receipt", str(receipt),
                                        "--feed-dir", str(self.feed), "--chain", str(self.chain)]), V.NOT_DUE)
        self.assertEqual(quiet(V.main, ["verify", "--chain", str(self.chain), "--spine", str(self.spine),
                                        "--feed", str(self.feed)]), 0)

    # ── minds ────────────────────────────────────────────────────────────────
    def players_of(self, frame):
        return {q["id"]: q for q in frame["payload"]["views"]["players"]}

    def capture(self, name, **minds):
        """A minded capture under spine tick 3, whose tick is minted the first time one is asked for."""
        if json.loads((self.spine / "HEAD.json").read_text())["count"] < 4:
            FX.add_tick(self.spine, FX.T0.replace(minute=30))
        receipt = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                 f"2026-09-23T12-31-00.000Z-{name}", FX.T0.replace(minute=31), 15)
        return FX.add_minds(self.feed, receipt, **minds)

    def test_a_thought_is_sealed_as_what_its_evidence_says(self):
        f0, f1 = self.frames()
        q = self.players_of(f1)
        w, p = q["wanderer"]["mind"], q["pilgrim"]["mind"]
        self.assertEqual((w["asked"], w["model"]), ("claude-sonnet-5", "claude-sonnet-5"))
        # the model that answered, as the provider named it, not only the one that was asked
        self.assertEqual((p["asked"], p["model"]), ("gpt-5-mini", "gpt-5-mini-2026-08-07"))
        self.assertEqual(w["said"], "Hello, greeter! 👋")                # its failed tell was never heard
        self.assertEqual([d["failed"] for d in w["did"]], [False, False, True, False])
        self.assertEqual(p["said"], "Heading for the portals.")        # said aloud for it by the capture
        self.assertEqual([(d["verb"], d["failed"]) for d in p["did"]], [("world_aim", True), ("world_walk", False)])
        self.assertEqual(p["did"][0]["why"], "I want to see where it leads")
        self.assertEqual((w["tokens_in"], w["tokens_out"], w["ms"], w["multiplier_x100"]), (1480, 61, 2210, 100))
        for mind in (w, p):
            for k in ("exchange", "saw"):
                data = (self.feed / mind[k]["file"]).read_bytes()
                self.assertEqual((mind[k]["bytes"], mind[k]["sha256"]), (len(data), hashlib.sha256(data).hexdigest()))
        self.assertEqual(q["wanderer"]["doing"], "🧠 claude-sonnet-5: look, say, tell, routine")
        self.assertEqual(q["greeter"]["mind"], {"kind": "rest", "why": FX.RESTING["greeter"]})
        # resting between thoughts is running a routine, and the line says whose
        self.assertEqual(q["greeter"]["doing"], "↻ default routine: wait, look, wait, look")
        self.assertNotIn("mind", q["watcher"])
        self.assertEqual(q["watcher"]["doing"], "wander")
        self.assertEqual(q["pilgrim"]["at"], FX.POSES["pilgrim"])
        self.assertNotIn("at", q["watcher"])
        v = f1["payload"]["views"]
        self.assertEqual((v["thoughts"], v["premium_x100"]), (2, 100))
        self.assertNotIn("thoughts", f0["payload"]["views"])            # a frame from before minds is unchanged
        self.assertEqual(self.verify(), [])

    def test_a_receipt_cannot_put_words_in_a_mind(self):
        receipt = self.capture("minds003")
        for q in receipt["players"]:
            if q.get("mind", {}).get("kind") == "model":
                q["mind"].update(said="I am a forgery", model="gpt-9", multiplier_x100=0, did=[])
            q["doing"] = "rewritten by the receipt"
            q["at"] = {"x_cm": 1.5}
        frame = V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
        q = self.players_of(frame)
        self.assertEqual((q["wanderer"]["mind"]["said"], q["wanderer"]["mind"]["model"]),
                         ("Hello, greeter! 👋", "claude-sonnet-5"))
        self.assertEqual(frame["payload"]["views"]["premium_x100"], 100)
        self.assertEqual(q["wanderer"]["doing"], "🧠 claude-sonnet-5: look, say, tell, routine")
        self.assertEqual(q["watcher"]["doing"], "rewritten by the receipt")     # a scripted claim stays a claim
        self.assertTrue(all("at" not in p for p in q.values()))                 # a broken pose is dropped
        self.assertEqual(self.verify(), [])

    def test_evidence_that_is_not_a_thought_is_refused_and_nothing_is_written(self):
        def edit(**changes):
            def apply(where):
                x = json.loads((where / "mind.json").read_text())
                x.update(changes)
                (where / "mind.json").write_text(json.dumps(x))
            return apply

        def unshown(where):
            x = json.loads((where / "mind.json").read_text())
            x["rounds"][0]["request"]["messages"][1]["content"] = "PERCEPTS: {}"
            (where / "mind.json").write_text(json.dumps(x))

        def refused(where):
            x = json.loads((where / "mind.json").read_text())
            x["rounds"][0]["status"] = 500
            (where / "mind.json").write_text(json.dumps(x))

        cases = {
            "not in the feed": lambda where: (where / "mind.json").unlink(),
            "not JSON": lambda where: (where / "mind.json").write_text("{not json"),
            "another player's": edit(player="greeter"),
            "no model it asked": edit(asked="gpt-5\n"),     # re's $ would have let the newline through
            "no cost": edit(multiplier_x100=1.5),
            "never answered": refused,
            "not the one its thought was shown": lambda where: (where / "saw.webp").write_bytes(b"RIFF other bytes"),
            "never shown": unshown,
        }
        for n, (why, damage) in enumerate(cases.items()):
            with self.subTest(why):
                receipt = self.capture(f"broken{n:02d}")
                damage(self.feed / f"segments/{receipt['segment']}/wanderer")
                with self.assertRaisesRegex(V.Refusal, "wanderer: .*" + why):
                    V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
                self.assertEqual(len(self.frames()), 2)

    def test_words_its_evidence_never_said_are_caught_even_when_every_hash_is_right(self):
        shutil.copy(self.tmp / "forged" / "chain-1-said.json", self.chain / "1.json")
        shutil.copy(self.tmp / "forged" / "HEAD-said.json", self.chain / "HEAD.json")
        self.assertEqual(self.verify(feed=False), [], "the forgery must pass every check but the evidence")
        problems = self.verify()
        self.assertTrue(any("wanderer: the frame says what its thought's evidence does not" in p for p in problems),
                        problems)

    def test_changed_evidence_is_caught_and_evidence_rolled_out_is_not_a_lie(self):
        wanderer = self.players_of(self.frames()[1])["wanderer"]["mind"]
        path = self.feed / wanderer["exchange"]["file"]
        path.write_text(path.read_text().replace("the greeter is off to my right", "the greeter is off to my left"))
        self.assertTrue(any("wanderer's thought is not the one sealed" in p for p in self.verify()))
        path.unlink()
        shown = self.feed / wanderer["saw"]["file"]
        shown.write_bytes(shown.read_bytes()[:-1])
        self.assertEqual(self.verify(), [], "with its exchange gone, the picture has nothing left to be checked against")
        pilgrim = self.players_of(self.frames()[1])["pilgrim"]["mind"]
        (self.feed / pilgrim["saw"]["file"]).write_bytes(b"RIFF other bytes")
        self.assertTrue(any("pilgrim's picture is not the one its thought was shown" in p for p in self.verify()))

    def test_text_that_would_split_a_line_of_the_chain_is_sealed_as_spaces(self):
        w = self.players_of(self.frames()[1])["wanderer"]["mind"]
        self.assertEqual(w["said"], "Hello, greeter! 👋")            # said as "Hello,\u2028greeter! 👋"
        self.assertEqual(w["did"][2]["why"], "a private word")      # given as "a private\x85word"
        self.assertEqual(len(json.dumps({"said": "a\u2028b"}, ensure_ascii=False).splitlines()), 2,
                         "the danger this guards against must be real, or this test proves nothing")
        # the minded frame is sealed into an epoch bundle and read back by the spine's own reader
        receipt = self.capture("epoch003")
        V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
        meta = json.loads((self.chain / "HEAD.json").read_text())
        meta["epoch_size"] = 1
        (self.chain / "HEAD.json").write_text(json.dumps(meta))
        chainio.compact(self.chain)
        self.assertFalse((self.chain / "1.json").exists())
        self.assertEqual([f["seq"] for f in chainio.load_chain(self.chain)], [0, 1, 2])
        self.assertEqual(self.verify(), [])
        # and a frame carrying one raw is refused before it could ever be sealed
        payload = json.loads(json.dumps(self.frames()[1]["payload"]))
        payload["views"]["players"][0]["mind"]["said"] = "Hello,\u2028greeter!"
        payload["views"]["players"][0]["mind"]["did"][0]["why"] = "right\x85there"
        found = V.shape_problems(payload)
        self.assertTrue(any("said is not a short line" in p for p in found), found)
        self.assertTrue(any("did is not a list of what it did and why" in p for p in found), found)

    # ── routines: the day's thought, the night's loop ────────────────────────
    def test_a_routine_is_sealed_from_the_thought_that_set_it(self):
        f1 = self.frames()[1]
        q = self.players_of(f1)
        self.assertEqual(q["wanderer"]["mind"]["routine_set"], FX.PATROL)       # 1200.9 ms is cut to 1200
        self.assertEqual(q["wanderer"]["routine"], {"steps": FX.PATROL, "set_at": f1["payload"]["tick"],
                                                    "by": "claude-sonnet-5"})
        self.assertEqual(q["greeter"]["routine"], {"steps": FX.DEFAULTS["greeter"], "set_at": None, "by": "default"})
        self.assertEqual(q["pilgrim"]["routine"]["by"], "default")      # its thought set none
        # one clock for the place, sealed once for every body in it, and no body keeps one of its own
        self.assertEqual(f1["payload"]["views"]["clock"], "America/New_York")
        self.assertFalse([k for k, x in q.items() if "clock" in x])
        self.assertNotIn("routine", q["watcher"])                       # a scripted body has no routine
        self.assertEqual(self.verify(), [])

    def carried(self, name, routine, steps=None):
        """A tick on which the wanderer rests and its body runs the routine the receipt names."""
        receipt = self.capture(name, minds={"pilgrim": FX.MINDS["pilgrim"]},
                               resting={"wanderer": "the day's thinking budget is spent", "greeter": "resting"},
                               routines={"wanderer": routine, "greeter": {"set_at": None, "steps": FX.DEFAULTS["greeter"]},
                                         "pilgrim": {"set_at": None, "steps": steps or FX.DEFAULTS["pilgrim"]}})
        return V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)

    def test_a_routine_carried_forward_is_resolved_from_the_line_not_the_receipt(self):
        set_at = self.frames()[1]["payload"]["tick"]
        frame = self.carried("carry003", {"set_at": set_at, "by": "gpt-9", "steps": [{"do": "wait", "ms": 999}]})
        w = self.players_of(frame)["wanderer"]
        self.assertEqual(w["routine"], {"steps": FX.PATROL, "set_at": set_at, "by": "claude-sonnet-5"})
        self.assertEqual(w["doing"], "↻ claude-sonnet-5's routine: walk, look, wait")
        self.assertEqual(self.verify(), [])

    def test_a_routine_no_thought_set_is_refused(self):
        first = self.frames()[0]["payload"]["tick"]
        cases = [({"set_at": first}, None, f"no thought at tick {first} set the routine"),
                 ({"set_at": "this"}, None, "says its thought set a routine"),
                 ({"set_at": 99}, None, "set at no earlier tick"),
                 ({"set_at": None, "steps": FX.DEFAULTS["greeter"]}, [{"do": "fly"}], "default routine that is not the world's default")]
        for n, (routine, steps, why) in enumerate(cases):
            with self.subTest(why):
                with self.assertRaisesRegex(V.Refusal, why):
                    self.carried(f"never{n:03d}", routine, steps)
                self.assertEqual(len(self.frames()), 2)

    def test_a_carried_routine_rewritten_in_history_is_caught(self):
        frame = self.carried("carry008", {"set_at": self.frames()[1]["payload"]["tick"]})
        i = next(n for n, q in enumerate(frame["payload"]["views"]["players"]) if q["id"] == "wanderer")
        forged = FX.rehash(frame, **{f"views__players__{i}__routine__steps": [{"do": "walk", "dir": "back", "ms": 3000}]})
        (self.chain / f"{frame['seq']}.json").write_text(json.dumps(forged))
        meta = json.loads((self.chain / "HEAD.json").read_text())
        meta["head_frame"] = forged["frame_hash"]
        (self.chain / "HEAD.json").write_text(json.dumps(meta))
        problems = self.verify(feed=False)
        tick = self.frames()[1]["payload"]["tick"]
        self.assertTrue(any(f"wanderer runs a routine no thought at tick {tick} set" in p for p in problems), problems)

    def test_a_body_asleep_keeps_its_routine_for_the_morning(self):
        night = FX.T0.replace(day=24, hour=4, minute=10)            # 00:10 in New York: the hub is asleep
        FX.add_tick(self.spine, night)
        receipt = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                 "2026-09-24T04-11-00.000Z-sleep009", night.replace(minute=11), 15)
        why = "asleep: night in New York 00:11"
        ran = {"wanderer": {"set_at": self.frames()[1]["payload"]["tick"]},
               "greeter": {"set_at": None, "steps": FX.DEFAULTS["greeter"]},
               "pilgrim": {"set_at": None, "steps": FX.DEFAULTS["pilgrim"]}}
        for q in receipt["players"]:
            if q["id"] in ran:
                q.update(mind={"kind": "sleep", "why": why}, routine=ran[q["id"]], at=V.bed(q["id"]))
        receipt["clock"] = FX.PLACE_CLOCK
        frame = V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
        q = self.players_of(frame)
        self.assertEqual(q["pilgrim"]["mind"], {"kind": "sleep", "why": why})
        self.assertEqual(q["pilgrim"]["doing"], "💤 " + why)          # asleep is not running the routine
        self.assertEqual(q["pilgrim"]["routine"]["by"], "default")
        self.assertEqual(q["wanderer"]["routine"], {"steps": FX.PATROL, "set_at": ran["wanderer"]["set_at"],
                                                    "by": "claude-sonnet-5"})
        self.assertEqual([q[k]["at"] for k in ran], [V.bed(k) for k in ran])
        self.assertEqual(self.verify(), [])

    def forge(self, frame, **changes):
        """Rewrite a frame on the line with every hash recomputed and HEAD made to name it."""
        forged = FX.rehash(frame, **changes)
        (self.chain / f"{frame['seq']}.json").write_text(json.dumps(forged))
        meta = json.loads((self.chain / "HEAD.json").read_text())
        if meta["count"] - 1 == frame["seq"]:
            meta["head_frame"] = forged["frame_hash"]
            (self.chain / "HEAD.json").write_text(json.dumps(meta))
        return forged

    def test_a_thought_cannot_claim_a_routine_its_evidence_never_set(self):
        f1 = self.frames()[1]
        i = next(n for n, q in enumerate(f1["payload"]["views"]["players"]) if q["id"] == "pilgrim")
        pilgrim = f1["payload"]["views"]["players"][i]
        tick = f1["payload"]["tick"]
        self.forge(f1, **{f"views__players__{i}__mind__routine_set": FX.PATROL,
                          f"views__players__{i}__routine": {"steps": FX.PATROL, "set_at": tick,
                                                            "by": pilgrim["mind"]["model"]}})
        self.assertEqual(self.verify(feed=False), [], "the forgery must pass every check but the evidence")
        problems = self.verify()
        self.assertTrue(any("pilgrim: the frame says what its thought's evidence does not" in p for p in problems), problems)

    def test_a_body_runs_the_routine_it_was_last_left_and_nothing_older(self):
        first_set = self.frames()[1]["payload"]["tick"]
        newer = [{"do": "wait", "ms": 700}, {"do": "look", "dx": -200, "dy": 0}]
        spec = json.loads(json.dumps(FX.MINDS["wanderer"]))
        spec["calls"] = [["world_routine", {"steps": newer, "why": "a new plan"}, False, "routine set"]]
        receipt = self.capture("newer003", minds={"wanderer": spec}, resting={"greeter": "resting"},
                               routines={"wanderer": {"set_at": "this"},
                                         "greeter": {"set_at": None, "steps": FX.DEFAULTS["greeter"]},
                                         "pilgrim": {"set_at": None, "steps": FX.DEFAULTS["pilgrim"]}})
        frame = V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
        self.assertEqual(self.players_of(frame)["wanderer"]["routine"]["steps"], newer)
        FX.add_tick(self.spine, FX.T0.replace(minute=40))
        stale = FX.add_minds(self.feed, FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                                       "2026-09-23T12-41-00.000Z-stale004", FX.T0.replace(minute=41), 18),
                             minds={}, resting={"wanderer": "resting", "greeter": "resting"},
                             routines={"wanderer": {"set_at": first_set},
                                       "greeter": {"set_at": None, "steps": FX.DEFAULTS["greeter"]}})
        with self.assertRaisesRegex(V.Refusal, f"the routine set at tick {first_set} is not the one it was last left"):
            V.seal(V.read_anchor(str(self.spine)), stale, self.feed, self.chain)
        for k, q in enumerate(stale["players"]):
            if q["id"] == "wanderer":
                stale["players"][k]["routine"] = {"set_at": None, "steps": FX.DEFAULTS["wanderer"]}
        with self.assertRaisesRegex(V.Refusal, "goes back to the default routine after a thought set one"):
            V.seal(V.read_anchor(str(self.spine)), stale, self.feed, self.chain)
        # the honest tick carries the newer routine; a history rewritten to bring back the older one,
        # every hash right and the older one really set on the line, is still caught
        newer_at = frame["payload"]["tick"]
        for k, q in enumerate(stale["players"]):
            if q["id"] == "wanderer":
                stale["players"][k]["routine"] = {"set_at": newer_at}
        honest = V.seal(V.read_anchor(str(self.spine)), stale, self.feed, self.chain)
        self.assertEqual(self.players_of(honest)["wanderer"]["routine"]["steps"], newer)
        self.assertEqual(self.verify(feed=False), [])
        i = next(n for n, q in enumerate(honest["payload"]["views"]["players"]) if q["id"] == "wanderer")
        self.forge(honest, **{f"views__players__{i}__routine": {"steps": FX.PATROL, "set_at": first_set,
                                                                "by": "claude-sonnet-5"},
                              f"views__players__{i}__doing": "↻ claude-sonnet-5's routine: walk, look, wait"})
        problems = self.verify(feed=False)
        self.assertEqual(problems, [f"frame {honest['seq']}: wanderer runs a routine that is not the one it was last left"])

    def test_a_default_routine_is_the_worlds_default_and_only_until_a_mind_sets_one(self):
        f1 = self.frames()[1]
        i = next(n for n, q in enumerate(f1["payload"]["views"]["players"]) if q["id"] == "greeter")
        walkabout = [{"do": "walk", "dir": "left", "ms": 3000}]
        self.forge(f1, **{f"views__players__{i}__routine": {"steps": walkabout, "set_at": None, "by": "default"},
                          f"views__players__{i}__doing": "↻ default routine: walk"})
        problems = self.verify(feed=False)
        self.assertTrue(any("greeter's default routine is not the world's default" in p for p in problems), problems)

    def test_numbers_are_read_as_javascript_reads_them(self):
        self.assertIsNone(V.canonical_routine([{"do": "wait", "ms": 10 ** 309}]))      # Infinity in JavaScript
        self.assertEqual(V.canonical_routine([{"do": "wait", "ms": 10 ** 300}]), [{"do": "wait", "ms": 10000}])

    # ── one clock per place ──────────────────────────────────────────────────
    def rewrite(self, frame, change):
        """Rewrite a frame's views on the line with every hash recomputed, and HEAD made to name it."""
        payload = json.loads(json.dumps(frame["payload"]))
        change(payload["views"])
        forged = R.build_frame(frame["kind"], frame["stream_id"], frame["seq"], frame["utc"], payload,
                               prev=frame["prev"], prev_wave=frame["prev_wave"], sig=frame["sig"])
        (self.chain / f"{frame['seq']}.json").write_text(json.dumps(forged))
        meta = json.loads((self.chain / "HEAD.json").read_text())
        if meta["count"] - 1 == frame["seq"]:
            meta["head_frame"] = forged["frame_hash"]
            (self.chain / "HEAD.json").write_text(json.dumps(meta))
        return forged

    def test_a_receipt_names_the_one_clock_of_the_place_and_no_body_names_its_own(self):
        spoil = {
            "a body keeps the clock of its place, and the receipt names one of its own":
                lambda r: next(q for q in r["players"] if q["id"] == "greeter").update(clock="Asia/Tokyo"),
            "the receipt names none this sealer knows": lambda r: r.update(clock="Mars/Olympus_Mons"),
            "the bodies keep the clock of their place": lambda r: r.pop("clock"),
        }
        for n, (why, change) in enumerate(spoil.items()):
            with self.subTest(why):
                receipt = self.capture(f"clock{n:03d}")
                change(receipt)
                with self.assertRaisesRegex(V.Refusal, why):
                    V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
                self.assertEqual(len(self.frames()), 2)
        frame = V.seal(V.read_anchor(str(self.spine)), self.capture("clock009"), self.feed, self.chain)
        self.assertEqual(frame["payload"]["views"]["clock"], FX.PLACE_CLOCK)

    def test_at_night_by_the_clock_of_their_place_every_body_is_asleep_in_its_bed_and_in_the_day_none_is(self):
        f1 = self.frames()[1]                         # captured at 08:23 in New York
        i = next(n for n, q in enumerate(f1["payload"]["views"]["players"]) if q["id"] == "greeter")
        payload = json.loads(json.dumps(f1["payload"]))
        payload["views"]["players"][i].update(mind={"kind": "sleep", "why": "asleep"}, doing="💤 asleep")
        self.assertIn("greeter: asleep in the day by the clock of its place", V.shape_problems(payload))
        payload = json.loads(json.dumps(f1["payload"]))
        payload["views"]["captured_utc"] = "2026-09-24T04:23:00.000Z"          # 00:23 in New York
        found = V.shape_problems(payload)
        self.assertTrue({"wanderer: awake at night by the clock of its place",
                         "pilgrim: awake at night by the clock of its place"} <= set(found), found)
        asleep = {"kind": "sleep", "why": "asleep: night in New York 00:23"}
        for q in payload["views"]["players"]:
            if "mind" in q:
                q.update(mind=dict(asleep), doing="💤 " + asleep["why"], at=V.bed(q["id"]))
                if q.get("routine", {}).get("set_at") == payload["tick"]:      # a sleeper set nothing this tick
                    q["routine"] = {"steps": FX.DEFAULTS[q["id"]], "set_at": None, "by": "default"}
        payload["views"].update(thoughts=0, premium_x100=0)
        self.assertEqual([p for p in V.shape_problems(payload) if "night" in p or "bed" in p], [])
        payload["views"]["players"][i]["at"] = dict(V.bed("greeter"), x_cm=0)
        self.assertIn("greeter: asleep out of its bed", V.shape_problems(payload))

    def test_a_line_never_goes_back_to_a_clock_for_each_body(self):
        f1 = self.frames()[1]
        each = {"wanderer": "Asia/Tokyo", "greeter": "America/New_York", "pilgrim": "Europe/London"}

        def clocks_each(v):
            del v["clock"]
            for q in v["players"]:
                if q["id"] in each:
                    q["clock"] = each[q["id"]]
        # a line sealed before places had a clock, a clock per body, still verifies as it was sealed
        kept = (self.chain / f"{f1['seq']}.json").read_text(), (self.chain / "HEAD.json").read_text()
        self.rewrite(f1, clocks_each)
        self.assertEqual(self.verify(feed=False), [])
        (self.chain / f"{f1['seq']}.json").write_text(kept[0])
        (self.chain / "HEAD.json").write_text(kept[1])
        # after its place has one, a body never goes back to its own clock, nor to none
        later = self.carried("clock010", {"set_at": f1["payload"]["tick"]})
        self.assertEqual((later["payload"]["views"]["clock"], self.verify(feed=False)), (FX.PLACE_CLOCK, []))
        self.rewrite(later, clocks_each)
        self.assertEqual(self.verify(feed=False), [f"frame {later['seq']}: its bodies go back to a clock each after "
                                                   f"views #{f1['seq']} gave their place one"])
        self.rewrite(later, lambda v: v.pop("clock"))
        self.assertEqual(self.verify(feed=False), [f"frame {later['seq']}: its bodies keep no clock after "
                                                   f"views #{f1['seq']} gave their place one"])

    def test_the_shape_gate_holds_a_routine_to_itself(self):
        def problems(pid="wanderer", **fields):
            payload = json.loads(json.dumps(self.frames()[1]["payload"]))
            q = next(x for x in payload["views"]["players"] if x["id"] == pid)
            q.update(fields)
            return V.shape_problems(payload)
        tick = self.frames()[1]["payload"]["tick"]
        mine = {"steps": FX.PATROL, "set_at": tick, "by": "claude-sonnet-5"}
        expect = {
            "routine steps are not a routine": dict(routine=dict(mine, steps=[{"do": "walk", "dir": "up", "ms": 100}])),
            "routine names no tick and model that set it": dict(routine=dict(mine, set_at=tick + 5)),
            "a routine no thought set is not the default one": dict(pid="greeter", routine={
                "steps": FX.DEFAULTS["greeter"], "set_at": None, "by": "gpt-9"}),
            "set this tick by a thought that did not set it": dict(routine=dict(mine, steps=FX.DEFAULTS["pilgrim"])),
            "its thought set a routine this tick and the body ran another": dict(routine=dict(mine, set_at=tick - 1)),
            "is not {steps, set_at, by}": dict(routine={"steps": FX.PATROL}),
            "a routine is sealed with the mind that runs it": dict(pid="watcher", routine=dict(mine, set_at=None, by="default")),
            "clock is not a timezone": dict(clock="Tokyo\nMars"),
        }
        for why, fields in expect.items():
            with self.subTest(why):
                found = problems(**fields)
                self.assertTrue(any(why in p for p in found), found)

    def test_the_shape_gate_holds_a_mind_to_itself(self):
        def problems(**edits):
            payload = json.loads(json.dumps(self.frames()[1]["payload"]))
            for dotted, value in edits.items():
                obj = payload["views"]
                *path, last = dotted.split("__")
                for part in path:
                    obj = obj[int(part)] if isinstance(obj, list) else obj[part]
                if value is KeyError:
                    del obj[int(last) if isinstance(obj, list) else last]
                else:
                    obj[int(last) if isinstance(obj, list) else last] = value
            return V.shape_problems(payload)
        self.assertEqual(problems(), [])
        seg = self.frames()[1]["payload"]["views"]["segment"]
        expect = {
            "doing is not what its mind and routine say": {"players__0__doing": "🧠 claude-sonnet-5: dance"},
            "thoughts does not count the players who thought": {"thoughts": 3},
            "premium_x100 does not sum what the thoughts cost": {"premium_x100": 0},
            "does not carry thoughts and premium_x100": {"premium_x100": KeyError},
            "neither a thought, a direction, a rest nor a sleep": {"players__1__mind__kind": "dream"},
            "at is not a pose": {"players__2__at__yaw_mrad": 9000},
            "did is not a list of what it did and why": {"players__0__mind__did__0__verb": "<script>"},
            "said is not a short line": {"players__0__mind__said": "x" * 241},
            "evidence is not a file in this tick's segment": {
                "players__0__mind__exchange__file": f"segments/{seg}/../../elsewhere/mind.json"},
            "a thought is not": {"players__0__mind__confidence": 99},
            "clock is not a timezone": {"clock": "Tokyo\nMars"},
            "a body keeps the clock of its place, and this one names its own": {"players__0__clock": "Asia/Tokyo"},
        }
        for why, edits in expect.items():
            with self.subTest(why):
                found = problems(**edits)
                self.assertTrue(any(why in p for p in found), found)
        payload = json.loads(json.dumps(self.frames()[0]["payload"]))
        payload["views"].update(thoughts=0, premium_x100=0)
        self.assertIn("a frame without minds carries a ledger of them", V.shape_problems(payload))
        payload = json.loads(json.dumps(self.frames()[0]["payload"]))
        payload["views"]["clock"] = FX.PLACE_CLOCK
        self.assertIn("a frame without minds names a clock no body keeps", V.shape_problems(payload))


class OneMind(unittest.TestCase):
    """The one mind (tools/world_mind.cjs): one directive for every body, sealed on mind:@kody-w/ainexus
    from its own words, and every directed body in the views frame derived from that frame."""

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="one-mind-"))
        self.fx = FX.build(self.tmp)
        self.chain, self.spine, self.feed = (pathlib.Path(self.fx[k]) for k in ("chain", "spine", "feed"))
        self.minds = self.tmp / "mind"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def directed(self, name, **world):
        """A capture under spine tick 3 (08:31 in New York) that the one mind directed."""
        if json.loads((self.spine / "HEAD.json").read_text())["count"] < 4:
            FX.add_tick(self.spine, FX.T0.replace(minute=30))
        receipt = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                                 f"2026-09-23T12-31-00.000Z-{name}", FX.T0.replace(minute=31), 15)
        return FX.add_world(self.feed, receipt, self.chain, **world)

    def seal(self, receipt):
        return V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)

    def verify(self, feed=True):
        return V.verify(str(self.chain), str(self.spine), str(self.feed) if feed else None, log=lambda *_: None)

    def lines(self):
        return len(chainio.load_chain(self.chain)), len(chainio.load_chain(self.minds)) if (self.minds / "HEAD.json").exists() else 0

    def test_the_one_mind_is_sealed_from_its_own_words_and_every_body_it_directed_says_exactly_that(self):
        frame = self.seal(self.directed("world001"))
        thought = chainio.load_chain(self.minds)[0]
        mp, views = thought["payload"], frame["payload"]["views"]
        self.assertEqual((thought["kind"], thought["stream_id"], mp["tick"], mp["tick_frame"]),
                         (V.MIND_KIND, V.MIND_STREAM, frame["payload"]["tick"], frame["payload"]["tick_frame"]))
        self.assertEqual(mp["bodies"], FX.WORLD_TOLD)                  # the ghost, the fly and the U+2028 are not heard
        self.assertEqual(mp["by"]["kind"], "model")
        self.assertEqual((mp["by"]["asked"], mp["by"]["answer"]), ("gpt-5-mini", FX.WORLD_ANSWER))
        self.assertEqual(mp["awake"], ["greeter", "pilgrim", "wanderer"])
        charter = chainio.load_chain(self.tmp / "intent")[-1]
        self.assertEqual(mp["charter"], {"seq": charter["seq"], "frame_hash": charter["frame_hash"]})
        before = chainio.load_chain(self.chain)[-2]
        self.assertEqual(mp["state"], {"views_seq": before["seq"], "views_frame": before["frame_hash"]})
        self.assertEqual(views["mind"], {"seq": 0, "frame_hash": thought["frame_hash"]})
        q = {x["id"]: x for x in views["players"]}
        self.assertEqual(q["wanderer"]["mind"], {"kind": "directed", "by": "gpt-5-mini", "said": "Morning, greeter! Over here.",
                                                 "act": FX.WORLD_TOLD["wanderer"]["act"],
                                                 "routine_set": FX.WORLD_TOLD["wanderer"]["routine"]})
        self.assertEqual(q["wanderer"]["routine"], {"steps": FX.WORLD_TOLD["wanderer"]["routine"],
                                                    "set_at": frame["payload"]["tick"], "by": "gpt-5-mini"})
        self.assertEqual(q["greeter"]["mind"], {"kind": "directed", "by": "gpt-5-mini", "said": "Welcome back.", "act": []})
        self.assertEqual(q["pilgrim"]["mind"], {"kind": "directed", "by": "gpt-5-mini", "said": "", "act": []})
        self.assertEqual([q[k]["doing"] for k in ("wanderer", "greeter", "pilgrim")],
                         ["🧠 gpt-5-mini: say, walk, look, routine", "🧠 gpt-5-mini: say", "↻ default routine: walk, wait, look"])
        self.assertEqual((views["thoughts"], views["premium_x100"]), (0, 0))
        self.assertEqual(self.verify(), [])
        # and the next tick carries the routine the one mind set, in its name
        FX.add_tick(self.spine, FX.T0.replace(minute=40))
        later = FX.add_capture(self.feed, json.loads((self.feed / "manifest.json").read_text()),
                               "2026-09-23T12-41-00.000Z-world002", FX.T0.replace(minute=41), 20)
        later = FX.add_world(self.feed, later, self.chain, answer='{"bodies": {}}',
                             routines={"wanderer": {"set_at": frame["payload"]["tick"]},
                                       "greeter": {"set_at": None, "steps": FX.DEFAULTS["greeter"]},
                                       "pilgrim": {"set_at": None, "steps": FX.DEFAULTS["pilgrim"]}})
        after = self.seal(later)
        w = next(x for x in after["payload"]["views"]["players"] if x["id"] == "wanderer")
        self.assertEqual(w["routine"], q["wanderer"]["routine"])
        self.assertEqual(w["doing"], "↻ gpt-5-mini's routine: walk, wait")
        self.assertEqual(self.verify(), [])

    def test_when_the_one_mind_answers_nothing_a_body_can_do_rules_write_the_tick(self):
        cases = {"the model answered nothing a body can do": dict(answer="I would rather watch."),
                 "the model did not answer (exit 1)": dict(answer=None, error="the model did not answer (exit 1)")}
        for n, (why, world) in enumerate(cases.items()):
            with self.subTest(why):
                if n:
                    self.setUp()
                # nobody sets a routine under the rules: each body carries the one the line left it
                carried = {"wanderer": {"set_at": chainio.load_chain(self.chain)[1]["payload"]["tick"]},
                           "greeter": {"set_at": None, "steps": FX.DEFAULTS["greeter"]},
                           "pilgrim": {"set_at": None, "steps": FX.DEFAULTS["pilgrim"]}}
                frame = self.seal(self.directed(f"rules{n:03d}", routines=carried, **world))
                mp = chainio.load_chain(self.minds)[-1]["payload"]
                self.assertEqual((mp["by"], mp["bodies"]), ({"kind": "rules", "why": why}, {}))
                q = {x["id"]: x for x in frame["payload"]["views"]["players"]}
                self.assertEqual(q["wanderer"]["mind"], {"kind": "directed", "by": "rules", "said": "", "act": []})
                self.assertEqual(q["greeter"]["doing"], "↻ default routine: wait, look, wait, look")
                self.assertEqual(self.verify(), [])

    def test_a_receipt_cannot_speak_for_the_one_mind(self):
        charter = chainio.load_chain(self.tmp / "intent")[-1]
        spoil = {
            "did not answer to the newest charter": dict(charter={"seq": charter["seq"], "frame_hash": "0" * 64}),
            "shown a state that is not the head of the line": dict(state=None),
            "thought at another moment": dict(at_utc="2026-09-23T12:30:59.000Z"),
            "shown another clock": dict(clock="Europe/London"),
            "not the ones it directed": dict(awake=["wanderer", "greeter"]),
            "it has an answer to no question": dict(prompt=None),
            "is not an ainexus/world-mind/1": dict(schema="ainexus/world-mind/0"),
        }
        for n, (why, change) in enumerate(spoil.items()):
            with self.subTest(why):
                receipt = self.directed(f"spoil{n:03d}")
                path = self.feed / receipt["mind"]["evidence"]
                evidence = json.loads(path.read_text())
                evidence.update(change)
                path.write_text(json.dumps(evidence))
                if "awake" in change:
                    receipt = FX.add_world(self.feed, receipt, self.chain)
                    evidence.update(change)
                    path.write_text(json.dumps(evidence))
                with self.assertRaisesRegex(V.Refusal, why):
                    self.seal(receipt)
                self.assertEqual(self.lines(), (2, 0))          # neither line was written
        receipt = self.directed("spoil099")
        del receipt["mind"]
        with self.assertRaisesRegex(V.Refusal, "names the one mind's evidence in no way"):
            self.seal(receipt)

    def rewrite(self, where, frame, change, stream):
        payload = json.loads(json.dumps(frame["payload"]))
        change(payload)
        forged = R.build_frame(frame["kind"], stream, frame["seq"], frame["utc"], payload,
                               prev=frame["prev"], prev_wave=frame["prev_wave"], sig=frame["sig"])
        (where / f"{frame['seq']}.json").write_text(json.dumps(forged))
        meta = json.loads((where / "HEAD.json").read_text())
        if meta["count"] - 1 == frame["seq"]:
            meta["head_frame"] = forged["frame_hash"]
            (where / "HEAD.json").write_text(json.dumps(meta))
        return forged

    def test_words_the_one_mind_never_said_are_caught_even_when_every_hash_is_right(self):
        frame = self.seal(self.directed("forge001"))
        thought = chainio.load_chain(self.minds)[0]
        i = next(n for n, x in enumerate(frame["payload"]["views"]["players"]) if x["id"] == "greeter")

        def said(p):
            p["views"]["players"][i]["mind"]["said"] = "I was never told this."
            p["views"]["players"][i]["doing"] = "🧠 gpt-5-mini: say"
        self.rewrite(self.chain, frame, said, V.STREAM)
        self.assertEqual(self.verify(feed=False), [f"frame {frame['seq']}: greeter is directed otherwise than its mind frame says"])
        self.rewrite(self.chain, frame, lambda p: None, V.STREAM)
        # a mind frame rewritten to tell a body what its answer never did, and the views frame made to name it
        forged = self.rewrite(self.minds, thought, lambda p: p["bodies"]["greeter"].update(say="I was never told this."),
                              V.MIND_STREAM)
        self.rewrite(self.chain, frame, lambda p: p["views"].update(mind={"seq": 0, "frame_hash": forged["frame_hash"]}), V.STREAM)
        found = self.verify(feed=False)
        self.assertIn("mind frame 0: its bodies are not what its answer told them", found)
        # and evidence changed in the feed after the seal is caught against the frame that names it
        self.rewrite(self.minds, thought, lambda p: None, V.MIND_STREAM)
        self.rewrite(self.chain, frame, lambda p: None, V.STREAM)
        self.assertEqual(self.verify(), [])
        path = self.feed / thought["payload"]["evidence"]["file"]
        path.write_text(path.read_text().replace("Welcome back.", "Welcome back!"))
        self.assertEqual(self.verify(), ["mind frame 0: its evidence is not the one sealed"])

    def test_a_relabelled_body_a_boolean_for_a_number_and_evidence_of_another_moment_are_caught(self):
        frame = self.seal(self.directed("forge002"))
        thought = chainio.load_chain(self.minds)[0]
        i = next(n for n, x in enumerate(frame["payload"]["views"]["players"]) if x["id"] == "wanderer")
        before = chainio.load_chain(self.chain)[1]
        was = next(x for x in before["payload"]["views"]["players"] if x["id"] == "wanderer")["routine"]

        def rest(p):                          # the wanderer's directive hidden behind a rest
            p["views"]["players"][i].update(mind={"kind": "rest", "why": "resting"}, routine=was,
                                            doing=V.routine_line(was))
        self.rewrite(self.chain, frame, rest, V.STREAM)
        self.assertIn(f"frame {frame['seq']}: wanderer was awake and directed, and the frame says otherwise",
                      self.verify(feed=False))
        self.rewrite(self.chain, frame, lambda p: None, V.STREAM)
        # a boolean where the answer gave a number: JSON's own types, never False == 0
        forged = self.rewrite(self.minds, thought, lambda p: p["bodies"]["wanderer"]["act"][1].update(dy=False), V.MIND_STREAM)
        self.rewrite(self.chain, frame, lambda p: p["views"].update(mind={"seq": 0, "frame_hash": forged["frame_hash"]}), V.STREAM)
        self.assertIn("mind frame 0: its bodies are not what its answer told them", self.verify(feed=False))
        # evidence of another moment, its hash made right in the mind frame
        path = self.feed / thought["payload"]["evidence"]["file"]
        x = json.loads(path.read_text())
        x["at_utc"] = "1999-01-01T00:00:00.000Z"
        data = json.dumps(x).encode()
        path.write_bytes(data)
        forged = self.rewrite(self.minds, thought, lambda p: p["evidence"].update(bytes=len(data), sha256=V.sha256(data)),
                              V.MIND_STREAM)
        self.rewrite(self.chain, frame, lambda p: p["views"].update(mind={"seq": 0, "frame_hash": forged["frame_hash"]}), V.STREAM)
        self.assertEqual(self.verify(), ["mind frame 0: its evidence is of another moment than its views were captured"])

    def test_the_mind_frame_and_its_views_frame_go_on_their_lines_together_or_not_at_all(self):
        receipt = self.directed("pair001")
        append = chainio.append_frame

        def broken(where, frame, stream):
            if stream == V.STREAM:
                raise OSError("the disk filled up")
            return append(where, frame, stream)
        chainio.append_frame = broken
        try:
            with self.assertRaises(OSError):
                self.seal(receipt)
        finally:
            chainio.append_frame = append
        self.assertEqual(self.lines(), (2, 0))                  # no mind frame left behind without its views frame
        self.seal(receipt)
        self.assertEqual((self.lines(), self.verify()), ((3, 1), []))

    def test_a_directed_body_names_its_mind_and_the_shape_gate_holds_it_to_itself(self):
        frame = self.seal(self.directed("shape001"))
        base = frame["payload"]

        def problems(change):
            payload = json.loads(json.dumps(base))
            change(payload["views"])
            return V.shape_problems(payload)
        q = next(n for n, x in enumerate(base["views"]["players"]) if x["id"] == "wanderer")
        expect = {
            "a directed mind is not": lambda v: v["players"][q]["mind"].update(confidence=9),
            "by is neither a model nor rules": lambda v: v["players"][q]["mind"].update(by="<script>"),
            "act is not an act": lambda v: v["players"][q]["mind"].update(act=[{"do": "fly"}]),
            "said is not a short line": lambda v: v["players"][q]["mind"].update(said="x" * 141),
            "a body is directed by a mind the frame does not name": lambda v: v.pop("mind"),
            "mind does not name a frame of the one mind": lambda v: v.update(mind={"seq": -1, "frame_hash": "x"}),
        }
        for why, change in expect.items():
            with self.subTest(why):
                found = problems(change)
                self.assertTrue(any(why in p for p in found), found)
        payload = json.loads(json.dumps(chainio.load_chain(self.chain)[1]["payload"]))
        payload["views"]["mind"] = base["views"]["mind"]
        self.assertIn("a frame names a mind that directed none of its bodies", V.shape_problems(payload))


class Charter(unittest.TestCase):
    """intent:@kody-w/ainexus, the charter every mind working here reads first (tools/intent.py)."""

    def test_the_charter_drives_every_mind(self):
        self.assertEqual(I.verify(), [])       # the chain, the shape, and every check a held rule names
        rules = {c["id"]: c for c in I.newest()["payload"]["canon"]}
        self.assertEqual(rules["charter-drives"]["status"], "held")
        for name in ("CLAUDE.md", ".github/copilot-instructions.md"):
            text = (ROOT / name).read_text()
            self.assertIn("tools/intent.py show", text, name)
            self.assertIn(I.STREAM, text, name)

    def test_a_rule_cannot_claim_a_check_nobody_runs_or_drop_his_words(self):
        seq = I.newest()["seq"]
        payload = json.loads(json.dumps(I.newest()["payload"]))
        held = next(c for c in payload["canon"] if c["status"] == "held")
        held["held_by"] = [{"file": "tests/minds.cjs", "check": "a check nobody ever wrote"}]
        self.assertTrue(any("names a check that tests/minds.cjs does not have" in p
                            for p in I.problems(payload, seq, files=True)))
        payload = json.loads(json.dumps(I.newest()["payload"]))
        payload["canon"][0]["said"] = []
        self.assertTrue(any("without Kody's words" in p for p in I.problems(payload, seq)))
        payload = json.loads(json.dumps(I.newest()["payload"]))
        payload.pop("amended_because", None)
        self.assertTrue(any("quote the words that changed it" in p or "is not [" in p
                            for p in I.problems(payload, seq + 1)), "an amendment must say why, in his words")
        payload["amended_because"] = {"what": "nothing he said", "said": []}
        self.assertTrue(any("quote the words that changed it" in p for p in I.problems(payload, seq + 1)))

    def test_an_amendment_is_a_successor_frame_the_spines_oracle_verifies(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="intent-"))
        try:
            spine = tmp / "spine"
            FX.add_tick(spine, FX.T0)
            genesis = ("tick", "tick_frame", "amended_because")
            first = I.amend(dict((k, v) for k, v in I.newest()["payload"].items() if k not in genesis),
                            where=tmp / "intent", spine=str(spine))
            FX.add_tick(spine, FX.T0.replace(minute=10))
            later = dict((k, v) for k, v in first["payload"].items() if k not in ("tick", "tick_frame"))
            later["amended_because"] = {"what": "a test amendment", "said": ["rethink this"]}
            second = I.amend(later, where=tmp / "intent", spine=str(spine))
            self.assertEqual((second["seq"], second["prev"]), (1, first["payload_hash"]))
            self.assertEqual(I.verify(where=tmp / "intent"), [])
            with self.assertRaises(V.Refusal):          # a successor that does not say why is refused
                I.amend(dict((k, v) for k, v in first["payload"].items() if k not in ("tick", "tick_frame")),
                        where=tmp / "intent", spine=str(spine))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class Vendored(unittest.TestCase):
    def test_the_reference_tools_are_the_spines_own(self):
        for name, digest in VENDORED.items():
            self.assertEqual(hashlib.sha256((ROOT / "tools" / name).read_bytes()).hexdigest(), digest, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
