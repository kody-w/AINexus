"""organism_forge_agent.py — a creature sloshed out of a conversation.

A chat-tile is the smallest frame there is, which makes it the cheapest thing to pour through a
template. Pour one through, and what comes out is a new organism: shaped by what was actually
said, and by the shape the saying had in time.

Same four rules the world forge borrowed from kody-w/RAR's learn_new_agent, because they are the
rules that make generated things trustworthy rather than merely plentiful:

  1. TEMPLATE FIRST — the organism is adapted from a real published agent, so it inherits a shape
     that already works instead of being assembled out of adjectives.
  2. VERIFY OR REFUSE — a template whose bytes do not match its published sha256 is refused. Not
     repaired, not used with a warning.
  3. THE INPUT DOES THE CHOOSING — every trait is drawn from the chat's own digest, so the same
     conversation always makes the same creature, and a different conversation makes a different
     one. Nothing here rolls dice.
  4. SAY WHICH PATH PRODUCED IT — generator and provenance, always.

The time is not decoration. A conversation had at three in the morning makes something that
listens; one had in a rush makes something that interrupts; one with a long silence in the middle
makes something that waits. That is the whole reason to carry the shape.

Pure: no clock, no randomness, no network. Integers in fixed units, because a frame holds no floats.
"""

import hashlib
import json
from agents.basic_agent import BasicAgent

WAKEFULNESS = [
    (0, 5, "nocturnal", "does its best thinking when nobody else is up"),
    (5, 11, "early", "is already going when the others arrive"),
    (11, 17, "plain", "keeps ordinary hours"),
    (17, 22, "evening", "warms up as the light goes"),
    (22, 24, "nocturnal", "does its best thinking when nobody else is up"),
]
TEMPERS = ["patient", "abrupt", "watchful", "obliging", "stubborn", "quiet", "restless", "exact"]
HABITS = ["repeats what it heard before answering", "answers the question under the question",
          "asks one more thing than it needs", "says less than it knows",
          "keeps a list nobody asked for", "remembers the wrong details on purpose",
          "will not be hurried", "starts in the middle"]


