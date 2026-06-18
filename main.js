import { clamp } from "yeet:helpers";
import { displayWidth, clusterOffsets, clusterWidths, clip } from "yeet:tui:text";

/* flowball — a live newspaper page. The article is typeset into responsive
 * columns that re-fit as the terminal resizes (one column when narrow, up
 * to four when wide), under a masthead and a wrapping headline. Balls
 * bounce through the body like figures set into the page, and the columns
 * flow around them — justified flush against both the gutter and the ball,
 * closing up smooth as each ball drifts on.
 *
 * It is a `yeet:text` demo end to end: `displayWidth` measures every word
 * and drives the column wrap and full justification, `clusterOffsets` and
 * `clusterWidths` blit each line a grapheme cluster at a time so wide glyphs (CJK, emoji)
 * advance two columns and never tear at a column or ball edge, and `clip`
 * trims overlong header lines. Mixed-width text (日本語, 🌊, café) sets as
 * cleanly as ASCII.
 *
 * Re-fits live on `tty.on("resize")`. Args: frame cap, then ball count.
 * `yeet run -T . 600 2`. */

const hasTty = typeof tty !== "undefined";
const argv = (typeof yeet !== "undefined" && yeet.args && yeet.args._) || [];
const maxFrames = argv[0] ? Number(argv[0]) : Infinity;
const BALLS = clamp(argv[1] ? Number(argv[1]) : 2, 1, 8);

const MAST = "THE TERMINAL TIMES";
const HEADLINE = "Prose Learns to Flow Around the Stones";
const BYLINE = "Typeset live by yeet:text · columns re-fit as you resize · 日本語 · 🌊";

const PARAS = [
  "In a development long awaited by readers of fixed-width dispatches, text " +
    "in the terminal has learned to move. Words now part around any obstacle " +
    "set before them and close ranks behind it, measured not in bytes but in " +
    "the columns they truly paint.",
  "The technique rests on a single observation: a grapheme is one indivisible " +
    "thing. The family 👪, the flag 🏳️, the naïve café in Zürich, the characters " +
    "東京 and 日本語 — each claims its true width, and the layout refuses to split " +
    "a glyph or strand half of one at a margin.",
  "Correspondents note that the columns re-fit on demand. Narrow the page and " +
    "they collapse to one; widen it and the article spreads into two, three, " +
    "even four, the headline rewrapping above without a word lost.",
  "Justification, our typographers add, is handled per line and per fragment, " +
    "so the measure stays flush against both the gutter and the stone. Only the " +
    "last line of each paragraph is allowed to fall ragged, as propriety demands.",
  "Whether the stones will settle is unknown. For now they drift across the " +
    "page like river 🌊 rocks, and the prose, ever accommodating, simply flows " +
    "around them and carries on.",
];
const TOKENS = PARAS.map((p) => p.split(/\s+/).filter(Boolean).map((t) => ({ t, w: displayWidth(t) })));

/* ── colour ─────────────────────────────────────────────────────── */

const pack = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
const rOf = (c) => (c >> 16) & 255;
const gOf = (c) => (c >> 8) & 255;
const bOf = (c) => c & 255;

