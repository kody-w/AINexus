#!/usr/bin/env python3
"""dream_test.py — the day folds once, and a dream says only what its evidence says.

Real fixture ticks, views sealed by the real sealer, and an amended fixture charter. The mind is
an executable that answers locally; no test needs a seat or a network. Every forgery is rehashed
and re-appended, so the spine's own oracle accepts the chain before the dream verifier refuses it.
All scratch work stays inside this worktree and is removed by the tests.

    /usr/bin/python3 tests/dream_test.py
    python3 -m pytest -q tests/dream_test.py
"""
import contextlib
import datetime
import hashlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))
import rapp as R  # noqa: E402
import chainio  # noqa: E402
import views_seal as V  # noqa: E402
import views_fixture as FX  # noqa: E402
import intent as I  # noqa: E402
import dream as D  # noqa: E402

PYTHON = "/usr/bin/python3"
FIRST_NIGHT = FX.T0 + datetime.timedelta(hours=15, minutes=30)
SECOND_NIGHT = FIRST_NIGHT + datetime.timedelta(days=1)
ANSWER = json.dumps({
    "text": "The portals became a quiet circle; we carried our greetings home. ✨",
    "lines": {pid: f"I dreamed the portals kept a place for me, the {pid}." for pid in FX.PLAYERS},
    "memory": "We met by the portals. The wanderer greeted the greeter; the pilgrim kept moving.",
}, ensure_ascii=False)


def quiet(fn, *args, **kwargs):
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        return fn(*args, **kwargs)


def ref(frame):
    return {"seq": frame["seq"], "frame_hash": frame["frame_hash"]} if frame else None


def prompt_ref(prompt):
    data = prompt.encode("utf-8")
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def snapshot(where):
    return {str(p.relative_to(where)): p.read_bytes() for p in where.rglob("*") if p.is_file()}


class Workspace(unittest.TestCase):
    def setUp(self):
        self.work = pathlib.Path(os.path.relpath(ROOT)) / (".dream-test-" + uuid.uuid4().hex)
        self.work.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, self.work)