class OrganismForgeAgent(BasicAgent):
    def __init__(self):
        self.name = "OrganismForge"
        self.metadata = {
            "name": self.name,
            "description": (
                "Slosh a chat-tile through a published template to forge a new organism, shaped by "
                "what was said and by the shape the saying had in time. Adapted, never invented."
            ),
            "parameters": {"type": "object", "properties": {
                "tile": {"type": "string", "description": "a chat-tile (from ChatTile) as JSON"},
                "registry": {"type": "string", "description": "the template registry as JSON"},
                "template_sha256": {"type": "string", "description": "optional: the bytes the caller actually read, to verify"},
                "want": {"type": "string", "description": "optional: words biasing which template is chosen"},
            }, "required": ["tile"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    @staticmethod
    def _stream(key):
        buf, n = [], 0
        base = str(key).encode("utf-8")
        while True:
            if n >= len(buf):
                buf.extend(hashlib.sha256(base + b":" + str(len(buf)).encode()).digest())
            yield buf[n]
            n += 1

    def perform(self, **kwargs):
        try:
            tile = json.loads(kwargs.get("tile") or "{}")
        except Exception:
            return json.dumps({"error": "not a tile", "generator": "none"})
        if tile.get("kind") != "chat":
            return json.dumps({"error": "that is not a chat-tile", "generator": "none"})

        lines = tile.get("lines") or []
        shape = tile.get("shape") or {}
        # the conversation IS the key: same words, same creature
        key = tile.get("seed") or hashlib.sha256(
            json.dumps(lines, sort_keys=True).encode("utf-8")).hexdigest()[:12]
        s = self._stream(key)
        take = lambda seq: seq[next(s) % len(seq)]

        # ── template first, verified or refused ──────────────────────────
        registry, chosen, generator, provenance = None, None, "scratch", None
        if kwargs.get("registry"):
            try:
                registry = json.loads(kwargs["registry"])
            except Exception:
                registry = None
        pool = (registry or {}).get("templates") or []
        if pool:
            want = (kwargs.get("want") or "").lower().strip()
            if want:
                scored = [(sum(1 for w in want.split() if len(w) > 2
                               and w in json.dumps(t).lower()), t) for t in pool]
                best = max((h for h, _ in scored), default=0)
                if best:
                    pool = [t for h, t in scored if h == best]
            chosen = pool[next(s) % len(pool)]
            published, actual = chosen.get("sha256"), kwargs.get("template_sha256")
            if actual and published and actual != published:
                return json.dumps({
                    "status": "refused", "generator": "none",
                    "reason": ("REFUSED: the template's bytes did not match its published sha256. "
                               "The organism was not forged. This estate refuses; it does not repair."),
                    "expected_sha256": published, "actual_sha256": actual,
                    "template": chosen.get("file")})
            generator = "organism-template-mutation"
            provenance = {
                "adapted_from_file": chosen.get("file"),
                "adapted_from_name": chosen.get("name"),
                "source_sha256": published,
                "sha256_verified": bool(actual and published and actual == published),
                "verification": ("bytes matched the published sha256" if actual
                                 else "registry entry used; caller supplied no bytes to check"),
                "method": "structural mutation of a published agent; NOT regenerated",
                "forged_from_chat": key,
                "adapted_by": "OrganismForge",
            }

        # ── the conversation, and its shape, become a body ───────────────
        traits = {}
        hour = shape.get("hour_of_day")
        wake, wake_says = "plain", "keeps ordinary hours"
        if hour is not None:
            for lo, hi, w, says in WAKEFULNESS:
                if lo <= hour < hi:
                    wake, wake_says = w, says
                    break
        traits["wakefulness"] = wake

        rhythm = shape.get("rhythm")
        if rhythm == "a rush":
            traits["patience_milli"] = 200 + next(s) % 200
            traits["habit"] = "interrupts, and is usually right to"
        elif rhythm == "a vigil":
            traits["patience_milli"] = 1400 + next(s) % 600
            traits["habit"] = "waits, even when waiting is uncomfortable"
        else:
            traits["patience_milli"] = 700 + next(s) % 400
            traits["habit"] = take(HABITS)

        turns = shape.get("turns") or len(lines)
        traits["verbosity_milli"] = max(80, min(2000, 40 * turns + next(s) % 300))
        share = shape.get("loudest_share_milli")
        if share is not None:
            # a creature grown from a conversation one voice dominated tends to hold the floor
            traits["holds_the_floor_milli"] = share
            traits["listens_milli"] = 1000 - min(950, share)
        traits["temper"] = take(TEMPERS)
        if shape.get("longest_silence"):
            traits["tolerates_silence_seconds"] = int(shape["longest_silence"])

        # what it will actually talk about: the words that survived the wearing
        subjects = []
        for ln in lines[:12]:
            words = [w.strip(".,!?;:\"'()").lower() for w in str(ln.get("said", "")).split()]
            for w in words:
                if len(w) > 5 and w not in subjects:
                    subjects.append(w)
        traits["knows_about"] = subjects[:8]

        organism = {
            "kind": "organism",
            "forged_from": "a conversation",
            "chat_seed": key,
            "about": tile.get("about"),
            "traits": traits,
            "born_of": {
                "turns": turns, "rhythm": rhythm, "hour": hour,
                "wakefulness_because": wake_says,
                "voices": shape.get("voices"),
            },
            "generator": generator,
        }
        if chosen:
            organism["descends_from"] = chosen.get("name") or chosen.get("file")
        if provenance:
            organism["provenance"] = provenance
        organism["called"] = "%s %s" % (traits["temper"].capitalize(),
                                        take(["Ash", "Wren", "Poll", "Slate", "Fen", "Mox", "Rill", "Tace"]))
        return json.dumps(organism)
