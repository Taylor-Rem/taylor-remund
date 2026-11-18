# The pictures approved at gate G1

Taylor passed G1 on 2026-11-18 (`REWRITE.md` § Approval log). These six
frames are the standard: every later gate compares what is new against
them, and anything below them is finished or removed (`REWRITE.md` § G P1).

They were taken on 2026-11-17 from `rewrite` at `30677a4`, on the reference
laptop (AMD Radeon, Chrome through ANGLE on Vulkan), from the development
page `/dev/vignette/?hud=0&manual=1`, where `manual=1` advances one
simulation step per drawn frame so a frame is the same every time.
`window.__vignette.goto(step, shot)` puts the camera at a named framing and
the simulation at a step.

| file | size | how |
|---|---|---|
| `1-whole-1440x900.png` | 1440×900 | `goto(500, 'home')` |
| `2-phone-390x844.png` | 390×844 at 2× | `goto(500, 'home')`, a phone held upright |
| `3-button-close.png` | 1440×900 | `goto(500, 'button')` |
| `4-fetch-close.png` | 1440×900 | `goto(500, 'fetch')` |
| `5-patch-close.png` | 1440×900 | `goto(150, 'patch')` |
| `6-mid-action-card.png` | 1440×900 | `goto(150, 'home')`, the Button pressed, then 420 steps: the cue card is up |

The scene they show is the vignette, a slice of the bench. The pieces in it
go on being improved, so a frame rendered today will differ; these files
are not regenerated. They are what a new render is held beside.