class DreamLine(Workspace):
    def setUp(self):
        super().setUp()
        self.fx = FX.build(self.work)
        self.views = pathlib.Path(self.fx["chain"])
        self.spine = pathlib.Path(self.fx["spine"])
        self.feed = pathlib.Path(self.fx["feed"])
        # the fixture's own charter, anchored to its spine (tests/views_fixture.py)
        self.chain, self.intent = self.work / "dream", self.work / "intent"
        self.charter = I.newest(self.intent)
        self.day_anchor = V.read_anchor(str(self.spine))
        self.copilot = self.fake_copilot()

    def fake_copilot(self, answer=ANSWER, code=0, error="", wait=0):
        path = self.work / ("fake copilot " + uuid.uuid4().hex)
        record = str((self.work / "calls.jsonl").resolve())
        path.write_text(
            "#!/usr/bin/python3\nimport json, os, sys, time\n"
            f"with open({record!r}, 'a', encoding='utf-8') as record:\n"
            "    record.write(json.dumps({'argv': sys.argv[1:], 'cwd': os.getcwd(), "
            "'path': os.environ['PATH']}) + '\\n')\n"
            f"time.sleep({wait!r})\nsys.stdout.write({answer!r})\nsys.stderr.write({error!r})\n"
            f"sys.exit({code!r})\n", encoding="utf-8")
        path.chmod(0o700)
        return path

    def calls(self):
        path = self.work / "calls.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def at(self, when=FIRST_NIGHT):
        FX.add_tick(self.spine, when)
        return V.read_anchor(str(self.spine))

    def capture(self, when, asleep=False, poses=None):
        anchor = self.at(when)
        manifest = json.loads((self.feed / "manifest.json").read_text())
        receipt = FX.add_capture(
            self.feed, manifest, f"dream-view-{anchor['tick']}",
            when + datetime.timedelta(minutes=1), 15)
        FX.add_minds(self.feed, receipt, minds={}, resting={pid: "between frames" for pid in FX.PLAYERS},
                     poses=FX.POSES if poses is None else poses, routines={})
        if asleep:                    # at night by the clock of their place: every body asleep in its bed
            for q in receipt["players"]:
                q["mind"] = {"kind": "sleep", "why": "asleep in bed"}
                q["at"] = V.bed(q["id"])
        return V.seal(anchor, receipt, self.feed, self.views)

    def seal(self, anchor=None, **options):
        args = {"chain": self.chain, "views": self.views, "intent": self.intent, "copilot": self.copilot}
        args.update(options)
        return D.dream(anchor or V.read_anchor(str(self.spine)), **args)

    def frames(self):
        return chainio.load_chain(self.chain)

    def verify(self):
        return D.verify(self.chain, self.views, self.intent, self.spine, log=lambda *_: None)

    def two_nights(self, rules=False):
        self.at()
        first = self.seal(rules_only=rules)
        self.capture(FX.T0 + datetime.timedelta(days=1), poses=FX.POSES)
        self.capture(FX.T0 + datetime.timedelta(days=1, minutes=10), poses=FX.LATER_POSES)
        self.at(SECOND_NIGHT)
        return first, self.seal(rules_only=rules)

    def amend(self):
        payload = {k: v for k, v in I.newest(self.intent)["payload"].items() if k not in ("tick", "tick_frame")}
        payload["amended_because"] = {"what": "a fixture amendment", "said": ["remember what mattered today"]}
        return I.amend(payload, where=self.intent, spine=str(self.spine))

    def oracle(self, where=None):
        where = self.chain if where is None else where
        frames, head = chainio.load_chain(where), None
        for frame in frames:
            ok, step, why = R.verify_frame(frame, head=head, stream_id_of_record=D.STREAM)
            self.assertTrue(ok, (frame["seq"], step, why))
            head = frame
        meta = json.loads((where / "HEAD.json").read_text())
        self.assertEqual((meta["count"], meta["stream_id"], meta["head_frame"]),
                         (len(frames), D.STREAM, head["frame_hash"]))

    def forge(self, frames=None, index=-1, **changes):
        originals = self.frames() if frames is None else frames
        changed = FX.rehash(originals[index], **changes)
        self.chain = self.work / ("dream-forgery-" + uuid.uuid4().hex)
        head = None
        for original in originals:
            f = changed if original["seq"] == changed["seq"] else original
            frame = R.build_frame(f["kind"], f["stream_id"], f["seq"], f["utc"], f["payload"],
                                  prev=head["payload_hash"] if head else None, prev_wave=f["prev_wave"], sig=f["sig"])
            chainio.append_frame(self.chain, frame, D.STREAM)
            head = frame
        self.oracle()
        return head

    def retell(self, frame, **fields):
        """Let a forger fix all derived fields, leaving only the history claim under test."""
        p = json.loads(json.dumps(frame["payload"]))
        p.update(fields)
        views = chainio.load_chain(self.views)[p["folded"]["from"]:p["folded"]["to"] + 1]
        p["folded"], p["day"] = D._folded(views), D.digest(views)
        head = self.frames()[frame["seq"] - 1] if frame["seq"] else None
        previous = head["payload"] if head else None
        charter = next(f for f in reversed(I.chain(self.intent)) if f["payload"]["tick"] <= p["tick"])
        prompt = D.build_prompt(charter, previous, p["folded"], p["day"], p["night"], p["clock"])
        p["by"]["prompt"] = prompt_ref(prompt)
        p["dream"] = (D.derive(p["by"]["answer"], p["day"]["bodies"], p["day"], p["folded"], previous, p["night"])
                      if p["by"]["kind"] == "model" else D.rules(p["day"], p["folded"], previous, p["night"]))
        return p

    def paths(self):
        return ["--chain", str(self.chain.resolve()), "--views", str(self.views.resolve()),
                "--intent", str(self.intent.resolve())]

    def dream_args(self, anchor=None):
        path = self.work / "anchor.json"
        path.write_text(json.dumps(anchor or V.read_anchor(str(self.spine))))
        return ["dream", "--anchor", str(path.resolve())] + self.paths()

    def cli(self, args, **env):
        return subprocess.run([PYTHON, "tools/dream.py"] + args, cwd=ROOT, capture_output=True, text=True,
                              timeout=60, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1", **env))

    def assert_problem(self, sentence):
        problems = self.verify()
        self.assertTrue(any(sentence in p for p in problems), problems)

    def test_each_night_folds_every_new_view_once_and_remembers_the_previous_dream(self):
        first, second = self.two_nights()
        a, b = first["payload"], second["payload"]
        views = chainio.load_chain(self.views)
        self.assertEqual((a["night"], b["night"]), ("2026-09-23", "2026-09-24"))
        self.assertEqual((a["folded"]["from"], a["folded"]["to"], a["folded"]["frames"]), (0, 1, 2))
        self.assertEqual((b["folded"]["from"], b["folded"]["to"], b["folded"]["frames"]), (2, 3, 2))
        self.assertEqual(a["remembered"], None)
        self.assertEqual(b["remembered"], ref(first))
        self.assertEqual(second["prev"], first["payload_hash"])
        self.assertEqual(a["charter"], ref(self.charter))
        self.assertIn("about", a)
        self.assertNotIn("about", b)
        self.assertEqual(set(a) - {"about"}, set(b))
        self.assertEqual(sum(f["payload"]["folded"]["frames"] for f in self.frames()), len(views))
        for frame in (first, second):
            p, f = frame["payload"], frame["payload"]["folded"]
            folded = views[f["from"]:f["to"] + 1]
            root = hashlib.sha256("\n".join(v["frame_hash"] for v in folded).encode()).hexdigest()
            self.assertEqual(f["root"], root)
            self.assertEqual((f["first_tick"], f["last_tick"]), tuple(v["payload"]["tick"] for v in (folded[0], folded[-1])))
            self.assertEqual((f["first_utc"], f["last_utc"]),
                             tuple(v["payload"]["views"]["captured_utc"] for v in (folded[0], folded[-1])))
            self.assertEqual(p["day"], D.digest(folded))
        self.assertEqual(b["day"]["bodies"]["wanderer"]["walked_m"], 23)
        prompt = D.build_prompt(self.charter, a, b["folded"], b["day"], b["night"], b["clock"])
        self.assertIn(a["dream"]["memory"], prompt)
        self.assertIn(a["dream"]["text"], prompt)
        self.assertEqual(b["by"]["prompt"], prompt_ref(prompt))
        self.oracle()
        self.assertEqual(self.verify(), [])

    def test_daylight_is_not_due_and_the_real_cli_writes_no_dream_cache_or_summary(self):
        summary, cache = self.work / "summary.txt", self.work / "cache.json"
        result = self.cli(self.dream_args() + ["--summary", str(summary.resolve()), "--cache", str(cache.resolve()),
                                              "--copilot", str(self.copilot.resolve())])
        self.assertEqual(result.returncode, V.NOT_DUE, result.stderr + result.stdout)
        self.assertFalse(self.chain.exists())
        self.assertFalse(summary.exists())
        self.assertFalse(cache.exists())
        self.assertEqual(self.calls(), [])

    def test_a_second_tick_in_the_same_night_is_not_a_second_dream_even_with_new_views(self):
        self.at()
        self.seal()
        self.capture(FIRST_NIGHT + datetime.timedelta(minutes=10), asleep=True)
        before = snapshot(self.chain)
        args = self.dream_args() + ["--copilot", str(self.copilot.resolve())]
        self.assertEqual(quiet(D.main, args), V.NOT_DUE)
        self.assertEqual(snapshot(self.chain), before)
        self.assertEqual(len(self.calls()), 1)

    def test_another_night_with_nothing_new_to_fold_writes_nothing(self):
        self.at()
        self.seal()
        self.at(SECOND_NIGHT)
        before = snapshot(self.chain)
        self.assertEqual(quiet(D.main, self.dream_args()), V.NOT_DUE)
        self.assertEqual(snapshot(self.chain), before)
        self.assertEqual(len(self.calls()), 1)

    def test_the_first_dream_needs_at_least_one_view(self):
        self.at()
        self.views = self.work / "no-views"
        self.assertEqual(quiet(D.main, self.dream_args()), V.NOT_DUE)
        self.assertFalse(self.views.exists())
        self.assertFalse(self.chain.exists())
        self.assertEqual(self.calls(), [])

    def test_the_models_answer_is_the_evidence_and_a_missing_body_line_uses_only_its_rules_line(self):
        self.at()
        obj = json.loads(ANSWER)
        del obj["lines"]["watcher"]
        obj["lines"]["nobody"] = "I must not become a body."
        raw = "```json\n" + json.dumps(obj, ensure_ascii=False) + "\n```"
        p = self.seal(copilot=self.fake_copilot(raw))["payload"]
        self.assertEqual(p["by"]["answer"], raw)
        self.assertEqual((p["by"]["kind"], p["by"]["provider"], p["by"]["asked"]),
                         ("model", "github-copilot", "gpt-5-mini"))
        self.assertTrue(V.isint(p["by"]["ms"]) and p["by"]["ms"] >= 0)
        self.assertEqual(p["dream"], D.derive(raw, p["day"]["bodies"], p["day"], p["folded"], None, p["night"]))
        self.assertEqual(p["dream"]["text"], obj["text"])
        self.assertEqual(p["dream"]["lines"]["wanderer"], obj["lines"]["wanderer"])
        self.assertEqual(p["dream"]["lines"]["watcher"],
                         "I dreamed I walked 0 m and kept seeing the greeter.")
        self.assertEqual(set(p["dream"]["lines"]), set(FX.PLAYERS))
        self.assertEqual(self.verify(), [])

    def test_failed_non_json_oversized_and_textless_answers_become_rules_and_say_why(self):
        self.at()
        cases = [
            (ANSWER, 1, "no seat", "copilot exited 1: no seat"),
            ("there are no portals in this JSON", 0, "", "no JSON object"),
            ("x" * (D.MAX_ANSWER + 1), 0, "", "exceeded 4000"),
            ('{"memory":"no dream text"}', 0, "", "no dream text"),
            ('{"text":" \\t "}', 0, "", "no dream text"),
            ("  \n", 0, "", "no answer"),
            ('{"text":"a dream","extra":NaN}', 0, "", "not a JSON object"),
        ]
        for i, (answer, code, error, why) in enumerate(cases):
            with self.subTest(why):
                self.chain = self.work / f"rules-{i}"
                p = self.seal(copilot=self.fake_copilot(answer, code, error))["payload"]
                self.assertEqual(p["by"]["kind"], "rules")
                self.assertIn(why, p["by"]["why"])
                self.assertLessEqual(len(p["by"]["why"]), 160)
                self.assertNotIn("answer", p["by"])
                self.assertEqual(p["dream"], D.rules(p["day"], p["folded"], None, p["night"]))
                self.assertEqual(self.verify(), [])

    def test_asked_for_rules_never_calls_the_mind_or_reads_the_cache(self):
        self.at()
        cache = self.work / "broken-cache.json"
        cache.write_text("not JSON")
        with mock.patch.object(D, "ask", side_effect=AssertionError("rules must not ask")):
            code = quiet(D.main, self.dream_args() + ["--rules", "--cache", str(cache.resolve()),
                                                     "--copilot", str((self.work / "missing-copilot").resolve())])
        self.assertEqual(code, 0)
        p = self.frames()[0]["payload"]
        self.assertEqual(p["by"]["why"], "asked for a rules dream")
        self.assertEqual(cache.read_text(), "not JSON")
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.verify(), [])

    def test_a_cached_answer_survives_a_failed_append_and_a_retry_never_asks_twice(self):
        self.at()
        cache = self.work / "cache.json"
        with mock.patch.object(chainio, "append_frame", side_effect=OSError("append interrupted")):
            with self.assertRaisesRegex(OSError, "append interrupted"):
                self.seal(cache=cache)
        self.assertEqual(self.frames(), [])
        self.assertEqual(len(self.calls()), 1)
        saved = json.loads(cache.read_text())
        self.assertEqual(len(saved), 1)
        with mock.patch.object(D, "ask", side_effect=AssertionError("a retry asked twice")):
            p = self.seal(cache=cache)["payload"]
        self.assertEqual(saved[p["by"]["prompt"]["sha256"]],
                         {"answer": p["by"]["answer"], "ms": p["by"]["ms"], "error": None})
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.verify(), [])

    def test_a_failure_is_not_cached_but_a_real_unusable_reply_is(self):
        self.at()
        cache = self.work / "cache.json"
        failed = self.fake_copilot("not an answer", 1, "offline")
        with mock.patch.object(chainio, "append_frame", side_effect=OSError("append interrupted")):
            with self.assertRaises(OSError):
                self.seal(copilot=failed, cache=cache)
        self.assertFalse(cache.exists())
        with mock.patch.object(chainio, "append_frame", side_effect=OSError("append interrupted")):
            with self.assertRaises(OSError):
                self.seal(copilot=self.fake_copilot("I answered, but not with JSON."), cache=cache)
        self.assertEqual(len(self.calls()), 2)
        with mock.patch.object(D, "ask", side_effect=AssertionError("a reply was already cached")):
            p = self.seal(cache=cache)["payload"]
        self.assertEqual(p["by"]["kind"], "rules")
        self.assertIn("no JSON object", p["by"]["why"])
        self.assertEqual(len(self.calls()), 2)
        self.assertEqual(self.verify(), [])

    def test_the_mind_gets_no_tools_a_fixed_path_and_a_fresh_directory_that_is_removed(self):
        prompt = "A tiny dream, please."
        result = D.ask(prompt, "gpt-5-mini", self.copilot)
        self.assertEqual(result["answer"], ANSWER)
        self.assertIsNone(result["error"])
        self.assertTrue(V.isint(result["ms"]) and result["ms"] >= 0)
        call = self.calls()[0]
        self.assertEqual(call["argv"], [
            "-p", prompt, "--model", "gpt-5-mini", "-s", "--no-custom-instructions", "--no-ask-user",
            "--no-auto-update", "--no-color", "--disable-builtin-mcps", "--available-tools="])
        self.assertEqual(call["path"], "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        work = pathlib.Path(call["cwd"]).resolve()
        self.assertFalse(work.is_relative_to(ROOT.resolve()))      # no repo's instructions or files around it
        self.assertFalse(work.exists())
        D.ask(prompt, "gpt-5-mini", self.copilot)
        self.assertNotEqual(self.calls()[1]["cwd"], call["cwd"])

    def test_a_timeout_missing_binary_or_failed_process_returns_no_answer_and_cleans_up(self):
        spare = pathlib.Path(tempfile.gettempdir())
        before = set(spare.glob("dream-ask-*"))
        cases = [
            (self.work / "missing", 1, "could not run copilot"),
            (self.fake_copilot(wait=2), 0.1, "timed out"),
            (self.fake_copilot(ANSWER, 1, "failure " * 100), 1, "exited 1"),
        ]
        for copilot, timeout, why in cases:
            with self.subTest(why):
                result = D.ask("dream", D.MODEL, copilot, timeout=timeout)
                self.assertIsNone(result["answer"])
                self.assertIn(why, result["error"])
                self.assertLessEqual(len(result["error"]), 160)
                self.assertTrue(V.isint(result["ms"]))
                self.assertEqual(set(spare.glob("dream-ask-*")), before)

    def test_raw_epoch_separators_use_rules_but_json_escaped_unicode_is_derived_and_sealed(self):
        self.at()
        raw = json.dumps({"text": "a\u2028dream"}, ensure_ascii=False)
        p = self.seal(copilot=self.fake_copilot(raw))["payload"]
        self.assertEqual(p["by"]["kind"], "rules")
        self.assertIn("sealed epoch", p["by"]["why"])
        self.assertEqual(self.verify(), [])
        self.chain = self.work / "escaped-dream"
        raw = json.dumps({"text": "a\u2028dream \ud800", "lines": {"wanderer": "I\u0085remember."}})
        p = self.seal(copilot=self.fake_copilot(raw))["payload"]
        self.assertEqual(p["by"]["answer"], raw)
        self.assertEqual(p["dream"]["text"], "a dream \ufffd")
        self.assertEqual(p["dream"]["lines"]["wanderer"], "I remember.")
        self.assertEqual(self.verify(), [])

    def test_the_charter_is_the_newest_one_at_the_dreams_tick_not_a_future_amendment(self):
        self.at()
        newest = self.amend()
        first = self.seal()
        self.assertEqual(first["payload"]["charter"], ref(newest))
        self.capture(FX.T0 + datetime.timedelta(days=1))
        future = self.amend()
        self.assertEqual(self.verify(), [])
        self.at(SECOND_NIGHT)
        second = self.seal()
        self.assertEqual(second["payload"]["charter"], ref(future))
        prompt = self.calls()[0]["argv"][1]
        self.assertIn(I.show(newest), prompt)
        self.assertIn("nothing yet: this is the first dream", prompt)
        self.assertEqual(first["payload"]["by"]["prompt"], prompt_ref(prompt))
        self.assertGreater(len(prompt.encode("utf-8")), len(prompt))
        self.assertEqual(self.verify(), [])

    def test_a_dream_cannot_use_a_charter_that_did_not_exist_at_its_tick(self):
        anchor = self.at()
        self.at(FX.T0 + datetime.timedelta(days=1))
        future_intent = self.work / "future-intent"
        payload = {k: v for k, v in self.charter["payload"].items() if k not in ("tick", "tick_frame")}
        I.amend(payload, where=future_intent, spine=str(self.spine))
        with self.assertRaisesRegex(V.Refusal, "no charter at or before"):
            self.seal(anchor, intent=future_intent)
        self.assertFalse(self.chain.exists())
        self.assertEqual(self.calls(), [])

    def test_a_wall_clock_that_moves_back_never_moves_the_frame_clock_back(self):
        self.at()
        first = self.seal(rules_only=True)
        self.capture(FX.T0 + datetime.timedelta(days=1))
        self.at(SECOND_NIGHT)
        with mock.patch.object(V, "utc_now", return_value="2000-01-01T00:00:00.000Z"):
            second = self.seal(rules_only=True)
        self.assertEqual(second["utc"], first["utc"])
        self.oracle()
        self.assertEqual(self.verify(), [])

    def test_sealed_epochs_and_https_readers_verify_the_same_dreams_offline(self):
        self.at()
        self.seal()
        self.capture(FX.T0 + datetime.timedelta(days=1))
        self.amend()
        self.at(SECOND_NIGHT)
        self.seal()
        places = {"dream": self.chain, "views": self.views, "intent": self.intent, "spine": self.spine}
        for path in places.values():
            meta = json.loads((path / "HEAD.json").read_text())
            meta["epoch_size"] = 1
            (path / "HEAD.json").write_text(json.dumps(meta))
            chainio.compact(path)
            self.assertTrue((path / "epochs/0.jsonl").exists())
        self.oracle()
        self.assertEqual(self.verify(), [])
        urls = {"https://fixtures.invalid/" + name + "/": path for name, path in places.items()}
        reads, original = [], V.Chain.read

        def read(src, rel, fresh=False):
            if src.remote:
                reads.append((src.where, rel))
                return (urls[src.where] / rel).read_bytes()
            return original(src, rel, fresh)

        with mock.patch.object(V.Chain, "read", new=read):
            problems = D.verify("https://fixtures.invalid/dream/", "https://fixtures.invalid/views/",
                                "https://fixtures.invalid/intent/", "https://fixtures.invalid/spine/",
                                log=lambda *_: None)
        self.assertEqual(problems, [])
        for url in urls:
            self.assertTrue(any(place == url and rel.startswith("epochs/") for place, rel in reads), reads)

    def test_the_real_system_python_cli_seals_verifies_and_shows_the_dream(self):
        self.at()
        summary = self.work / "summary.txt"
        result = self.cli(self.dream_args() + [
            "--copilot", str(self.copilot.resolve()), "--model", "fixture-model",
            "--clock", "UTC", "--summary", str(summary.resolve())])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        line = "dream 0 · night 2026-09-23 · folded views 0–1 (2 frames) · by fixture-model"
        self.assertEqual(summary.read_text(), line + "\n")
        self.assertIn("sealed " + line, result.stdout)
        p = self.frames()[0]["payload"]
        self.assertEqual((p["clock"], p["by"]["asked"]), ("UTC", "fixture-model"))
        result = self.cli(["verify"] + self.paths() + ["--spine", str(self.spine.resolve())])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("✓ the dream line verifies", result.stdout)
        result = self.cli(["show", "--chain", str(self.chain.resolve())])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for text in (line, p["dream"]["text"], p["dream"]["memory"], "MORNING", "MEMORY"):
            self.assertIn(text, result.stdout)
        for pid, text in p["dream"]["lines"].items():
            self.assertIn(f"{pid}: {text}", result.stdout)
        self.oracle()

    def test_the_cli_uses_the_copilot_environment_override(self):
        self.at()
        result = self.cli(self.dream_args(), NEXUS_COPILOT=str(self.copilot.resolve()))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(self.calls()), 1)
        self.assertEqual(self.verify(), [])

    def test_the_cli_distinguishes_verification_refusal_and_incomplete_work(self):
        self.at()
        result = self.cli(self.dream_args(dict(V.read_anchor(str(self.spine)), tick=True)) + ["--rules"])
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn("refused:", result.stderr)
        self.assertFalse(self.chain.exists())
        result = self.cli(["dream", "--anchor", str((self.work / "missing.json").resolve())] + self.paths())
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertIn("could not complete dream:", result.stderr)
        self.seal(rules_only=True)
        self.forge(day__missed_ticks=99)
        result = self.cli(["verify"] + self.paths() + ["--spine", str(self.spine.resolve())])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("day is not the digest", result.stdout)

    def test_bad_anchors_and_unknown_clocks_are_refused_before_asking_or_writing(self):
        anchor = self.at()
        cases = [{"tick": True}, {"tick": -1}, {"tick_frame": "0" * 63 + "\n"}, {"spine": "another/spine"},
                 {"tick_utc": "2026-02-30T03:00:00.000Z"}, {"fetched_utc": "yesterday"}]
        for changes in cases:
            with self.subTest(changes):
                with self.assertRaises(V.Refusal):
                    self.seal(dict(anchor, **changes))
        with self.assertRaises(V.Refusal):
            self.seal({"tick": anchor["tick"]})
        with self.assertRaisesRegex(V.Refusal, "known timezone"):
            self.seal(anchor, clock="Mars/Olympus")
        self.assertFalse(self.chain.exists())
        self.assertEqual(self.calls(), [])

    def test_views_from_after_the_anchor_are_refused_before_the_mind_is_asked(self):
        anchor = self.at()
        self.capture(FIRST_NIGHT + datetime.timedelta(minutes=10), asleep=True)
        with self.assertRaisesRegex(V.Refusal, "views are ahead"):
            self.seal(anchor)
        self.assertFalse(self.chain.exists())
        self.assertEqual(self.calls(), [])

    def test_a_new_dream_will_not_extend_a_forged_memory(self):
        self.at()
        self.seal()
        self.forge(dream__memory="A memory the answer did not leave.")
        before = snapshot(self.chain)
        self.capture(FX.T0 + datetime.timedelta(days=1))
        self.at(SECOND_NIGHT)
        with self.assertRaisesRegex(V.Refusal, "dream line does not verify"):
            self.seal()
        self.assertEqual(snapshot(self.chain), before)
        self.assertEqual(len(self.calls()), 1)

    def test_a_changed_day_digest_is_caught_even_when_every_hash_is_right(self):
        self.at()
        self.seal()
        self.forge(day__bodies__wanderer__walked_m=999)
        self.assert_problem("day is not the digest of the folded views")

    def test_a_fold_cannot_skip_a_view_even_if_the_forger_rebuilds_the_whole_dream(self):
        self.at()
        first = self.seal()
        payload = self.retell(first, folded={"from": 1, "to": 1})
        self.forge(**payload)
        self.assertEqual(self.verify(), ["frame 0: folded range skips or repeats a views frame"])

    def test_a_fold_cannot_repeat_a_view_even_if_the_forger_rebuilds_the_whole_dream(self):
        _, second = self.two_nights()
        payload = self.retell(second, folded={"from": 1, "to": 3})
        self.forge(**payload)
        self.assertEqual(self.verify(), ["frame 1: folded range skips or repeats a views frame"])

    def test_a_wrong_fold_root_is_caught(self):
        self.at()
        self.seal()
        self.forge(folded__root="0" * 64)
        self.assert_problem("folded range, root, ticks or times are not the sealed views")

    def test_wrong_first_or_last_ticks_and_capture_times_are_caught(self):
        self.at()
        self.seal()
        originals = self.frames()
        for changes in ({"folded__first_tick": 0}, {"folded__last_tick": 99},
                        {"folded__first_utc": "2026-09-23T12:00:00.000Z"},
                        {"folded__last_utc": "2026-09-23T12:24:00.000Z"}):
            with self.subTest(changes):
                self.forge(frames=originals, **changes)
                self.assert_problem("folded range, root, ticks or times are not the sealed views")

    def test_dream_text_the_answer_did_not_say_is_caught(self):
        self.at()
        self.seal()
        self.forge(dream__text="There were no portals, and nobody greeted anyone.")
        self.assert_problem("dream is not what its answer says")

    def test_a_prompt_hash_that_was_not_rebuilt_is_caught(self):
        self.at()
        self.seal()
        self.forge(by__prompt__sha256="0" * 64)
        self.assert_problem("by.prompt is not the rebuilt prompt's sha256 and bytes")

    def test_the_prompt_byte_count_is_utf8_bytes_not_characters(self):
        self.at()
        frame = self.seal()
        prompt = self.calls()[0]["argv"][1]
        self.assertNotEqual(len(prompt), frame["payload"]["by"]["prompt"]["bytes"])
        self.forge(by__prompt__bytes=len(prompt))
        self.assert_problem("by.prompt is not the rebuilt prompt's sha256 and bytes")

    def test_a_remembered_frame_other_than_the_previous_dream_is_caught(self):
        self.two_nights()
        self.forge(remembered__frame_hash="0" * 64)
        self.assert_problem("remembered does not name the previous dream")

    def test_a_charter_frame_that_does_not_exist_is_caught(self):
        self.at()
        self.seal()
        self.forge(charter={"seq": 99, "frame_hash": "0" * 64})
        self.assert_problem("charter does not name the newest intent frame at this tick")

    def test_a_real_but_superseded_charter_is_not_the_charter_for_this_dream(self):
        self.at()
        self.amend()
        self.seal()
        self.forge(charter=ref(self.charter))
        self.assert_problem("charter does not name the newest intent frame at this tick")

    def test_two_dreams_in_one_real_spine_night_are_caught_even_with_distinct_ticks(self):
        self.at()
        first = self.seal()
        self.capture(FIRST_NIGHT + datetime.timedelta(minutes=10), asleep=True)
        same_night = V.read_anchor(str(self.spine))
        self.at(SECOND_NIGHT)
        second = self.seal()
        payload = self.retell(second, tick=same_night["tick"], tick_frame=same_night["tick_frame"],
                              night=first["payload"]["night"])
        self.forge(**payload)
        self.assertEqual(self.verify(), ["frame 1: night does not advance past the previous dream"])

    def test_a_dream_anchored_to_the_spines_daylight_is_caught(self):
        self.at()
        first = self.seal()
        payload = self.retell(first, tick=self.day_anchor["tick"], tick_frame=self.day_anchor["tick_frame"],
                              night=D.night_of(self.day_anchor["tick_utc"]))
        self.forge(**payload)
        self.assertEqual(self.verify(), ["frame 0: the anchor's spine tick is during the day, not night"])

    def test_a_night_label_other_than_the_anchors_local_night_is_caught(self):
        self.at()
        first = self.seal()
        self.forge(**self.retell(first, night="2026-09-24"))
        self.assert_problem("night is not the night of the anchor's spine tick")

    def test_a_tick_that_does_not_advance_is_caught(self):
        first, second = self.two_nights()
        self.forge(**self.retell(second, tick=first["payload"]["tick"], tick_frame=first["payload"]["tick_frame"]))
        self.assert_problem("tick does not advance past the previous dream")

    def test_an_anchor_hash_that_is_not_the_spines_own_is_caught(self):
        self.at()
        self.seal()
        self.forge(tick_frame="0" * 64)
        self.assert_problem("its spine tick could not be checked")

    def test_rules_cannot_claim_words_the_templates_did_not_write(self):
        self.at()
        self.seal(rules_only=True)
        self.forge(dream__text="A dream the rules never wrote.")
        self.assert_problem("dream is not what the rules say")

    def test_every_body_and_only_a_body_gets_a_morning_line(self):
        self.at()
        frame = self.seal()
        lines = dict(frame["payload"]["dream"]["lines"])
        del lines["watcher"]
        lines["nobody"] = "I should not be here."
        self.forge(dream__lines=lines)
        self.assert_problem("dream.lines does not give exactly one short line to every body")

    def test_the_shape_gate_refuses_extra_keys_booleans_and_unbounded_or_malformed_text(self):
        self.at()
        frame = self.seal()
        self.assertEqual(D.shape_problems(frame["payload"], 0), [])
        cases = [
            {"tick": True}, {"spine": "another/spine"}, {"fetched_utc": "not utc"}, {"night": "2026-02-30"},
            {"clock": []}, {"charter": {"seq": True, "frame_hash": "0" * 64}},
            {"remembered": ref(frame)}, {"folded": None}, {"folded__frames": 3}, {"folded__from": True},
            {"day": []}, {"day__missed_ticks": True}, {"day__bodies__wanderer__frames": False},
            {"day__bodies__wanderer__asleep": 20}, {"day__bodies__wanderer__said": [None]},
            {"day__bodies__wanderer__routines": [None]}, {"day__bodies__wanderer__saw": {"greeter": 0}},
            {"by": {"kind": "model"}}, {"by__ms": True}, {"by__provider": "another-provider"},
            {"by__asked": "model\n"}, {"by__answer": "x" * 4001}, {"by__prompt__bytes": True},
            {"dream": []}, {"dream__text": "x" * 601}, {"dream__text": "not\u2028safe"},
            {"dream__memory": ""}, {"dream__lines": {"wanderer": "alone"}},
            {"extra": "no extra payload keys"}, {"about": ""},
        ]
        for changes in cases:
            with self.subTest(changes):
                payload = FX.rehash(frame, **changes)["payload"]
                self.assertTrue(D.shape_problems(payload, 0), changes)
        successor = dict(frame["payload"], remembered=ref(frame))
        self.assertTrue(D.shape_problems(successor, 1), "about belongs only on genesis")

    def test_verification_reports_a_broken_chain_wrong_head_and_unreadable_input(self):
        self.at()
        self.seal()
        original = (self.chain / "0.json").read_text()
        bad = json.loads(original)
        bad["payload"]["dream"]["text"] = "not rehashed"
        (self.chain / "0.json").write_text(json.dumps(bad))
        self.assert_problem("step 2")
        (self.chain / "0.json").write_text(original)
        meta = json.loads((self.chain / "HEAD.json").read_text())
        meta["head_frame"] = "0" * 64
        (self.chain / "HEAD.json").write_text(json.dumps(meta))
        self.assert_problem("HEAD.json does not name the last frame")
        (self.chain / "HEAD.json").write_text("{")
        self.assertTrue(self.verify())
        self.assertTrue(D.verify(self.work / "absent", self.views, self.intent, self.spine, log=lambda *_: None))

    def test_malformed_view_evidence_is_reported_and_refused_not_an_uncaught_exception(self):
        self.at()
        self.seal()
        view = FX.rehash(chainio.load_chain(self.views)[-1], views__players__0__mind=None)
        chainio.append_frame(self.views, view, V.STREAM)
        self.assert_problem("the dream's evidence could not be rebuilt")
        another = self.work / "another-dream"
        with self.assertRaisesRegex(V.Refusal, "views could not be folded"):
            self.seal(chain=another)
        self.assertFalse(another.exists())
        self.assertEqual(len(self.calls()), 1)


