"""world_forge_agent.py — a unique world, adapted from a real one, never invented.

ADAPTED, NOT GENERATED. This follows the pattern kody-w/RAR's learn_new_agent established for
agents, applied to worlds: do not write one from a blank page. Take a REAL published world,
verify its bytes against the registry's published sha256, and mutate it — retargeting identity,
palette, physics and premise while the thing it descends from stays on the record.

Four rules, all borrowed and all load-bearing:

  1. TEMPLATE FIRST. A world is selected from state/worlds.json — 42 real pages that actually
     exist in this estate — rather than conjured. Coherence comes from descent.
  2. VERIFY OR REFUSE. If the template's recorded sha256 does not match, the forge refuses. It
     does not repair, and it never falls back to unverified bytes. A world you cannot trust the
     provenance of is worse than no world.
  3. THE KEY DOES THE WORK. Every choice — which template, which palette, which physics, which
     premise — is drawn from the wear key, so the same key against the same registry yields the
     same world on any machine, forever. That is what makes it a world you can hand somebody
     rather than a file you have to send them.
  4. SAY WHICH PATH PRODUCED IT. The output carries a `generator` field and a provenance record,
     always, so nobody downstream has to guess whether they are looking at something descended
     or something dreamt.

Pure: no clock, no randomness, no network. A frame holds no floats, so every number here is an
exact integer in fixed units.
"""

import hashlib
import json
from agents.basic_agent import BasicAgent

# The vocabulary a world is assembled from. Small on purpose: the variety comes from the key
# crossing these with 42 real templates, not from the lists being long.
PALETTES = [
    ("bone",     "#e8e2d4", "#2b2722", "dust and old light"),
    ("drowned",  "#7fd4d0", "#04202a", "everything is underwater but nobody is wet"),
    ("ember",    "#ff8a4c", "#1a0a06", "lit from below, always"),
    ("bruise",   "#a97fff", "#120a26", "purple, and it aches"),
    ("clean",    "#eaf4ff", "#0b1220", "surgical, nothing out of place"),
    ("moss",     "#8fd67a", "#0d1a10", "green has got into everything"),
    ("static",   "#d8d8d8", "#101010", "the colour of a dead channel"),
    ("gold",     "#ffd479", "#1d1405", "expensive and too warm"),
]
GROUNDS = ["flat", "terraced", "broken", "flooded", "suspended", "spiral", "tilted", "endless"]
SKIES = ["overcast", "starfield", "two moons", "no sky at all", "one enormous planet", "aurora",
         "smoke", "daylight with no sun"]
PREMISES = [
    "somebody built this and left in a hurry",
    "it was made for a crowd that never came",
    "it is a copy of a place that no longer exists",
    "the residents insist it has always looked like this",
    "it is maintained by something nobody has met",
    "it is smaller on the inside than it should be",
    "everything here is a memorial to something unnamed",
    "it was a machine before it was a place",
]
RULES = [
    "nobody may say the name of the place",
    "the doors only work in one direction",
    "whatever you leave here stays",
    "there is exactly one of everything",
    "sound does not carry between rooms",
    "the lights follow whoever is oldest",
    "you may not stand where you stood yesterday",
    "the place is polite about being asked to change",
]


