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
        self.assertEqual([q[k].get("clock") for k in ("wanderer", "greeter", "pilgrim", "watcher")],
                         ["Asia/Tokyo", "America/New_York", "Europe/London", None])
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
                 ({"set_at": None, "steps": FX.DEFAULTS["greeter"]}, [{"do": "fly"}], "default routine that is not a routine")]
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
        receipt = self.capture("sleep009", minds={}, resting={},
                               routines={"pilgrim": {"set_at": None, "steps": FX.DEFAULTS["pilgrim"]}})
        pilgrim = next(q for q in receipt["players"] if q["id"] == "pilgrim")
        pilgrim["mind"] = {"kind": "sleep", "why": "asleep: night in London 02:10"}
        pilgrim["routine"] = {"set_at": None, "steps": FX.DEFAULTS["pilgrim"]}
        frame = V.seal(V.read_anchor(str(self.spine)), receipt, self.feed, self.chain)
        q = self.players_of(frame)["pilgrim"]
        self.assertEqual(q["mind"], {"kind": "sleep", "why": "asleep: night in London 02:10"})
        self.assertEqual(q["doing"], "💤 asleep: night in London 02:10")     # asleep is not running the routine
        self.assertEqual(q["routine"]["by"], "default")
        self.assertEqual(self.verify(), [])

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
            "neither a thought, a rest nor a sleep": {"players__1__mind__kind": "dream"},
            "at is not a pose": {"players__2__at__yaw_mrad": 9000},
            "did is not a list of what it did and why": {"players__0__mind__did__0__verb": "<script>"},
            "said is not a short line": {"players__0__mind__said": "x" * 241},
            "evidence is not a file in this tick's segment": {
                "players__0__mind__exchange__file": f"segments/{seg}/../../elsewhere/mind.json"},
            "a thought is not": {"players__0__mind__confidence": 99},
        }
        for why, edits in expect.items():
            with self.subTest(why):
                found = problems(**edits)
                self.assertTrue(any(why in p for p in found), found)
        payload = json.loads(json.dumps(self.frames()[0]["payload"]))
        payload["views"].update(thoughts=0, premium_x100=0)
        self.assertIn("a frame without minds carries a ledger of them", V.shape_problems(payload))


class Vendored(unittest.TestCase):
    def test_the_reference_tools_are_the_spines_own(self):
        for name, digest in VENDORED.items():
            self.assertEqual(hashlib.sha256((ROOT / "tools" / name).read_bytes()).hexdigest(), digest, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