function hsv(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return pack(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

const BG = 0x0a0a0c;
const BODY = 0xcfd2da;   // newsprint off-white
const HEAD = 0xffffff;   // headline
const ACCENT = 0xd8b46a; // masthead gold
const RULE = 0x474d5c;   // rules and column gutters
const SUB = 0x9098a4;    // byline

/* ── layout state ───────────────────────────────────────────────── */

const GUTTER = 3, TARGET = 36, INDENT = 2, padX = 2, padY = 1;
const SX = 0.5;     // column → row-equivalent units (cells are ~2:1)
const SPEED = 0.42; // constant cruising speed in scaled units
const rnd = (a, b) => a + Math.random() * (b - a);

let W, H, bodyTop, ncol, colW;
let cellCh, cellFg, cellBg, cellBold, cellSkip;
let header, slots, balls;

const colX0 = (c) => c * (colW + GUTTER);

// Greedy-wrap a single string to `max` columns; returns plain left-aligned
// lines. Used for the headline, which sets ragged rather than justified.
function wrapPlain(str, max) {
  const ws = str.split(/\s+/).filter(Boolean).map((t) => ({ t, w: displayWidth(t) }));
  const out = [];
  let line = [], used = 0;
  for (const word of ws) {
    const need = (line.length ? 1 : 0) + word.w;
    if (line.length && used + need > max) { out.push(line); line = []; used = 0; }
    line.push(word); used += (line.length > 1 ? 1 : 0) + word.w;
  }
  if (line.length) out.push(line);
  return out.map((l) => l.map((w) => w.t).join(" "));
}

// The masthead: the title centred on a line of horizontal rule.
function mastLine() {
  const mid = ` ${MAST} `;
  const side = Math.max(0, W - displayWidth(mid));
  const l = side >> 1;
  return "─".repeat(l) + mid + "─".repeat(side - l);
}

// Build the header band and return the first body row beneath it.
function buildHeader() {
  header = [];
  let y = 0;
  header.push({ y, x0: 0, text: mastLine(), fg: ACCENT, bold: 1 }); y += 2;
  for (const line of wrapPlain(HEADLINE, W)) {
    header.push({ y, x0: 0, text: line, fg: HEAD, bold: 1 }); y++;
  }
  header.push({ y, x0: 0, text: clip(BYLINE, W), fg: SUB, bold: 0 }); y += 2;
  header.push({ y, x0: 0, text: "━".repeat(W), fg: RULE, bold: 0 }); y++;
  return y + 1;
}

// Flow the article into `need` justified lines wrapped to the column width,
// looping the paragraphs to fill the page. The first line of every
// paragraph (bar the very first) is indented; the last line of a paragraph
// sets ragged, so only it is left unjustified.
function wrapArticle(need) {
  const lines = [];
  let p = 0;
  while (lines.length < need) {
    const words = TOKENS[p % TOKENS.length];
    const indent = p === 0 ? 0 : INDENT;
    let i = 0, first = true;
    while (i < words.length) {
      const avail = colW - (first ? indent : 0);
      const picked = [];
      let used = 0;
      while (i < words.length) {
        const k = (picked.length ? 1 : 0) + words[i].w;
        if (picked.length && used + k > avail) break;
        used += k; picked.push(words[i]); i++;
      }
      const last = i >= words.length;
      lines.push({ words: picked, indent: first ? indent : 0, stretch: !last });
      first = false;
    }
    p++;
  }
  return lines.slice(0, need);
}

function setDims(cols, rows) {
  W = Math.max(48, cols | 0);
  H = Math.max(16, (rows | 0) - 1); // last terminal row holds the caption
  cellCh = new Array(W * H);
  cellFg = new Int32Array(W * H);
  cellBg = new Int32Array(W * H);
  cellBold = new Uint8Array(W * H);
  cellSkip = new Uint8Array(W * H);

  bodyTop = Math.min(buildHeader(), H - 3);
  const bodyRows = Math.max(1, H - bodyTop);
  ncol = clamp(Math.floor((W + GUTTER) / (TARGET + GUTTER)), 1, 4);
  colW = Math.floor((W - (ncol - 1) * GUTTER) / ncol);

  slots = [];
  const lines = wrapArticle(ncol * bodyRows);
  lines.forEach((ln, idx) => {
    const c = Math.floor(idx / bodyRows);
    if (c >= ncol) return;
    slots.push({ y: bodyTop + (idx % bodyRows), x0: colX0(c), ...ln });
  });

  // Balls live inside the body region, like figures set into the columns.
  if (!balls) balls = Array.from({ length: BALLS }, makeBall);
  else for (const b of balls) refit(b);
}

/* ── balls ──────────────────────────────────────────────────────── */

// A ball is an ellipse with a horizontal radius twice its vertical one, so
// it reads round despite terminal cells being about half as wide as tall.
function makeBall() {
  const bodyRows = H - bodyTop;
  const ry = clamp(Math.round(bodyRows * rnd(0.14, 0.22)), 2, Math.max(2, ((bodyRows - 2 * padY) >> 1) - 1));
  const rx = Math.min(Math.round(ry * 2), (W >> 1) - padX - 1);
  const th = rnd(0, 2 * Math.PI);
  const b = { rx, ry, hue: rnd(0, 360), spin: rnd(1.3, 2.8), vx: (Math.cos(th) * SPEED) / SX, vy: Math.sin(th) * SPEED };
  b.cx = rnd(rx + padX, W - 1 - rx - padX);
  b.cy = rnd(bodyTop + ry + padY, H - 1 - ry - padY);
  return b;
}

function refit(b) {
  const bodyRows = H - bodyTop;
  b.ry = clamp(b.ry, 2, Math.max(2, ((bodyRows - 2 * padY) >> 1) - 1));
  b.rx = Math.min(Math.round(b.ry * 2), (W >> 1) - padX - 1);
  b.cx = clamp(b.cx, b.rx + padX, W - 1 - b.rx - padX);
  b.cy = clamp(b.cy, bodyTop + b.ry + padY, H - 1 - b.ry - padY);
}

// Rotate a ball's velocity by `turn` radians in scaled space (where the
// path is isotropic) and renormalise to the cruising speed — so steering
// wanders and reacts without the ball ever winding down or running away.
function steer(b, turn) {
  let sx = b.vx * SX, sy = b.vy;
  const ca = Math.cos(turn), sa = Math.sin(turn);
  [sx, sy] = [sx * ca - sy * sa, sx * sa + sy * ca];
  const m = Math.hypot(sx, sy) || 1e-6;
  b.vx = ((sx / m) * SPEED) / SX; b.vy = (sy / m) * SPEED;
}

function step() {
  for (const b of balls) {
    b.cx += b.vx; b.cy += b.vy;
    const mx = b.rx + padX, my = b.ry + padY;
    let hit = false;
    if (b.cx < mx) { b.cx = mx; b.vx = Math.abs(b.vx); hit = true; }
    if (b.cx > W - 1 - mx) { b.cx = W - 1 - mx; b.vx = -Math.abs(b.vx); hit = true; }
    if (b.cy < bodyTop + my) { b.cy = bodyTop + my; b.vy = Math.abs(b.vy); hit = true; }
    if (b.cy > H - 1 - my) { b.cy = H - 1 - my; b.vy = -Math.abs(b.vy); hit = true; }
    // A constant gentle wander, plus a hard random kick off a wall, so the
    // path is never a clean straight bounce. Colour drifts always, jumps on
    // impact.
    steer(b, hit ? rnd(-0.85, 0.85) : rnd(-0.14, 0.14));
    b.hue += b.spin + (hit ? rnd(25, 70) : 0);
  }
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      const dx = (a.cx - b.cx) * SX, dy = a.cy - b.cy;
      const dist = Math.hypot(dx, dy) || 1e-6, mind = a.ry + b.ry + padY;
      if (dist >= mind) continue;
      const nx = dx / dist, ny = dy / dist, sep = (mind - dist) / 2;
      a.cx += (nx * sep) / SX; a.cy += ny * sep;
      b.cx -= (nx * sep) / SX; b.cy -= ny * sep;
      const avx = a.vx * SX, bvx = b.vx * SX;
      const rel = (avx - bvx) * nx + (a.vy - b.vy) * ny;
      if (rel < 0) {
        a.vx = (avx - rel * nx) / SX; a.vy -= rel * ny;
        b.vx = (bvx + rel * nx) / SX; b.vy += rel * ny;
        steer(a, rnd(-0.4, 0.4)); steer(b, rnd(-0.4, 0.4));
        a.hue += rnd(20, 50); b.hue += rnd(20, 50);
      }
    }
  }
}

