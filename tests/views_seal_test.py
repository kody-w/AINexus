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


class Vendored(unittest.TestCase):
    def test_the_reference_tools_are_the_spines_own(self):
        for name, digest in VENDORED.items():
            self.assertEqual(hashlib.sha256((ROOT / "tools" / name).read_bytes()).hexdigest(), digest, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