class DreamMath(unittest.TestCase):
    def view(self, tick, *players):
        return {"payload": {"tick": tick, "views": {"players": list(players)}}}

    def player(self, pid="wanderer", **fields):
        return dict({"id": pid, "sees": []}, **fields)

    def test_the_digest_counts_gaps_sleep_and_both_model_and_directed_words(self):
        frames = [
            self.view(4, self.player(mind={"kind": "model", "said": "  hello\u2028there  "}, sees=["greeter"])),
            self.view(7, self.player(mind={"kind": "directed", "said": "I remember."}, sees=["greeter"])),
            self.view(8, self.player(mind={"kind": "sleep", "said": "not spoken"}, sees=[])),
        ]
        self.assertEqual(D.digest(frames), {"missed_ticks": 2, "bodies": {
            "wanderer": {"frames": 3, "asleep": 1, "walked_m": 0,
                         "said": [{"tick": 4, "text": "hello there"}, {"tick": 7, "text": "I remember."}],
                         "routines": [], "saw": {"greeter": 2}}}})

    def test_a_walk_sums_integer_centimeters_before_dividing_and_never_bridges_a_missing_pose(self):
        def at(x, y=0):
            return {"x_cm": x, "y_cm": y, "z_cm": 0, "yaw_mrad": 0, "pitch_mrad": 0}

        frames = [
            self.view(0, self.player(at=at(0))),
            self.view(1, self.player("greeter")),
            self.view(2, self.player(at=at(60, 10000))),
            self.view(3, self.player()),
            self.view(4, self.player(at=at(10000))),
            self.view(5, self.player(at=at(10060))),
        ]
        b = D.digest(frames)["bodies"]["wanderer"]
        self.assertEqual((b["frames"], b["walked_m"]), (5, 1))
        diagonal = D.digest([self.view(0, self.player(at=at(0))),
                             self.view(1, self.player(at=dict(at(300), z_cm=400)))])
        self.assertEqual(diagonal["bodies"]["wanderer"]["walked_m"], 5)

    def test_only_the_last_six_said_lines_and_three_newly_set_routines_are_remembered(self):
        frames = []
        for tick in range(10):
            said = f"line {tick}" + (" 🐈" * 100 if tick == 9 else "")
            routine = {"by": "gpt-5-mini", "set_at": tick if tick % 2 == 0 else 0, "steps": FX.PATROL}
            frames.append(self.view(tick, self.player(
                mind={"kind": "model" if tick % 2 == 0 else "directed", "said": said}, routine=routine)))
        b = D.digest(frames)["bodies"]["wanderer"]
        self.assertEqual([s["tick"] for s in b["said"]], [4, 5, 6, 7, 8, 9])
        self.assertEqual(len(b["said"][-1]["text"]), 140)
        self.assertTrue(b["said"][-1]["text"].endswith("…"))
        self.assertEqual(b["routines"], [{"tick": t, "by": "gpt-5-mini", "steps": "walk, look, wait"} for t in (4, 6, 8)])
        self.assertIsInstance(R.canonical(D.digest(frames)), str)

    def test_saw_counts_frames_not_duplicates_and_body_order_is_deterministic(self):
        a = self.player(sees=["pilgrim", "greeter", "greeter"])
        b = self.player("greeter", sees=["wanderer"])
        left = D.digest([self.view(0, a, b), self.view(2, a)])
        right = D.digest([self.view(0, b, a), self.view(2, a)])
        self.assertEqual(left, right)
        self.assertEqual(list(left["bodies"]), ["greeter", "wanderer"])
        self.assertEqual(left["bodies"]["wanderer"]["saw"], {"greeter": 2, "pilgrim": 2})