/* ── text flow ──────────────────────────────────────────────────── */

// A ball's column half-span at row `y` for an ellipse of semi-axes
// (ax, ay) centred at `cyv`; 0 when the row is clear of it.
function halfSpan(y, cyv, ax, ay) {
  const ny = (y - cyv) / ay;
  if (ny <= -1 || ny >= 1) return 0;
  return ax * Math.sqrt(1 - ny * ny);
}

// Subtract the column interval [l, r) from a set of `[s0, e)` spans.
function cut(segs, l, r) {
  const out = [];
  for (const s of segs) {
    if (r <= s.s0 || l >= s.e) { out.push(s); continue; }
    if (s.s0 < l) out.push({ s0: s.s0, e: l });
    if (r < s.e) out.push({ s0: r, e: s.e });
  }
  return out;
}

// The free spans of row `y` between `start` and `end`, with every ball's
// exclusion ellipse (drawn size plus padding) cut out.
function freeSpans(start, end, y) {
  let segs = [{ s0: start, e: end }];
  for (const b of balls) {
    const hs = halfSpan(y, b.cy, b.rx + padX, b.ry + padY);
    if (hs <= 0) continue;
    segs = cut(segs, Math.max(start, Math.floor(b.cx - hs)), Math.min(end, Math.ceil(b.cx + hs) + 1));
  }
  return segs;
}

