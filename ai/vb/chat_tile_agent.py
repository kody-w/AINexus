"""chat_tile_agent.py — a conversation, worn down until only it is left.

A chat export is usually a .json: a bag of messages with no identity, no verification, and no
way to compose with anything. This wears it into a TILE instead — the same thing every world in
this estate is: a frame with a particle and a wave, standing on its own, composable upward.

The point of calling it worn-down rather than extracted: a full frame holds a whole world, and
what survives here is the smallest possible residue of one — the little conversation that was
had. Everything else has been worn away, and the tile SAYS what was worn away, because a residue
that pretends to be complete is the same lie as a hologram pretending to be a body.

And the time is not metadata. When a conversation happened, how long it took, whether it came in
a rush or in long silences, who did most of the talking — that shape carries as much as the
words, and it travels with the tile so anything downstream can be influenced by it.

Pure: no clock, no randomness. Everything is read off the export.
"""

import hashlib
import json
import re
from agents.basic_agent import BasicAgent


def _parse_time(v):
    """Seconds since epoch from whatever shape the export used, or None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v / 1000.0 if v > 1e11 else v)
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})", s)
    if not m:
        return None
    y, mo, d, h, mi, se = (int(x) for x in m.groups())
    # days since epoch, civil-from-days; no library, no locale, no surprises
    yy = y - (1 if mo <= 2 else 0)
    era = (yy if yy >= 0 else yy - 399) // 400
    yoe = yy - era * 400
    doy = (153 * (mo + (-3 if mo > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days = era * 146097 + doe - 719468
    return float(days * 86400 + h * 3600 + mi * 60 + se)


class ChatTileAgent(BasicAgent):
    def __init__(self):
        self.name = "ChatTile"
        self.metadata = {
            "name": self.name,
            "description": (
                "Wear a chat export down into a tile: the conversation as the only surviving part "
                "of a frame, with the shape of it in time, ready to compose or be sloshed."
            ),
            "parameters": {"type": "object", "properties": {
                "chat": {"type": "string", "description": "the chat export as JSON: a list of messages, or {messages:[...]}"},
                "about": {"type": "string", "description": "optional: what this conversation was for"},
            }, "required": ["chat"]},
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        try:
            raw = json.loads(kwargs.get("chat") or "[]")
        except Exception:
            return json.dumps({"error": "not a chat export"})

        msgs = raw.get("messages") if isinstance(raw, dict) else raw
        if not isinstance(msgs, list):
            return json.dumps({"error": "no messages in that export"})

        lines, times, who = [], [], {}
        for m in msgs:
            if not isinstance(m, dict):
                continue
            speaker = str(m.get("role") or m.get("from") or m.get("speaker") or "someone")
            text = m.get("content") if m.get("content") is not None else m.get("text")
            if text is None:
                continue
            text = re.sub(r"\s+", " ", str(text)).strip()
            if not text:
                continue
            t = _parse_time(m.get("at") or m.get("time") or m.get("timestamp") or m.get("utc"))
            lines.append({"who": speaker, "said": text[:600]})
            who[speaker] = who.get(speaker, 0) + len(text)
            if t is not None:
                times.append(t)

        # ── the shape of it in time ──────────────────────────────────────
        # Not metadata. A conversation that happened at 3am in four bursts over an hour is a
        # different thing from the same words typed straight through at noon, and anything
        # downstream deserves to be influenced by which one it was.
        shape = {"turns": len(lines)}
        if times:
            times.sort()
            span = int(round(times[-1] - times[0]))
            gaps = [int(round(times[i + 1] - times[i])) for i in range(len(times) - 1)]
            longest = max(gaps) if gaps else 0
            median = sorted(gaps)[len(gaps) // 2] if gaps else 0
            shape.update({
                "began_at": int(times[0]),
                "span_seconds": span,
                "hour_of_day": int((times[0] % 86400) // 3600),
                "longest_silence": longest,
                "median_gap": median,
                # a rush is a conversation whose longest pause is not much longer than its typical
                # one; a vigil is one with a silence many times the rhythm
                "rhythm": "a rush" if longest <= max(2, median * 3)
                          else "a vigil" if longest > max(60, median * 20) else "an ordinary back and forth",
            })
        if who:
            loudest = max(who.items(), key=lambda kv: kv[1])
            total = sum(who.values()) or 1
            shape["loudest"] = loudest[0]
            shape["loudest_share_milli"] = int(round(1000 * loudest[1] / total))
            shape["voices"] = len(who)

        body = json.dumps(lines, sort_keys=True).encode("utf-8")
        tile = {
            "kind": "chat",
            "about": (kwargs.get("about") or "").strip()[:200] or None,
            "lines": lines,
            "shape": shape,
            # what a full frame would have held and this does not
            "worn_away": ["the world it was had in", "who else was present", "what was done afterwards",
                          "everything either of them already knew"],
            "residue_of": "a full frame; this is the conversation and nothing else",
            "seed": hashlib.sha256(body).hexdigest()[:12] + "#chat",
        }
        return json.dumps(tile)
