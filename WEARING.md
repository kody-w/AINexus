# Wearing

**`wear(record, key) → tile`**

A record, plus a key you can say out loud, yields a complete world that neither of them
contained. The same pair always produces the same tile — the same bytes, on any machine,
forever, with nothing passing between the two machines but the key.

This document is normative. An implementation that produces the bytes in
[`WEARING-VECTORS.json`](WEARING-VECTORS.json) conforms; one that does not, does not.

---

## 1. What it is, and what it is not

A **record** is a rapp/1 frame — something that actually happened, with a hash.
A **key** is any string. A **tile** is a new rapp/1 frame: a complete, playable starting
condition, carrying who is present, where they stand, what they are already doing, and what is
already wrong.

Wearing is **not compression** — nothing is recovered; something new is derived.
It is **not procedural generation** — that starts from nothing, while every worn tile descends
from a record that really exists and says so in `derived_from`.
It is **not a fork** — a fork continues a line; wearing starts one.

The name is the estate's own verb: a key *wears* a record down into a tile.

## 2. Requirements

An implementation MUST have SHA-256 and MUST implement [rapp/1](https://github.com/kody-w/rapp-1)
frames — the eleven keys, JCS canonicalisation (RFC 8785), and the two hash spaces
`rapp/1:particle` and `rapp/1:wave`. Wearing adds no new cryptography and no new frame type.

A tile is an ordinary frame. It MUST use a registered `kind` whose family matches its stream's
form (rapp/1 §7.2). These vectors use `memory.save` on a memory-stream.

## 3. The keystream (normative)

Every choice comes from one stream of octets, and the stream is nothing but SHA-256:

```
block(i) = SHA-256( utf8(record_hash) ‖ 0x3A ‖ utf8(key) ‖ 0x3A ‖ utf8(decimal i) )
stream   = block(0) ‖ block(1) ‖ block(2) ‖ …
```

- `record_hash` is the record's `frame_hash`, 64 lowercase hex.
- `key` is the wear key as UTF-8. The empty string is a valid key.
- `decimal i` counts blocks from `0`, no leading zeros.
- `0x3A` is a single colon octet.

Octets are consumed from `stream` in order and never reused.

**Two draws are defined on it.** Both reject rather than fold, because `octet mod k` is biased
for every `k` that does not divide 256, and a specification that ships a bias makes two
conforming implementations disagree about fairness:

```
uniform(k):            # one octet
    limit = 256 − (256 mod k)
    loop: o = next octet; if o < limit: return o mod k

wide(k, n):            # n octets, big-endian
    span  = 256^n
    limit = span − (span mod k)
    loop: v = next n octets as a big-endian integer; if v < limit: return v mod k
```

## 4. The draw order (normative)

Changing this order changes every tile in the world. It is written down rather than left to
whatever order an implementation happens to read in.

Let `roster` be the record's `payload.requires.players`, in the order the record gives them, and
`R = len(roster)`. `R` MUST be at least 1.

1. **How many are present.** `n = clamp(2 + uniform(R−1), 2, R)`. When `R = 1`, skip the draw and
   set `n = 1`.
2. **Who.** Fisher–Yates over a copy of `roster`, for `i` from `R−1` down to `1`:
   `j = uniform(i+1)`, then swap positions `i` and `j`. The first `n` of the result are present,
   in that order.
3. **Each one, in that order** — four draws per person, always in this sequence:
   `x = uniform(29) − 14`, `z = uniform(29) − 14`,
   `standing = INTENT[uniform(6)]`, `where = PLACE[uniform(6)]`.
4. **The lens.** `lens = LENS[uniform(5)]`.
5. **What is already wrong.** `mood = MOOD[uniform(8)]`.
6. **The moment.** `offset = wide(86400, 3)` seconds, added to the record's `utc`.

## 5. The vocabularies (normative)

Fixed, ordered, and indexed from zero. Variety comes from the key crossing these with real
records, not from the lists being long.

```
INTENT = [hold, wander, follow, approach, go, talk]
PLACE  = ["by the entrance", "against the west wall", "in the middle of the floor",
          "near the back", "up on the high side", "right by the door"]
LENS   = [plain, nightshift, closeup, wide, quiet]
MOOD   = ["nothing has happened yet",
          "something was said earlier and not resolved",
          "one of them has just arrived",
          "they have been here too long",
          "a thing has gone missing",
          "someone is about to leave",
          "they are waiting for a seventh who has not come",
          "the lights just changed"]
```

## 6. The tile

```
kind       memory.save
stream_id  <record's bare rappid> ":" "wear-" <first 12 hex of H("rapp/1:particle", {"wear": key})>
seq        0
prev       null
prev_wave  null
utc        record.utc + offset seconds, as rapp/1 requires it
payload.asserts   { tile, derived_from, of_stream, cast[], lens, mood, seed }
payload.requires  { players: [ids of the cast, in order] }
```

`cast[i]` is `{ id, at: { x, z }, standing, where }`. `seed` is
`first 12 hex of derived_from` + `"#"` + `key`.

**The stream is derived, never minted.** A minted stream makes a tile reproducible only inside
one process: a fresh run mints a fresh rappid, `stream_id` changes, and `frame_hash` changes with
it. The tile hangs off the record it was worn from.

## 7. What breaks determinism

- **Floats anywhere.** rapp/1 is I-JSON; JCS refuses non-integers, because `0.1` does not
  canonicalise identically in every language. Carry fixed-point integers.
- **A minted stream_id**, per §6.
- **Reading a clock.** Every value including `utc` comes from the key.
- **Unicode.** The key is hashed as UTF-8 bytes. Two keys that look identical but normalise
  differently ARE different keys. Implementations SHOULD NFC-normalise before hashing and MUST
  document whether they do.

## 8. Test vectors

[`WEARING-VECTORS.json`](WEARING-VECTORS.json) carries the record in full, the roster, and the
complete resulting tile for each key. Diff whole frames, not just hashes.

Record: ``5cc0d384f1be6317070c68a167445f0e4ad6c7d63f3139a691ba3c40047c9578``
Roster: `ada, bo, cy, del, eze`

| key | tile `frame_hash` | octets drawn | present | lens | mood |
|---|---|---|---|---|---|
| `0` | `1761632c34521431…` | 26 | 4 | quiet | the lights just changed |
| `1` | `707c6117be9d9c2d…` | 24 | 3 | closeup | someone is about to leave |
| `7` | `2b912ed6aed97de9…` | 23 | 3 | quiet | they have been here too long |
| `the-night-the-power-went` | `586618d5da97141f…` | 27 | 4 | closeup | someone is about to leave |
| `a room with two moons` | `b058c26cc46f299f…` | 26 | 4 | closeup | something was said earlier and not |
| `seven-chairs-six-people` | `de21a131874807e5…` | 31 | 4 | nightshift | nothing has happened yet |
| `(empty)` | `0e8c376ac729a880…` | 26 | 4 | quiet | something was said earlier and not |
| `é-accented-key` | `ad07de59e359ceb6…` | 26 | 4 | closeup | they have been here too long |
| `9007199254740991` | `efd98ab79b925d27…` | 32 | 5 | wide | someone is about to leave |

Check with `node tools/check_vectors.cjs`.

## 9. What this does not specify

How a tile is *played*. Wearing produces a starting condition; what a world does with it —
physics, rendering, who speaks first — is out of scope and always will be. Two implementations
that agree on these bytes may show you entirely different things, and that is the point: the
tile is the contract, not the experience.
