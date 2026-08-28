"""NEXUS — the same reply, plus the speaker's next move in the world.

A player in a 3D world has to do two things at once: say something a person would say,
and take a step. This sense gives the mind a second channel for the step, so the words
stay human and the action stays machine-readable — one turn, two outputs, no parsing of
prose for intent.

The block is a single JSON object using ONLY the driver's verb set, so a mind can never
name an action the hands do not have (kody-w/AINexus ai/autodrive.js):

    look {dx,dy} · walk {dir,ms} · click {} · aim {portal} · travel {portal}
    say {text} · ask {text} · press {selector} · wait {ms} · see {} · scan {steps,deg}
    carry {payload}

Install: drop in rapp_brainstem/utils/senses/. The brainstem auto-discovers *_sense.py at
startup; restart the brainstem.
"""

name = "nexus"
delimiter = "|||NEXUS|||"
response_key = "nexus_response"
wrapper_tag = "nexus"
system_prompt = (
    "After your main reply, append `|||NEXUS|||` followed by ONE JSON object and nothing "
    "else: your next move in the 3D world you are standing in. Use exactly this shape — "
    '{\"do\": \"<verb>\", ...args} — and only these verbs: look {dx,dy}, walk {dir:'
    "forward|back|left|right, ms}, click {}, aim {portal}, travel {portal}, say {text}, "
    "ask {text}, press {selector}, wait {ms}, see {}, scan {steps,deg}, carry {payload}. "
    "Choose from what you were actually shown: the percepts name your position, the portals "
    "in reach, who else is present, the recent chat, and a picture of what you can see. Do "
    "not invent a portal or a person that is not in the percepts. Prefer `see` or `scan` "
    "when the picture is stale or blank and you are about to move; prefer `say` when someone "
    "spoke to you; prefer `wait` over acting when nothing has changed. If you are unsure, "
    '{\"do\": \"see\"} is always a legal move. Emit exactly one object — never a list, never '
    "prose inside the block. Always emit — empty is not allowed."
)

__manifest__ = {
    "schema": "rapp-sense/1.0",
    "name": "@kody-w/nexus",
    "version": "0.1.0",
    "description": "NEXUS — the same reply, plus the speaker's next move in the world as one JSON action.",
}