class NightClock(unittest.TestCase):
    def test_night_belongs_to_the_place_across_midnight_and_both_dst_changes(self):
        cases = [
            ("2026-09-24T02:59:59.999Z", False, "2026-09-23"),
            ("2026-09-24T03:00:00.000Z", True, "2026-09-23"),
            ("2026-09-24T04:00:00.000Z", True, "2026-09-23"),
            ("2026-09-24T10:59:59.999Z", True, "2026-09-23"),
            ("2026-09-24T11:00:00.000Z", False, "2026-09-24"),
            ("2026-03-08T06:59:59.999Z", True, "2026-03-07"),
            ("2026-03-08T07:00:00.000Z", True, "2026-03-07"),
            ("2026-03-08T11:00:00.000Z", False, "2026-03-08"),
            ("2026-11-01T05:30:00.000Z", True, "2026-10-31"),
            ("2026-11-01T06:30:00.000Z", True, "2026-10-31"),
            ("2026-11-01T11:59:59.999Z", True, "2026-10-31"),
            ("2026-11-01T12:00:00.000Z", False, "2026-11-01"),
        ]
        with mock.patch.object(V, "utc_now", side_effect=AssertionError("night never reads wall time")):
            for utc, due, night in cases:
                with self.subTest(utc):
                    self.assertEqual(D.due({"tick": 5, "tick_utc": utc}, [], 1, D.CLOCK), due)
                    self.assertEqual(D.night_of(utc), night)
        self.assertFalse(D.due({"tick": 5, "tick_utc": FX.stamp(FIRST_NIGHT)}, [], 1, "Asia/Tokyo"))
        self.assertEqual(D.NIGHT, (23, 7))

    def test_due_requires_a_new_tick_a_new_night_and_at_least_one_unfolded_view(self):
        previous = [{"payload": {"tick": 5, "night": "2026-09-23", "folded": {"to": 2}}}]
        anchor = {"tick": 6, "tick_utc": FX.stamp(SECOND_NIGHT)}
        self.assertTrue(D.due(anchor, previous, 4, D.CLOCK))
        self.assertFalse(D.due(anchor, previous, 3, D.CLOCK))
        self.assertFalse(D.due(dict(anchor, tick=5), previous, 4, D.CLOCK))
        self.assertFalse(D.due(dict(anchor, tick=4), previous, 4, D.CLOCK))
        self.assertFalse(D.due(dict(anchor, tick_utc=FX.stamp(FIRST_NIGHT)), previous, 4, D.CLOCK))
        self.assertFalse(D.due(anchor, [], 0, D.CLOCK))


