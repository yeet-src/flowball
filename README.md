# flowball — a live newspaper page that flows around bouncing balls

An article typeset into responsive columns under a masthead and headline.
The columns re-fit as you resize — one when narrow, up to four when wide —
and balls bounce through the body like figures set into the page, the
columns flowing around them flush against both the gutter and the ball,
closing up smooth as each ball drifts on.

```
──────────────────────── THE TERMINAL TIMES ────────────────────────

Prose Learns to Flow Around the Stones
Typeset live by yeet:text · columns re-fit as you resize · 日本語 · 🌊
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
In a development long awaited   flows around them and carries   prose, ever
by readers of fixed-width       on.                             flows around
dispatches, text in the           In a development long           In a deve-
terminal has learned to move.   awaited by readers of   ●●●●    readers of f-
Words now part around    ●●●    fixed-width dispatches ●●●●●●   text in the t-
obstacle set before    ●●●●●●   text in the terminal   ●●●●●●   move. Words n-
ranks behind it, measu   ●●●    move. Words now part     ●●●    obstacle set
but in the columns they truly   around any obstacle set         ranks behind
```

## Run

```sh
yeet run -T .            # live, sizes to your terminal; resize to re-flow
yeet run -T . 600 3      # stop after 600 frames, 3 balls (figures)
yeet run .               # piped (no PTY): prints frames to stdout
```

Args are positional: frame cap first (omit for unbounded), then ball count
(1–8, default 2).

## Why it's a `yeet:text` demo

Newspaper layout is the case `yeet:text` is built for — measure in real
display columns, wrap, justify, and never split a glyph:

- **`displayWidth`** measures every word once and drives both the column
  wrap and full justification, so each line fills its measure exactly.
- **`eachColumn`** blits each line one grapheme cluster at a time, so a
  wide glyph (CJK, emoji) advances two columns and is never torn across a
  column edge or stranded at a ball's margin — `👪 🏳️ 東京 日本語 🌊 café`
  set inline as cleanly as ASCII.
- **`clip`** trims the masthead, byline, and caption to the page width
  without cutting a cluster in half.

## How it works

1. **Set the page.** On start and on every `tty.on("resize")`, the header
   (masthead, wrapping headline, byline, rule) is laid out, the body height
   that remains is divided into `clamp(⌊(W+gutter)/(target+gutter)⌋, 1, 4)`
   equal columns, and the article is wrapped continuously into justified
   lines — paragraphs indented, last lines ragged — then poured down column
   one, then column two, like real newspaper flow. Each line becomes a slot
   pinned to a column and row.
2. **Flow per frame.** Each frame, every slot is re-laid into the free
   spans left after each ball's exclusion ellipse (drawn radius plus a
   one-cell padding ring) is cut out of its column. A slot the balls miss
   renders unchanged — so the page stays stable instead of boiling, and
   only the text beside a ball moves.
3. **Drop, don't shift.** Words that no longer fit beside a ball are
   dropped for that frame rather than pushed to later lines, which keeps
   every other line anchored. They return as the balls move on.
4. **The balls** are shaded disks (Lambert diffuse + a tight specular
   highlight) confined to the body region, drawn over the text into the
   holes the exclusion ellipses already cleared. Their hue drifts every
   frame and jumps on every impact. They move chaotically — a constant
   gentle wander plus a hard random kick off each wall, never a clean
   straight bounce — and still collide elastically with each other (resolved
   in a scaled space where each ellipse is a circle, so two figures never
   merge into one blob). Steering rotates the velocity and renormalises it
   to a constant speed, so the motion stays lively without winding down or
   running away.

The balls are ellipses with a horizontal radius twice the vertical one, so
they read round despite terminal cells being about half as wide as tall.

## Known shortcut

The whole page repaints every frame (no cell diffing, unlike `beachballs`
or `mathshow`), which is a lot of bytes on a large terminal. The lossy
reflow in step 3 also means text beside a ball is dropped, not re-wrapped
onto later lines — a real document renderer would push it down instead.

## Make it something else

- Swap the exclusion shape in `freeSpans()`/`cut()` — a rectangle per ball
  gives magazine pull-quote boxes instead of round holes.
- Feed real prose as `PARAS` (a README, an RSS item, a man page) and you
  have a responsive reader that flows around whatever you set into it.
- Drop the balls and you have a plain responsive multi-column typesetter.
