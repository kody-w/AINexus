#!/bin/bash
# mutation_check.sh — are the tests real?
#
# The suite used to be proved honest by running it against the commit each case was
# written for. That stopped being possible when the driver moved to sessions: the old
# revisions do not speak the API the tests now use. So instead we put each bug back INTO
# the current file and require the suite to fail. A case that still passes with its own
# bug restored is not testing anything.
#
# Each mutation removes a BEHAVIOUR, not a line. The first version of this script removed
# single lines and four of seven went unnoticed — not because the tests were weak but
# because the guards are redundant with each other, so any one of them alone is masked by
# its neighbour. Deleting one line asks "is this line load-bearing"; deleting the whole
# mechanism asks "does the suite notice if this protection is gone", which is the question
# worth answering.
#
#   ./tests/mutation_check.sh
# exit 0 = every mutation was caught.
set -u
cd "$(dirname "$0")/.." || exit 1
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fails=0

# mutate <name> <from1> <to1> [<from2> <to2> ...]
mutate () {
  local name="$1"; shift
  local f="$TMP/m.js"
  python3 - "ai/autodrive.js" "$f" "$@" <<'PY'
import sys, pathlib
src, out = sys.argv[1], sys.argv[2]
pairs = sys.argv[3:]
s = pathlib.Path(src).read_text()
for i in range(0, len(pairs), 2):
    a, b = pairs[i], pairs[i + 1]
    if a not in s:
        print("ANCHOR-MISSING:", a[:60]); raise SystemExit(3)
    s = s.replace(a, b, 1)
pathlib.Path(out).write_text(s)
PY
  if [ $? -eq 3 ]; then
    printf "  %-52s ANCHOR MISSING (mutation is stale)\n" "$name"; fails=$((fails+1)); return
  fi
  if node tests/stop_generation.test.js "$f" >/dev/null 2>&1; then
    printf "  %-52s NOT CAUGHT  <-- suite passes with this bug back\n" "$name"
    fails=$((fails+1))
  else
    printf "  %-52s caught\n" "$name"
  fi
}

echo "putting each bug back in turn; every one must be caught:"

# ── the kill switch does not kill ────────────────────────────────────────────
mutate "stop() no longer kills the session" \
  "      if (api._session) api._session.alive = false;" \
  "      if (api._session) { /* mutation */ }"

# ── nothing refuses work issued by killed work (all three guards) ────────────
mutate "nothing refuses work from a killed session" \
  "        if (!session.alive) return 'stopped';   // the work that issued this is over" \
  "        if (false) return 'stopped';" \
  "          if (!session.alive) return 'stopped';" \
  "          if (!api._running) return 'stopped';" \
  "      } while (session.alive && program && program.loop);" \
  "      } while (program && program.loop);"

# ── the teardown is gone (round 6) ──────────────────────────────────────────
mutate "stop() no longer undoes what it installed" \
  "      try { api.release(); } catch (e) {}" \
  "      try { /* mutation */ } catch (e) {}"

# ── the awaiting verbs ignore the session (round 7's critical) ───────────────
mutate "the awaiting verbs ignore the session" \
  "        if (!live()) return false;         // the operator stopped us mid-turn" \
  "        if (false) return false;" \
  "      if (!live()) { log('stopped during the approach — not entering', name); return false; }" \
  "      if (false) { return false; }" \
  "      if (!live()) return null;            // ...and do not report a walk that was cut short" \
  "      if (false) return null;"

# ── a turn re-adopts instead of refusing (round 5) ───────────────────────────
mutate "mind runs under a killed session" \
  "      if (!mine.alive) { log('turn belongs to a stopped session — not thinking'); return null; }" \
  "      if (false) { return null; }"

# ── a camera loop has no identity of its own (round 7) ──────────────────────
mutate "camera loops stop carrying their own serial" \
  "        if (!api._filming || api._filmSeq !== myFilm) return;" \
  "        if (!api._filming) return;"

echo
if [ "$fails" -eq 0 ]; then
  echo "every mutation caught — the suite tests what it claims to"
else
  echo "$fails mutation(s) NOT caught — those behaviours are unprotected by the suite"
fi
exit "$fails"
