"""lens_gravity_agent.py — a lens that changes what weight means here.

A LENS AGENT takes a tile and hands back a tile. That is the whole contract: same shape in, same
shape out, so lenses compose — the output of one is the input of the next, and a tile can be
poured through as many as you like.

It must be a PURE function of its input. A lens that consults the clock or a random number breaks
the one property that makes any of this worth doing: that a tile re-derives to the same bytes on
any machine, forever. This one is arithmetic on a number.
"""

import json
from agents.basic_agent import BasicAgent


class LensGravityAgent(BasicAgent):
    def __init__(self):
        self.name = "LensGravity"
        self.metadata = {
            "name": self.name,
            "description": "Change the gravity of a tile. Low gravity makes people drift and jump; high gravity pins them down.",
            "parameters": {"type": "object", "properties": {
                "tile": {"type": "string", "description": "the tile payload as JSON"},
                "g": {"type": "number", "description": "gravity as a multiple of normal, 0.05 to 4"},
            }, "required": ["tile"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        try:
            tile = json.loads(kwargs.get("tile") or "{}")
        except Exception:
            return "not a tile"
        g = kwargs.get("g")
        g = 0.35 if g is None else max(0.05, min(4.0, float(g)))
        world = tile.setdefault("world", {})
        world["gravity"] = round(g, 3)
        world["step_height"] = round(min(4.0, 0.5 / max(0.08, g)), 3)
        world["fall_seconds"] = round(min(9.0, 1.2 / max(0.08, g)), 3)
        if g < 0.4:
            world["feel"] = "everything falls slowly and nobody is in a hurry"
        elif g > 1.8:
            world["feel"] = "walking is work and nobody jumps"
        else:
            world["feel"] = "ordinary weight"
        tile.setdefault("lenses", []).append({"lens": "LensGravity", "g": world["gravity"]})
        return json.dumps(tile)