// Full-justify `words` to exactly `segW` columns, the extra space spread
// across the gaps Bresenham-style. A lone word sits flush at the leading
// edge.
function justify(words, segW) {
  if (words.length === 1) return words[0].t;
  const ink = words.reduce((a, x) => a + x.w, 0);
  const gaps = words.length - 1;
  const extra = segW - ink - gaps;
  const base = Math.floor(extra / gaps), rem = extra % gaps;
  let s = words[0].t;
  for (let i = 1; i < words.length; i++) {
    s += " ".repeat(1 + base + (i <= rem ? 1 : 0)) + words[i].t;
  }
  return s;
}

// Lay one column line into its free spans. Words that no longer fit beside
// a ball are dropped for this frame and return as the ball moves along; a
// ragged (last) line is left-aligned rather than stretched.
function placeSlot(s) {
  let wi = 0;
  for (const seg of freeSpans(s.x0 + s.indent, s.x0 + colW, s.y)) {
    const segW = seg.e - seg.s0;
    if (segW <= 0) continue;
    const picked = [];
    let used = 0;
    while (wi < s.words.length) {
      const need = (picked.length ? 1 : 0) + s.words[wi].w;
      if (used + need > segW) break;
      used += need; picked.push(s.words[wi]); wi++;
    }
    if (!picked.length) continue;
    const text = s.stretch ? justify(picked, segW) : picked.map((p) => p.t).join(" ");
    blit(text, seg.s0, s.y, BODY, 0);
  }
}

/* ── grid ───────────────────────────────────────────────────────── */

function blit(text, col, y, fg, bold) {
  let c = col;
  const off = clusterOffsets(text), wd = clusterWidths(text);
  for (let i = 0; i < wd.length; i++) {
    const w = wd[i];
    if (w <= 0) continue; // skip zero-width clusters (lone combiners, controls)
    if (c + w - 1 >= W) continue;
    const cluster = text.slice(off[i], off[i + 1]);
    const o = y * W + c;
    cellCh[o] = cluster; cellFg[o] = fg; cellBg[o] = BG; cellBold[o] = bold; cellSkip[o] = 0;
    if (w === 2) { cellSkip[o + 1] = 1; cellCh[o + 1] = " "; } // wide-glyph tail
    c += w;
  }
}

const LX = -0.45, LY = -0.55, LZ = 0.70; // key light, upper-left

