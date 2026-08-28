"""nexus_world_agent.py — the world, as an agent.

The brainstem's whole contract is: an agent is a class with a manifest and a perform(). Give the
3D world that shape and it stops being a special case wired into the loop — it is just another
agent the brainstem calls, exactly like ManageMemory or HackerNews, and anything that can drive
a brainstem can drive a player.

It runs inside Pyodide and reaches the page through `js`, so the hands it moves are the same
hands a person's mouse moves (kody-w/AINexus ai/autodrive.js). Sync verbs answer immediately.
Verbs that take time in the world return the JS promise itself — the caller awaits it — because
answering "ok" before a thing has happened is how a mind ends up reasoning from a fiction.
"""

import json
from agents.basic_agent import BasicAgent
from js import window


SYNC = ("people", "orbs", "dialogue", "snapshot")
ASYNC = ("look", "walk", "aim", "travel", "say", "tell", "see", "scan", "wait")


class NexusWorldAgent(BasicAgent):
    def __init__(self):
        self.name = "NexusWorld"
        self.metadata = {
            "name": self.name,
            "description": (
                "Act in the 3D world you are standing in, or look at what is around you. "
                "Use action=people or orbs to find out who and what is here before moving."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "description":
                               "one of: " + ", ".join(SYNC + ASYNC)},
                    "portal": {"type": "string", "description": "portal name, for aim and travel"},
                    "text": {"type": "string", "description": "what to say, for say and tell"},
                    "to": {"type": "string", "description": "a peer id, for tell and dialogue"},
                    "dir": {"type": "string", "description": "forward, back, left or right, for walk"},
                    "ms": {"type": "integer", "description": "milliseconds, for walk and wait"},
                    "dx": {"type": "integer", "description": "pixels to turn, for look"},
                    "dy": {"type": "integer", "description": "pixels to look up or down, for look"},
                },
                "required": ["action"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        action = str(kwargs.get("action") or "").strip()
        drive = getattr(window, "__autodrive", None)
        if drive is None:
            return "no hands: the driver is not loaded in this world"
        if action not in SYNC and action not in ASYNC:
            return "no such action: %s — the hands cannot do that" % action

        if action == "people":
            return json.dumps([
                {"id": p.id, "name": p.name, "isAI": bool(p.isAI)} for p in drive.people()
            ])
        if action == "orbs":
            return json.dumps([
                {"name": o.name, "distance": o.distance} for o in drive.orbs()
            ])
        if action == "dialogue":
            return json.dumps([
                {"short": l.short, "text": l.text} for l in drive.dialogue(kwargs.get("to"))
            ])
        if action == "snapshot":
            s = drive.snapshot()
            return json.dumps({"me": s.me.to_py() if hasattr(s.me, "to_py") else {},
                               "world": s.world})

        # these take time in the world; hand the promise back and let the caller wait for it
        if action == "look":
            return drive.look(int(kwargs.get("dx") or 0), int(kwargs.get("dy") or 0))
        if action == "walk":
            return drive.walk(str(kwargs.get("dir") or "forward"), int(kwargs.get("ms") or 600))
        if action == "aim":
            return drive.aim(kwargs.get("portal"))
        if action == "travel":
            return drive.travel(kwargs.get("portal"))
        if action == "say":
            return drive.say(kwargs.get("text"))
        if action == "tell":
            return drive.tell(kwargs.get("to"), kwargs.get("text"))
        if action == "see":
            return drive.see({})
        if action == "scan":
            return drive.scan(kwargs.get("steps"), kwargs.get("deg"))
        if action == "wait":
            return drive.wait(int(kwargs.get("ms") or 800))
        return "unreachable"
