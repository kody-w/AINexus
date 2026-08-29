"""lens_daynight_agent.py — a lens that moves the hour.

Same contract as every lens: a tile in, a tile out, pure. The hour changes the light, and the
light changes what the cameras see and what the residents are likely to be doing — which is why
this is a starting condition rather than a colour grade.
"""

import json
from agents.basic_agent import BasicAgent

# sun in thousandths, because a frame holds no floats
HOURS = {
    "dawn":  {"sun": 250,  "sky": "#2b2350", "fog": 70,  "mood": "grey and not yet warm"},
    "day":   {"sun": 1000, "sky": "#0b1030", "fog": 100, "mood": "flat and bright"},
    "dusk":  {"sun": 400,  "sky": "#3a1840", "fog": 60,  "mood": "long shadows, everything orange"},
    "night": {"sun": 80,   "sky": "#05050c", "fog": 34,  "mood": "dark, and sound carries"},
}


class LensDayNightAgent(BasicAgent):
    def __init__(self):
        self.name = "LensDayNight"
        self.metadata = {
            "name": self.name,
            "description": "Set the hour of a tile: dawn, day, dusk or night. Changes the light, the reach of sight, and the mood.",
            "parameters": {"type": "object", "properties": {
                "tile": {"type": "string", "description": "the tile payload as JSON"},
                "hour": {"type": "string", "description": "dawn | day | dusk | night"},
            }, "required": ["tile"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        try:
            tile = json.loads(kwargs.get("tile") or "{}")
        except Exception:
            return "not a tile"
        # a model's JSON parses fine as `[]`, `5` or `null`, and a tile whose world or lenses is
        # the wrong shape crashes on the setdefault below rather than at the parse
        if not isinstance(tile, dict) or not isinstance(tile.get("world", {}), dict) \
                or not isinstance(tile.get("lenses", []), list):
            return "not a tile"
        hour = str(kwargs.get("hour") or "night").lower()
        if hour not in HOURS:
            hour = "night"
        h = HOURS[hour]
        world = tile.setdefault("world", {})
        world["hour"] = hour
        world["sun_milli"] = h["sun"]
        world["sky"] = h["sky"]
        world["sight"] = h["fog"]
        world["light_mood"] = h["mood"]
        tile.setdefault("lenses", []).append({"lens": "LensDayNight", "hour": hour})
        return json.dumps(tile)
