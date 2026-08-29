"""adapt_agent.py — the inverse slosh: a world wears an organism.

Sloshing a TILE through lenses changes the world. Kody's inversion: turn it around and pour the
ORGANISM through the worlds instead. Each tile is a condition, and what comes out the other side
is the next version of that organism — shaped by low gravity, by the dark, by a planet that is
no longer there.

Same contract in the other direction: an organism in, an organism out, pure, so worlds compose
the way lenses do. A creature poured through three tiles has been shaped by three worlds, in
order, and the order matters.
"""

import json
from agents.basic_agent import BasicAgent


def _milli(v, default):
    """A quantity in thousandths, as an exact integer, whatever shape it arrived in.

    Both sides of this pour are somebody else's JSON: the organism has been through other hands
    and the world is whatever a model said it was. A word where a number was promised used to
    crash the pour outright, and a float used to survive it — which is worse, because a frame
    holds no floats and the organism only fails later, at the hash, in somebody else's hands.
    """
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return default
    if v != v or v in (float("inf"), float("-inf")):        # NaN and the infinities
        return default
    # and a bound, because JSON carries integers of any length: a 400-digit reach is not a reach,
    # and multiplying one by 1.6 is an OverflowError rather than a creature
    return max(-10 ** 9, min(10 ** 9, int(round(v))))


class AdaptAgent(BasicAgent):
    def __init__(self):
        self.name = "Adapt"
        self.metadata = {
            "name": self.name,
            "description": "Pour an organism through a world (a tile) and return the next version of it, shaped by that world's conditions.",
            "parameters": {"type": "object", "properties": {
                "organism": {"type": "string", "description": "the organism as JSON"},
                "tile": {"type": "string", "description": "the tile (world) as JSON"},
            }, "required": ["organism", "tile"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        try:
            o = json.loads(kwargs.get("organism") or "{}")
            t = json.loads(kwargs.get("tile") or "{}")
        except Exception:
            return "not an organism and a tile"
        # `[]`, `5` and `null` are all valid JSON and none of them is an organism or a tile.
        # Without this the pour crashes on the first setdefault and a model reads a traceback.
        if not isinstance(o, dict) or not isinstance(t, dict) \
                or not isinstance(o.get("traits", {}), dict) \
                or not isinstance(o.get("shaped_by", []), list) \
                or not isinstance(t.get("world", {}), dict):
            return "not an organism and a tile"

        w = t.get("world") or {}
        traits = o.setdefault("traits", {})
        story = o.setdefault("shaped_by", [])

        # what a world does to a body that lives in it
        # every trait is carried in thousandths: a frame holds no floats, and an organism that
        # cannot be hashed cannot be handed to anybody
        g = w.get("gravity_milli")
        if g is not None:
            g = _milli(g, 1000)          # a world that says "low" weighs what an ordinary one does
            if g < 400:
                traits["gait"] = "drifting"
                traits["reach_milli"] = int(round(_milli(traits.get("reach_milli"), 1000) * 1.6))
                traits["caution_milli"] = min(1000, _milli(traits.get("caution_milli"), 300) + 200)
            elif g > 1800:
                traits["gait"] = "heavy"
                traits["reach_milli"] = int(round(_milli(traits.get("reach_milli"), 1000) * 0.7))
                traits["stamina_milli"] = max(100, _milli(traits.get("stamina_milli"), 1000) - 300)
            else:
                traits["gait"] = "ordinary"

        hour = w.get("hour")
        if hour:
            traits["sight"] = _milli(w.get("sight"), 100)
            if hour in ("night", "dusk"):
                traits["hearing_milli"] = min(2000, _milli(traits.get("hearing_milli"), 1000) + 450)
                traits["talks"] = "quietly"
            else:
                traits["talks"] = "normally"

        ruin = w.get("ruin")
        if ruin and ruin != "intact":
            traits["trust_milli"] = max(0, _milli(traits.get("trust_milli"), 600)
                                        - 200 * _milli(w.get("ruin_degree"), 1))
            if not w.get("planet", True):
                traits["belief"] = "there is no ground; only the others are real"
                traits["gait"] = "still"

        story.append({"world": t.get("seed") or t.get("tile"),
                      "gravity_milli": g, "hour": hour, "ruin": ruin})
        o["generation"] = len(story)
        return json.dumps(o)