function drawBall(b) {
  const base = hsv(b.hue, 0.72, 1.0);
  const y0 = Math.max(0, Math.ceil(b.cy - b.ry)), y1 = Math.min(H - 1, Math.floor(b.cy + b.ry));
  for (let y = y0; y <= y1; y++) {
    const hs = halfSpan(y, b.cy, b.rx, b.ry);
    if (hs <= 0) continue;
    const x0 = Math.max(0, Math.ceil(b.cx - hs)), x1 = Math.min(W - 1, Math.floor(b.cx + hs));
    for (let x = x0; x <= x1; x++) {
      const nx = (x - b.cx) / b.rx, ny = (y - b.cy) / b.ry;
      const z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const diff = Math.max(0, nx * LX + ny * LY + z * LZ);
      const spec = Math.pow(diff, 18), sh = 0.22 + 0.78 * diff;
      const col = pack(
        Math.min(255, rOf(base) * sh + 255 * spec),
        Math.min(255, gOf(base) * sh + 255 * spec),
        Math.min(255, bOf(base) * sh + 255 * spec),
      );
      const o = y * W + x;
      cellCh[o] = " "; cellBg[o] = col; cellFg[o] = col; cellBold[o] = 0; cellSkip[o] = 0;
    }
  }
}

/* ── render ─────────────────────────────────────────────────────── */

const colorEsc = (f, b) =>
  `\x1b[38;2;${rOf(f)};${gOf(f)};${bOf(f)};48;2;${rOf(b)};${gOf(b)};${bOf(b)}m`;

function buildFrame(caption) {
  for (let i = 0; i < cellCh.length; i++) {
    cellCh[i] = " "; cellFg[i] = BG; cellBg[i] = BG; cellBold[i] = 0; cellSkip[i] = 0;
  }
  for (const h of header) blit(h.text, h.x0, h.y, h.fg, h.bold);
  for (const s of slots) placeSlot(s);
  for (const b of balls) drawBall(b);

  const parts = ["\x1b[H"];
  for (let y = 0; y < H; y++) {
    parts.push(`\x1b[${y + 1};1H\x1b[0m`);
    let curFg = -1, curBg = -1, curBold = 0;
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      if (cellSkip[o]) continue;
      const ch = cellCh[o], bg = cellBg[o], bold = cellBold[o];
      if (bold !== curBold) { parts.push(bold ? "\x1b[1m" : "\x1b[22m"); curBold = bold; }
      // A space shows only its background, so keep the current foreground
      // to spare a needless escape across long runs of blanks.
      const fg = ch === " " && curFg >= 0 ? curFg : cellFg[o];
      if (fg !== curFg || bg !== curBg) { parts.push(colorEsc(fg, bg)); curFg = fg; curBg = bg; }
      parts.push(ch);
    }
  }
  parts.push(`\x1b[0m\x1b[${H + 1};1H\x1b[2m${clip(caption, W - 1)}\x1b[0m\x1b[K`);
  return parts.join("");
}

function paint(caption) {
  const out = buildFrame(caption);
  if (hasTty) tty.frame(() => tty.write(out));
  else console.log(out);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (hasTty) { const { rows, cols } = tty.size(); setDims(cols, rows); }
else setDims(120, 40);

if (hasTty) {
  tty.alt(); tty.hideCursor(); tty.clear();
  tty.on("resize", ({ rows, cols }) => { setDims(cols, rows); tty.clear(); });
} else {
  console.log("\x1b[2J\x1b[?25l");
}

let frame = 0;
try {
  while (frame < maxFrames) {
    step();
    paint(`  yeet:text · ${ncol}-column newspaper · ${balls.length} figures · resize to re-flow`);
    frame++;
    await sleep(33);
  }
} finally {
  if (hasTty) { tty.showCursor(); tty.main(); }
  else console.log("\x1b[?25h");
}
