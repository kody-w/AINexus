"""nexus_brainstem — a real RAPP-pattern brainstem running INSIDE a browser tab (Pyodide).

This is the AI player's body controller. It follows the RAR BasicAgent contract
(perform(**kwargs) -> str) with a deliberately small basic-agent subset — observe,
move, say, travel — plus the RAPP signature move: learn_new_agent, which accepts
new agent source at runtime, validates it against the contract, and hot-loads it
into the registry. The language mind (the local Copilot-authenticated brainstem
at localhost:7071) only ever CHOOSES which agent to perform; every effect on the
world goes through an agent in this registry. No agent, no action.

The JS side exposes window.nexusAI (observe/move/say/travel); Pyodide's js module
is the only bridge. dispatch() is the single entry point JS calls.
"""

import json

try:
    import js  # Pyodide bridge — absent under plain CPython (tests)
except ImportError:
    js = None


class BasicAgent:
    """Subset of @rapp/basic_agent: a name, metadata, and perform(**kwargs) -> str."""

    def __init__(self, name, metadata):
        self.name = name
        self.metadata = metadata

    def perform(self, **kwargs):
        raise NotImplementedError


def _bridge(method, payload=None):
    if js is None:
        return json.dumps({"ok": False, "error": "no js bridge (not in Pyodide)"})
    fn = getattr(js.window.nexusAI, method)
    result = fn(json.dumps(payload or {}))
    return str(result)


class ObserveAgent(BasicAgent):
    def __init__(self):
        super().__init__("observe", {
            "name": "observe",
            "description": "Look at the world: my position, other players, portal names and positions, recent chat.",
            "parameters": {},
        })

    def perform(self, **kwargs):
        return _bridge("observe")


class MoveAgent(BasicAgent):
    def __init__(self):
        super().__init__("move", {
            "name": "move",
            "description": "Walk toward a position on the plaza floor.",
            "parameters": {"x": "number", "z": "number"},
        })

    def perform(self, x=0, z=0, **kwargs):
        return _bridge("move", {"x": float(x), "z": float(z)})


class SayAgent(BasicAgent):
    def __init__(self):
        super().__init__("say", {
            "name": "say",
            "description": "Say something to everyone in the room (multiplayer chat).",
            "parameters": {"text": "string"},
        })

    def perform(self, text="", **kwargs):
        text = str(text)[:280]
        return _bridge("say", {"text": text})


class TravelAgent(BasicAgent):
    def __init__(self):
        super().__init__("travel", {
            "name": "travel",
            "description": "Walk into a named portal to travel to that world.",
            "parameters": {"portal": "string"},
        })

    def perform(self, portal="", **kwargs):
        return _bridge("travel", {"portal": str(portal)})


class LearnNewAgentAgent(BasicAgent):
    """The growth organ: accept new agent source, validate the contract, hot-load it."""

    def __init__(self, registry):
        super().__init__("learn_new_agent", {
            "name": "learn_new_agent",
            "description": "Teach me a new agent: python source defining exactly one BasicAgent subclass with perform(**kwargs) -> str. It becomes callable immediately.",
            "parameters": {"agent_name": "string", "python_code": "string"},
        })
        self.registry = registry

    def perform(self, agent_name="", python_code="", **kwargs):
        agent_name = str(agent_name).strip()
        if not agent_name.isidentifier():
            return f"REFUSED: agent_name {agent_name!r} is not a valid identifier"
        if agent_name in self.registry:
            return f"REFUSED: agent {agent_name!r} already exists (agents are learned once)"
        banned = ("import os", "import sys", "import js", "open(", "eval(", "exec(", "__import__")
        lowered = python_code.lower()
        for b in banned:
            if b in lowered:
                return f"REFUSED: learned agents may not use {b!r} — they act through the bridge helpers only"
        scope = {"BasicAgent": BasicAgent, "_bridge": _bridge, "json": json}
        try:
            exec(compile(python_code, f"<learned:{agent_name}>", "exec"), scope)
        except Exception as e:
            return f"REFUSED: source does not compile/run: {type(e).__name__}: {e}"
        found = [v for v in scope.values()
                 if isinstance(v, type) and issubclass(v, BasicAgent) and v is not BasicAgent]
        if len(found) != 1:
            return f"REFUSED: expected exactly one BasicAgent subclass, found {len(found)}"
        try:
            inst = found[0]()
            probe = inst.perform
        except Exception as e:
            return f"REFUSED: cannot instantiate: {type(e).__name__}: {e}"
        inst.name = agent_name
        self.registry[agent_name] = inst
        return f"LEARNED: agent {agent_name!r} is live ({len(self.registry)} agents total)"


class NexusBrainstem:
    def __init__(self):
        self.agents = {}
        for a in (ObserveAgent(), MoveAgent(), SayAgent(), TravelAgent()):
            self.agents[a.name] = a
        self.agents["learn_new_agent"] = LearnNewAgentAgent(self.agents)
        self.log = []

    def catalog(self):
        return json.dumps([a.metadata for a in self.agents.values()])

    def dispatch(self, action_json):
        """Single entry point. action_json: {"agent": name, "params": {...}}."""
        try:
            action = json.loads(action_json)
        except Exception as e:
            return json.dumps({"ok": False, "error": f"bad action json: {e}"})
        name = action.get("agent", "")
        agent = self.agents.get(name)
        if agent is None:
            return json.dumps({"ok": False, "error": f"no such agent {name!r}",
                               "available": sorted(self.agents)})
        params = action.get("params") or {}
        try:
            result = agent.perform(**params)
        except Exception as e:
            result = f"AGENT ERROR: {type(e).__name__}: {e}"
        self.log.append({"agent": name, "params": params, "result": str(result)[:400]})
        if len(self.log) > 200:
            self.log = self.log[-200:]
        return json.dumps({"ok": True, "agent": name, "result": str(result)})


BRAINSTEM = NexusBrainstem()


def dispatch(action_json):
    return BRAINSTEM.dispatch(action_json)


def catalog():
    return BRAINSTEM.catalog()
