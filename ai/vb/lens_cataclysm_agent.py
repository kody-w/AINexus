"""lens_cataclysm_agent.py — a lens that asks whether the place is still there.

The most useful lenses are the ones that change what is TRUE rather than what is visible. This one
takes a tile and applies a degree of ruin: the ground goes, the walls go, and eventually the planet
itself is a past-tense thing the residents are standing on the memory of.

Pure, like every lens. The same tile and the same degree always produce the same ruin.
"""

import json
from agents.basic_agent import BasicAgent

STAGES = [
    (0, "intact", "nothing is wrong with the place"),
    (1, "cracked", "the floor has opened in places and nobody mentions it"),
    (2, "failing", "whole sections are gone and the sky is wrong"),
    (3, "gone", "the planet is not there any more; they are standing on what is left of the idea of it"),
]


class LensCataclysmAgent(BasicAgent):
    def __init__(self):
        self.name = "LensCataclysm"
        self.metadata = {
            "name": self.name,
            "description": "Apply ruin to a tile, from intact to the planet no longer existing. Changes what is true about the place, not how it looks.",
            "parameters": {"type": "object", "properties": {
                "tile": {"type": "string", "description": "the tile payload as JSON"},
                "degree": {"type": "integer", "description": "0 intact, 1 cracked, 2 failing, 3 gone"},
            }, "required": ["tile"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        try:
            tile = json.loads(kwargs.get("tile") or "{}")
        except Exception:
            return "not a tile"
        # a model's JSON parses fine as `[]`, `5` or `null`; and this lens reaches into the cast,
        # so a cast that is not a list of people is the same kind of malformed tile
        if not isinstance(tile, dict) or not isinstance(tile.get("world", {}), dict) \
                or not isinstance(tile.get("lenses", []), list) \
                or not isinstance(tile.get("cast", []), list):
            return "not a tile"
        try:
            deg = int(kwargs.get("degree", 1))
        except Exception:
            deg = 1
        deg = max(0, min(3, deg))
        _, name, says = STAGES[deg]
        world = tile.setdefault("world", {})
        world["ruin"] = name
        world["ruin_degree"] = deg
        world["state_of_things"] = says
        world["ground"] = deg < 2
        world["planet"] = deg < 3
        if deg >= 2:
            # what is gone changes what anyone can be doing
            for c in tile.get("cast", []):
                if not isinstance(c, dict):
                    continue          # a name with nobody behind it has nothing to stop doing
                if c.get("standing") in ("go", "wander"):
                    c["standing"] = "hold"
            tile["mood"] = says
        tile.setdefault("lenses", []).append({"lens": "LensCataclysm", "degree": deg})
        return json.dumps(tile)
