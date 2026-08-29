# tests

Re-runnable checks that do not need a browser.

    node tests/stop_generation.test.js                 # the working tree's driver
    node tests/stop_generation.test.js /path/to/old.js # any other copy, for an A/B

## Why these run in node

A Chrome tab that has been hidden for more than about five minutes gets
*intensive throttling*: `setTimeout` fires roughly once a minute and
`requestAnimationFrame` not at all. Every timing measurement taken through such a
tab is wrong, and this repo has already produced three phantom bug reports that
way. Anything time-dependent belongs here, where the clock is real. What genuinely
needs a browser — WebRTC, three.js, the relayed avatars — has to be watched in a
tab that is actually on screen.

## stop_generation.test.js

Loads the real `ai/autodrive.js` behind a small `window`/`document` stub and pins
down the kill switch, which has now been broken in two different directions:

- **A** a turn's own top-level tool calls must not look like an operator cancelling
  it (`drive.mind()` typed into the tab CLI runs `turn()` with nothing on the
  stack, so each of its tool calls is top-level)
- **B** a real `stop()` must still be visible to that same check
- **C** a nested run issued after a stop must refuse, and run no steps
- **D** the driver restarts cleanly afterwards
- **E** a throwing `onStep` escapes `run()`, but must not strand `_depth` above
  zero — that would make every later top-level run look nested for the life of
  the page
- **F** the driver still works after that escape

Measured across three revisions:

| driver | self-cancels a turn | steps run after Stop | |
|---|---|---|---|
| `1ed46c8` | no | **2** | kill switch could be re-armed by the work it was killing |
| `63f947b` | **yes** | 0 | kill switch fixed, self-cancel introduced |
| current | no | 0 | both correct |