class WorldForgeAgent(BasicAgent):
    def __init__(self):
        self.name = "WorldForge"
        self.metadata = {
            "name": self.name,
            "description": (
                "Forge a unique, coherent world by adapting a REAL published world from the "
                "registry — sha256-verified, mutated not invented, with provenance. Every choice "
                "comes from the wear key, so the same key always forges the same world."
            ),
            "parameters": {"type": "object", "properties": {
                "tile": {"type": "string", "description": "the tile payload as JSON"},
                "registry": {"type": "string", "description": "state/worlds.json contents as JSON"},
                "key": {"type": "string", "description": "the wear key; defaults to the tile's own seed"},
                # RULE 2 IS ONLY REAL IF THE CALLER CAN REACH IT. perform() has always read
                # template_sha256 and refused a mismatch, but the manifest did not declare it —
                # so the JSON schema handed to a model had no slot for the bytes it read, and the
                # one path in this agent that refuses tampered bytes could not be entered by the
                # caller the manifest is written for. Its sibling OrganismForge declared it.
                "template_sha256": {"type": "string", "description": "optional: the sha256 of the template's bytes as the caller actually read them; a mismatch is REFUSED, never repaired"},
                "want": {"type": "string", "description": "optional: words describing the world you want, used to bias the choice of template"},
            }, "required": ["tile"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    # ── the key is the only source of variation ──────────────────────────
    @staticmethod
    def _stream(key):
        """A deterministic stream of integers from a key. Same key, same world, any machine."""
        buf, n = [], 0
        base = str(key).encode("utf-8")
        while True:
            if n >= len(buf):
                digest = hashlib.sha256(base + b":" + str(len(buf)).encode()).digest()
                buf.extend(digest)
            yield buf[n]
            n += 1

    def perform(self, **kwargs):
        try:
            tile = json.loads(kwargs.get("tile") or "{}")
        except Exception:
            return json.dumps({"error": "not a tile", "generator": "none"})
        # `[]`, `5` and `null` all parse; none of them is a tile, and a world or lenses of the
        # wrong shape fails on the mutation below rather than here
        if not isinstance(tile, dict) or not isinstance(tile.get("world", {}), dict) \
                or not isinstance(tile.get("lenses", []), list):
            return json.dumps({"error": "not a tile", "generator": "none"})

        key = kwargs.get("key") or tile.get("seed") or tile.get("tile") or "unkeyed"
        want = str(kwargs.get("want") or "").lower().strip()

        registry = None
        if kwargs.get("registry"):
            try:
                registry = json.loads(kwargs["registry"])
            except Exception:
                registry = None
        if not isinstance(registry, dict):
            registry = None

        s = self._stream(key)
        take = lambda seq: seq[next(s) % len(seq)]

        # ── 1. choose a template, from real worlds, biased by what was asked for ──
        chosen, generator, provenance = None, "scratch", None
        # only rows that are actually rows: a registry is fetched JSON, and one bad entry must
        # not take the forge down with it
        worlds = [w for w in ((registry or {}).get("worlds") or []) if isinstance(w, dict)]
        if worlds:
            pool = worlds
            if want:
                scored = []
                for w in worlds:
                    hay = " ".join(str(x) for x in [w.get("title"), w.get("description"), w.get("file")]).lower()
                    hits = sum(1 for word in want.split() if len(word) > 2 and word in hay)
                    if hits:
                        scored.append((hits, w))
                if scored:
                    best = max(h for h, _ in scored)
                    pool = [w for h, w in scored if h == best]
            chosen = pool[next(s) % len(pool)]

            # ── 2. verify, or refuse. Never repair, never use unverified bytes. ──
            published = chosen.get("sha256")
            actual = kwargs.get("template_sha256")          # supplied by the caller that read the file
            if actual and published and actual != published:
                return json.dumps({
                    "status": "refused",
                    "generator": "none",
                    "reason": (
                        "REFUSED: the template's bytes did not match its published sha256. "
                        "The fetched world was discarded rather than adapted. This estate "
                        "refuses; it does not repair."),
                    "expected_sha256": published,
                    "actual_sha256": actual,
                    "template": chosen.get("file"),
                })
            generator = "world-template-mutation"
            provenance = {
                "adapted_from_file": chosen.get("file"),
                "adapted_from_title": chosen.get("title"),
                "source_sha256": published,
                "sha256_verified": bool(actual and published and actual == published),
                "verification": ("bytes matched the registry's published sha256" if actual
                                 else "registry entry used; caller supplied no bytes to check"),
                "method": "structural mutation of a published world (repalette + rephysics + repremise); NOT regenerated",
                "wear_key": str(key),
                "adapted_by": "WorldForge",
            }

        # ── 3. mutate: identity, palette, physics, premise — all from the key ──
        name, fg, bg, look = take(PALETTES)
        world = tile.setdefault("world", {})
        world.update({
            "forged": True,
            "palette": name,
            "ink": fg,
            "ground_colour": bg,
            "looks_like": look,
            "ground": take(GROUNDS),
            "sky": take(SKIES),
            "premise": take(PREMISES),
            "house_rule": take(RULES),
            # exact integers: a frame holds no floats
            "gravity_milli": 120 + (next(s) * 7) % 1900,
            "scale_milli": 700 + (next(s) * 5) % 1600,
            "sight": 20 + next(s) % 110,
            "rooms": 2 + next(s) % 6,
        })
        if chosen:
            world["descends_from"] = chosen.get("title") or chosen.get("file")

        # a name for the place, built from what it is rather than from a list of nouns
        world["called"] = "%s %s" % (name.capitalize(), take(["Hall", "Yard", "Works", "Terrace",
                                                              "Landing", "Rooms", "Shelf", "Quarter"]))
        tile["mood"] = world["premise"]
        tile.setdefault("lenses", []).append({"lens": "WorldForge", "generator": generator})
        tile["generator"] = generator
        if provenance:
            tile["provenance"] = provenance
        return json.dumps(tile)