class AnswerAndRules(unittest.TestCase):
    def setUp(self):
        self.day = {"missed_ticks": 1, "bodies": {
            "wanderer": {"frames": 3, "asleep": 0, "walked_m": 12, "said": [{"tick": 3, "text": "Hello!"}],
                         "routines": [], "saw": {"pilgrim": 2, "greeter": 2}},
            "greeter": {"frames": 3, "asleep": 1, "walked_m": 0, "said": [], "routines": [], "saw": {}},
        }}
        self.folded, self.night = {"frames": 3}, "2026-09-23"

    def derive(self, answer):
        return D.derive(answer, self.day["bodies"], self.day, self.folded, None, self.night)

    def test_text_is_normalized_by_code_point_and_each_field_has_its_own_bound(self):
        obj = {"text": " \tone \ud800\u2028" + "🐈" * 700,
               "lines": {"wanderer": " I\u0085remember\t" + "🐈" * 170},
               "memory": "\t" + "m" * 1300 + "  "}
        result = self.derive(json.dumps(obj, ensure_ascii=False))
        self.assertEqual((len(result["text"]), len(result["lines"]["wanderer"]), len(result["memory"])), (600, 140, 1200))
        self.assertTrue(result["text"].startswith("one \ufffd "))
        self.assertTrue(result["text"].endswith("🐈…"))
        self.assertTrue(result["lines"]["wanderer"].startswith("I remember "))
        self.assertFalse(V.LONE.search(result["text"]))
        self.assertFalse(V.BREAKS.search(result["text"]))

    def test_empty_missing_and_non_string_fields_fall_back_per_body_and_unknown_bodies_are_dropped(self):
        obj = {"text": "  A real dream. \t", "lines": {"wanderer": " \n ", "greeter": 42, "nobody": "I exist."},
               "memory": False}
        expected = D.rules(self.day, self.folded, None, self.night)
        result = self.derive(json.dumps(obj))
        self.assertEqual(result, dict(expected, text="A real dream."))
        obj["lines"] = []
        del obj["memory"]
        self.assertEqual(self.derive(json.dumps(obj)), result)

    def test_no_answer_no_object_non_json_constants_and_empty_dream_text_are_not_dreams(self):
        cases = [None, 42, "", "x" * 4001, "plain words", "[]", "{}", '{"text":null}', '{"text":" \\t "}',
                 '{"text":"dream","x":NaN}', '{"text":"dream","x":Infinity}', '{"text":"one"} {"text":"two"}',
                 '{"text":' + "[" * 1500 + "0" + "]" * 1500 + "}"]
        for answer in cases:
            with self.subTest(answer=str(answer)[:60]):
                self.assertIsNone(self.derive(answer))
        answer = '{"text":"one"}'
        self.assertIsNotNone(self.derive(answer + " " * (D.MAX_ANSWER - len(answer))))
        self.assertIsNone(self.derive(answer + " " * (D.MAX_ANSWER + 1 - len(answer))))

    def test_rules_are_deterministic_ties_use_the_first_id_and_memory_keeps_its_newest_end(self):
        previous = {"dream": {"memory": "older " * 199 + "memory"}}
        result = D.rules(self.day, self.folded, previous, self.night)
        self.assertEqual(result["text"],
                         "The hub slept on 3 frames of the day. The greeter walked 0 m. "
                         "The wanderer walked 12 m and said “Hello!”.")
        self.assertEqual(result["lines"], {
            "greeter": "I dreamed I walked 0 m.",
            "wanderer": "I dreamed I walked 12 m and kept seeing the greeter.",
        })
        memory = previous["dream"]["memory"] + " · 2026-09-23: 3 frames; greeter 0 m, wanderer 12 m"
        self.assertEqual(result["memory"], "…" + memory[-1199:])
        self.assertEqual(len(result["memory"]), 1200)
        backwards = dict(self.day, bodies=dict(reversed(list(self.day["bodies"].items()))))
        self.assertEqual(D.rules(backwards, self.folded, previous, self.night), result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
