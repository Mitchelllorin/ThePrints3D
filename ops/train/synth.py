"""
Synthetic architectural floor-plan generator for wall segmentation training.

Why this exists
---------------
The original training pipeline targeted CubiCasa5k, which is CC BY-NC and
therefore unusable for a commercial product (see README.md).  This module
procedurally generates (floor-plan image, wall-mask) pairs with *perfect*
ground truth, under our own copyright, at unlimited volume.

Approach
--------
1.  A rectangular building footprint is recursively split into rooms.
2.  Every split edge becomes an interior partition; the footprint boundary
    becomes thicker exterior walls.  Doors are cut as gaps; windows are
    openings that keep the wall material.
3.  The union of all wall rectangles (minus door gaps) is rasterised as a
    boolean array — this *is* the ground-truth mask.  Nothing is drawn into
    the mask that is not a wall, and every wall drawn into the image comes
    from the same array, so image/mask alignment is exact by construction.
4.  The visible drawing is rendered *from* that same array:
      - poche  : the wall region is filled solid / hatched
      - double : the outline of the wall region is stroked
        (computed as `region XOR erode(region)`, so junctions clean up for
        free — no T/L intersection special-casing needed)
    Then dimension strings, room labels, door swings, window symbols,
    hatch fills, north arrow, title block and border are drawn on top of the
    image only.
5.  `--augment` applies a scan/photo degradation chain so the model sees
    something closer to a phone photo of a printed sheet.

Output layout
-------------
    <out>/
      train/images/plan_000000.png   train/masks/plan_000000.png
      val/images/...                 val/masks/...
      meta.json

Consumed by `SyntheticWallDataset` in dataset.py.

Usage
-----
    python ops/train/synth.py --out data/synth --count 2000 --seed 0 \
        --img-size 256 --augment
"""

from __future__ import annotations

import argparse
import io
import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ── Constants ─────────────────────────────────────────────────────────────────

SS = 2  # supersampling factor used while drawing, then downsampled

ROOM_NAMES = [
    'LIVING', 'FAMILY', 'KITCHEN', 'DINING', 'BEDROOM', 'MASTER BDRM',
    'BEDROOM 2', 'BEDROOM 3', 'BATH', 'MASTER BATH', 'HALL', 'ENTRY',
    'OFFICE', 'DEN', 'LAUNDRY', 'UTILITY', 'CLOSET', 'W.I.C.', 'GARAGE',
    'PANTRY', 'MUD RM', 'STUDY', 'NOOK', 'FOYER',
]

TITLE_LINES = [
    ('PROJECT', ['RESIDENCE', 'NEW DWELLING', 'ADDITION', 'REMODEL',
                 'SINGLE FAMILY', 'DUPLEX UNIT A']),
    ('SHEET', ['A-1.1', 'A-101', 'A-2', 'A1', 'A-102', 'S-1']),
    ('SCALE', ['1/4" = 1\'-0"', '1/8" = 1\'-0"', '3/16" = 1\'-0"',
               '1:50', '1:100']),
    ('DATE', ['02.14.24', '11/03/23', '2024-06-08', '07 JAN 2025']),
    ('DRAWN', ['MLM', 'JDS', 'A.R.', 'CHK: TB']),
]

PLAN_TITLES = [
    'FLOOR PLAN', 'FIRST FLOOR PLAN', 'MAIN FLOOR PLAN', 'GROUND FLOOR',
    'SECOND FLOOR PLAN', 'PROPOSED FLOOR PLAN', 'LEVEL 1',
]

_FONT_CANDIDATES = [
    r'C:\Windows\Fonts\arial.ttf',
    r'C:\Windows\Fonts\ARIALN.TTF',
    r'C:\Windows\Fonts\tahoma.ttf',
    r'C:\Windows\Fonts\consola.ttf',
    r'C:\Windows\Fonts\cour.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
]


# ── Geometry primitives ───────────────────────────────────────────────────────

@dataclass
class Rect:
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return 0.5 * (self.x0 + self.x1)

    @property
    def cy(self) -> float:
        return 0.5 * (self.y0 + self.y1)


@dataclass
class Wall:
    """An axis-aligned wall stored as a filled rectangle."""
    rect: Rect
    exterior: bool
    horizontal: bool  # True if the wall runs left-right


@dataclass
class Opening:
    """A door or window in a wall."""
    rect: Rect          # the footprint of the opening (wall thickness x width)
    kind: str           # 'door' | 'window'
    horizontal: bool    # orientation of the parent wall
    exterior: bool
    swing_dir: int = 1  # +1 / -1, which side the door leaf swings to


@dataclass
class Plan:
    footprint: Rect
    walls: List[Wall] = field(default_factory=list)
    rooms: List[Rect] = field(default_factory=list)
    openings: List[Opening] = field(default_factory=list)
    px_per_ft: float = 8.0
    split_xs: List[float] = field(default_factory=list)
    split_ys: List[float] = field(default_factory=list)


# ── Plan generation ───────────────────────────────────────────────────────────

def _split_rect(
    rng: random.Random,
    rect: Rect,
    depth: int,
    min_side: float,
    max_depth: int,
    out_rooms: List[Rect],
    out_walls: List[Tuple[Rect, bool]],
    thickness: float,
    split_xs: List[float],
    split_ys: List[float],
) -> None:
    """Recursively subdivide *rect*, appending leaf rooms and split walls."""
    can_v = rect.w > 2 * min_side + thickness
    can_h = rect.h > 2 * min_side + thickness
    stop = depth >= max_depth or (not can_v and not can_h)
    # Random early stop so room counts vary within one plan.
    if not stop and depth >= 2 and rng.random() < 0.18:
        stop = True
    if stop:
        out_rooms.append(rect)
        return

    if can_v and can_h:
        # Prefer splitting the longer dimension, but not always.
        vertical = rect.w >= rect.h
        if rng.random() < 0.25:
            vertical = not vertical
    else:
        vertical = can_v

    lo_frac, hi_frac = 0.32, 0.68
    if vertical:
        lo = rect.x0 + max(min_side, rect.w * lo_frac)
        hi = rect.x1 - max(min_side, rect.w * (1 - hi_frac))
        if hi <= lo:
            out_rooms.append(rect)
            return
        pos = rng.uniform(lo, hi)
        split_xs.append(pos)
        out_walls.append((Rect(pos - thickness / 2, rect.y0,
                               pos + thickness / 2, rect.y1), False))
        left = Rect(rect.x0, rect.y0, pos - thickness / 2, rect.y1)
        right = Rect(pos + thickness / 2, rect.y0, rect.x1, rect.y1)
        children = (left, right)
    else:
        lo = rect.y0 + max(min_side, rect.h * lo_frac)
        hi = rect.y1 - max(min_side, rect.h * (1 - hi_frac))
        if hi <= lo:
            out_rooms.append(rect)
            return
        pos = rng.uniform(lo, hi)
        split_ys.append(pos)
        out_walls.append((Rect(rect.x0, pos - thickness / 2,
                               rect.x1, pos + thickness / 2), True))
        top = Rect(rect.x0, rect.y0, rect.x1, pos - thickness / 2)
        bot = Rect(rect.x0, pos + thickness / 2, rect.x1, rect.y1)
        children = (top, bot)

    for child in children:
        _split_rect(rng, child, depth + 1, min_side, max_depth, out_rooms,
                    out_walls, thickness, split_xs, split_ys)


def _place_openings(rng: random.Random, plan: Plan, t_int: float, t_ext: float) -> None:
    """Cut doors into interior walls and doors/windows into exterior walls."""
    ppf = plan.px_per_ft
    door_w = 3.0 * ppf   # 3'-0" door
    win_w = 3.5 * ppf

    for wall in plan.walls:
        r = wall.rect
        length = r.w if wall.horizontal else r.h
        thick = r.h if wall.horizontal else r.w

        if not wall.exterior:
            # 1 door per ~14 ft of partition, at least 1.
            n = max(1, int(length / (14 * ppf)) + (1 if rng.random() < 0.4 else 0))
            usable = length - 2 * (t_ext + 0.8 * ppf)
            if usable < door_w * 1.2:
                continue
            n = min(n, max(1, int(usable // (door_w * 2.0))))
            for k in range(n):
                seg0 = t_ext + 0.8 * ppf + usable * k / n
                seg1 = t_ext + 0.8 * ppf + usable * (k + 1) / n
                if seg1 - seg0 < door_w * 1.05:
                    continue
                s = rng.uniform(seg0, seg1 - door_w)
                if wall.horizontal:
                    orect = Rect(r.x0 + s, r.y0, r.x0 + s + door_w, r.y1)
                else:
                    orect = Rect(r.x0, r.y0 + s, r.x1, r.y0 + s + door_w)
                plan.openings.append(Opening(orect, 'door', wall.horizontal,
                                             False, rng.choice((-1, 1))))
        else:
            usable = length - 2 * (t_ext + 1.5 * ppf)
            if usable < win_w * 1.5:
                continue
            n = max(1, min(4, int(usable / (11 * ppf))))
            for k in range(n):
                seg0 = t_ext + 1.5 * ppf + usable * k / n
                seg1 = t_ext + 1.5 * ppf + usable * (k + 1) / n
                if seg1 - seg0 < win_w * 1.2:
                    continue
                s = rng.uniform(seg0, seg1 - win_w)
                if wall.horizontal:
                    orect = Rect(r.x0 + s, r.y0, r.x0 + s + win_w, r.y1)
                else:
                    orect = Rect(r.x0, r.y0 + s, r.x1, r.y0 + s + win_w)
                plan.openings.append(Opening(orect, 'window', wall.horizontal,
                                             True, 1))

    # One entry door on a random exterior wall.
    ext_walls = [w for w in plan.walls if w.exterior]
    if ext_walls:
        wall = rng.choice(ext_walls)
        r = wall.rect
        length = r.w if wall.horizontal else r.h
        if length > 8 * ppf:
            s = rng.uniform(t_ext + 2 * ppf, length - t_ext - 2 * ppf - door_w)
            if wall.horizontal:
                orect = Rect(r.x0 + s, r.y0, r.x0 + s + door_w, r.y1)
            else:
                orect = Rect(r.x0, r.y0 + s, r.x1, r.y0 + s + door_w)
            # Drop any window that overlaps the entry door.
            plan.openings = [
                o for o in plan.openings
                if not (o.rect.x0 < orect.x1 and orect.x0 < o.rect.x1
                        and o.rect.y0 < orect.y1 and orect.y0 < o.rect.y1)
            ]
            plan.openings.append(Opening(orect, 'door', wall.horizontal,
                                         True, rng.choice((-1, 1))))


def generate_plan(rng: random.Random, canvas: int) -> Plan:
    """Build a random residential plan laid out inside a *canvas*-px square."""
    # Sheet margins leave room for dimensions, title block and border.
    margin_l = canvas * rng.uniform(0.13, 0.17)
    margin_t = canvas * rng.uniform(0.13, 0.17)
    margin_r = canvas * rng.uniform(0.13, 0.20)
    margin_b = canvas * rng.uniform(0.16, 0.22)

    avail_w = canvas - margin_l - margin_r
    avail_h = canvas - margin_t - margin_b

    aspect = rng.uniform(0.62, 1.6)  # building width / height
    if aspect >= 1.0:
        w = avail_w
        h = min(avail_h, w / aspect)
    else:
        h = avail_h
        w = min(avail_w, h * aspect)
    w *= rng.uniform(0.88, 1.0)
    h *= rng.uniform(0.88, 1.0)

    x0 = margin_l + (avail_w - w) * rng.uniform(0.2, 0.8)
    y0 = margin_t + (avail_h - h) * rng.uniform(0.2, 0.8)
    footprint = Rect(x0, y0, x0 + w, y0 + h)

    width_ft = rng.uniform(26.0, 62.0)
    px_per_ft = w / width_ft

    t_ext = max(3.0 * SS, rng.uniform(0.5, 0.92) * px_per_ft)   # 6"–11"
    t_int = max(1.8 * SS, rng.uniform(0.33, 0.55) * px_per_ft)  # 4"–6.6"
    t_int = min(t_int, t_ext * 0.85)

    plan = Plan(footprint=footprint, px_per_ft=px_per_ft)

    # Exterior shell — four rectangles drawn inward from the outer face.
    f = footprint
    plan.walls += [
        Wall(Rect(f.x0, f.y0, f.x1, f.y0 + t_ext), True, True),
        Wall(Rect(f.x0, f.y1 - t_ext, f.x1, f.y1), True, True),
        Wall(Rect(f.x0, f.y0, f.x0 + t_ext, f.y1), True, False),
        Wall(Rect(f.x1 - t_ext, f.y0, f.x1, f.y1), True, False),
    ]

    # Interior partitions from recursive subdivision of the inner area.
    inner = Rect(f.x0 + t_ext, f.y0 + t_ext, f.x1 - t_ext, f.y1 - t_ext)
    min_side = max(6.0 * px_per_ft, 14.0 * SS)
    max_depth = rng.choice([2, 3, 3, 4, 4, 5])
    rooms: List[Rect] = []
    part: List[Tuple[Rect, bool]] = []
    _split_rect(rng, inner, 0, min_side, max_depth, rooms, part, t_int,
                plan.split_xs, plan.split_ys)
    for r, horizontal in part:
        plan.walls.append(Wall(r, False, horizontal))
    plan.rooms = rooms

    _place_openings(rng, plan, t_int, t_ext)
    return plan


# ── Raster helpers ────────────────────────────────────────────────────────────

def _fill(arr: np.ndarray, r: Rect, value: bool = True) -> None:
    h, w = arr.shape
    x0 = max(0, int(round(r.x0)))
    y0 = max(0, int(round(r.y0)))
    x1 = min(w, int(round(r.x1)))
    y1 = min(h, int(round(r.y1)))
    if x1 > x0 and y1 > y0:
        arr[y0:y1, x0:x1] = value


def _erode4(a: np.ndarray) -> np.ndarray:
    out = a.copy()
    out[1:, :] &= a[:-1, :]
    out[:-1, :] &= a[1:, :]
    out[:, 1:] &= a[:, :-1]
    out[:, :-1] &= a[:, 1:]
    out[0, :] = False
    out[-1, :] = False
    out[:, 0] = False
    out[:, -1] = False
    return out


def _dilate4(a: np.ndarray, iterations: int = 1) -> np.ndarray:
    out = a
    for _ in range(iterations):
        nxt = out.copy()
        nxt[1:, :] |= out[:-1, :]
        nxt[:-1, :] |= out[1:, :]
        nxt[:, 1:] |= out[:, :-1]
        nxt[:, :-1] |= out[:, 1:]
        out = nxt
    return out


def build_wall_mask(plan: Plan, canvas: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rasterise the wall region.

    Returns (union, exterior_only, interior_only) boolean arrays.  Door
    openings are removed from all three; window openings keep their wall.
    """
    ext = np.zeros((canvas, canvas), dtype=bool)
    inte = np.zeros((canvas, canvas), dtype=bool)
    for wall in plan.walls:
        _fill(ext if wall.exterior else inte, wall.rect, True)
    inte &= ~ext  # exterior wins where they overlap

    doors = np.zeros((canvas, canvas), dtype=bool)
    for op in plan.openings:
        if op.kind == 'door':
            _fill(doors, op.rect, True)

    ext &= ~doors
    inte &= ~doors
    return (ext | inte), ext, inte


# ── Rendering ─────────────────────────────────────────────────────────────────

def _load_font(size: int, rng: random.Random) -> ImageFont.ImageFont:
    size = max(6, int(size))
    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _text_size(draw: ImageDraw.ImageDraw, text: str, font) -> Tuple[int, int]:
    try:
        box = draw.textbbox((0, 0), text, font=font)
        return box[2] - box[0], box[3] - box[1]
    except Exception:
        return len(text) * 6, 10


def _draw_rot_text(img: Image.Image, xy, text: str, font, fill: int, angle: int = 90) -> None:
    tmp = Image.new('L', (max(8, len(text) * font.size), font.size * 2 + 6), 255)
    d = ImageDraw.Draw(tmp)
    d.text((2, 2), text, font=font, fill=fill)
    tmp = tmp.rotate(angle, expand=True, fillcolor=255)
    arr = np.array(tmp)
    base = np.array(img)
    x, y = int(xy[0]), int(xy[1])
    h, w = arr.shape
    H, W = base.shape
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return
    sub = arr[y0 - y:y1 - y, x0 - x:x1 - x]
    base[y0:y1, x0:x1] = np.minimum(base[y0:y1, x0:x1], sub)
    img.paste(Image.fromarray(base))


def _hatch_pattern(canvas: int, spacing: int, angle: int, rng: random.Random) -> np.ndarray:
    """Boolean array of diagonal / cross hatch lines covering the canvas."""
    yy, xx = np.mgrid[0:canvas, 0:canvas]
    if angle == 45:
        band = (xx + yy) % spacing
    elif angle == 135:
        band = (xx - yy) % spacing
    elif angle == 0:
        band = yy % spacing
    else:
        band = xx % spacing
    pat = band < max(1, spacing // 6)
    if rng.random() < 0.3:  # cross-hatch
        pat |= ((xx - yy) % spacing) < max(1, spacing // 6)
    return pat


def render_plan(
    plan: Plan,
    canvas: int,
    rng: random.Random,
    union: np.ndarray,
    ext: np.ndarray,
    inte: np.ndarray,
) -> Image.Image:
    """Draw the full architectural sheet (image only — mask is `union`)."""
    ppf = plan.px_per_ft
    paper = rng.randint(243, 255)
    img_arr = np.full((canvas, canvas), paper, dtype=np.uint8)

    ink = rng.randint(0, 45)                       # main line colour
    thin_ink = min(255, ink + rng.randint(45, 105))  # annotation line colour

    # ── Wall convention ──
    # 0 poche everywhere, 1 double-line everywhere, 2 hybrid (poche exterior)
    style = rng.choices([0, 1, 2], weights=[0.3, 0.35, 0.35])[0]

    poche = np.zeros_like(union)
    if style == 0:
        poche = union.copy()
    elif style == 2:
        poche = ext.copy()

    if poche.any():
        mode = rng.random()
        if mode < 0.55:
            fill_val = rng.randint(0, 60)
            img_arr[poche] = fill_val
        elif mode < 0.8:
            fill_val = rng.randint(90, 165)
            img_arr[poche] = fill_val
        else:
            pat = _hatch_pattern(canvas, max(3, int(0.9 * SS * rng.uniform(2, 4))),
                                 rng.choice([45, 135]), rng)
            img_arr[poche] = rng.randint(200, 235)
            img_arr[poche & pat] = ink

    # ── Wall outlines (junction-clean by construction) ──
    lw_iter = rng.choice([0, 0, 1, 1, 2])
    outline_src = union if style != 0 else union
    edge = outline_src & ~_erode4(outline_src)
    if lw_iter:
        edge = _dilate4(edge, lw_iter) & _dilate4(outline_src, lw_iter)
    img_arr[edge] = ink

    img = Image.fromarray(img_arr, mode='L')
    draw = ImageDraw.Draw(img)

    f = plan.footprint
    base_font_px = max(7, int(canvas * rng.uniform(0.017, 0.026)))
    font_room = _load_font(base_font_px, rng)
    font_small = _load_font(int(base_font_px * 0.78), rng)
    font_dim = _load_font(int(base_font_px * 0.72), rng)
    font_title = _load_font(int(base_font_px * 1.5), rng)

    # ── Room hatch fills (some rooms only) ──
    for room in plan.rooms:
        if rng.random() > 0.22:
            continue
        pat = _hatch_pattern(canvas, max(4, int(SS * rng.uniform(3, 7))),
                             rng.choice([0, 45, 90, 135]), rng)
        room_mask = np.zeros_like(union)
        _fill(room_mask, Rect(room.x0 + 2, room.y0 + 2, room.x1 - 2, room.y1 - 2))
        arr = np.array(img)
        arr[room_mask & pat & ~union] = min(255, thin_ink + 40)
        img = Image.fromarray(arr)
        draw = ImageDraw.Draw(img)

    # ── Room labels + area text ──
    show_area = rng.random() < 0.65
    names = ROOM_NAMES[:]
    rng.shuffle(names)
    for i, room in enumerate(plan.rooms):
        if room.w < base_font_px * 2.2 or room.h < base_font_px * 2.2:
            continue
        name = names[i % len(names)]
        tw, th = _text_size(draw, name, font_room)
        if tw > room.w * 0.92:
            name = name.split()[0]
            tw, th = _text_size(draw, name, font_room)
        if tw > room.w * 0.92:
            continue
        cy = room.cy - (th if show_area else th * 0.5)
        draw.text((room.cx - tw / 2, cy), name, font=font_room, fill=ink)
        if show_area:
            wf = room.w / ppf
            hf = room.h / ppf
            if rng.random() < 0.5:
                sub = f"{wf:.0f}'-0\" x {hf:.0f}'-0\""
            else:
                sub = f'{wf * hf:.0f} SF'
            sw, sh = _text_size(draw, sub, font_small)
            if sw < room.w * 0.95:
                draw.text((room.cx - sw / 2, cy + th * 1.5), sub,
                          font=font_small, fill=thin_ink)

    # ── Door swings and window symbols ──
    for op in plan.openings:
        r = op.rect
        if op.kind == 'door':
            if op.horizontal:
                width = r.w
                hx = r.cx
                hy = r.y0 if op.swing_dir < 0 else r.y1
                sy = hy + op.swing_dir * width
                draw.line([(hx - width / 2, hy), (hx - width / 2, sy)],
                          fill=ink, width=max(1, SS))
                start, end = (0, 90) if op.swing_dir > 0 else (270, 360)
                try:
                    draw.arc([hx - width / 2 - width, hy - width,
                              hx - width / 2 + width, hy + width],
                             start=start, end=end, fill=thin_ink, width=max(1, SS - 1))
                except Exception:
                    pass
                # jamb marks
                draw.line([(r.x0, r.y0), (r.x0, r.y1)], fill=ink, width=max(1, SS - 1))
                draw.line([(r.x1, r.y0), (r.x1, r.y1)], fill=ink, width=max(1, SS - 1))
            else:
                width = r.h
                hy = r.cy
                hx = r.x0 if op.swing_dir < 0 else r.x1
                sx = hx + op.swing_dir * width
                draw.line([(hx, hy - width / 2), (sx, hy - width / 2)],
                          fill=ink, width=max(1, SS))
                start, end = (90, 180) if op.swing_dir > 0 else (0, 90)
                try:
                    draw.arc([hx - width, hy - width / 2 - width,
                              hx + width, hy - width / 2 + width],
                             start=start, end=end, fill=thin_ink, width=max(1, SS - 1))
                except Exception:
                    pass
                draw.line([(r.x0, r.y0), (r.x1, r.y0)], fill=ink, width=max(1, SS - 1))
                draw.line([(r.x0, r.y1), (r.x1, r.y1)], fill=ink, width=max(1, SS - 1))
        else:
            # Window: glazing lines across the wall thickness.
            n_lines = rng.choice([1, 2, 3])
            if op.horizontal:
                for k in range(n_lines):
                    y = r.y0 + r.h * (k + 1) / (n_lines + 1)
                    draw.line([(r.x0, y), (r.x1, y)], fill=paper if n_lines > 1 else thin_ink,
                              width=max(1, SS - 1))
                draw.line([(r.x0, r.y0), (r.x0, r.y1)], fill=ink, width=max(1, SS - 1))
                draw.line([(r.x1, r.y0), (r.x1, r.y1)], fill=ink, width=max(1, SS - 1))
            else:
                for k in range(n_lines):
                    x = r.x0 + r.w * (k + 1) / (n_lines + 1)
                    draw.line([(x, r.y0), (x, r.y1)], fill=paper if n_lines > 1 else thin_ink,
                              width=max(1, SS - 1))
                draw.line([(r.x0, r.y0), (r.x1, r.y0)], fill=ink, width=max(1, SS - 1))
                draw.line([(r.x0, r.y1), (r.x1, r.y1)], fill=ink, width=max(1, SS - 1))

    # ── Dimension strings ──
    _draw_dimensions(draw, img, plan, rng, font_dim, thin_ink, ink, canvas)

    # ── Plan title under the building ──
    if rng.random() < 0.85:
        t = rng.choice(PLAN_TITLES)
        tw, th = _text_size(draw, t, font_title)
        tx = f.cx - tw / 2
        ty = min(canvas - th - int(canvas * 0.02), f.y1 + canvas * 0.045)
        draw.text((tx, ty), t, font=font_title, fill=ink)
        draw.line([(tx, ty + th * 1.45), (tx + tw, ty + th * 1.45)],
                  fill=ink, width=max(1, SS))
        sc = rng.choice(['1/4" = 1\'-0"', '1/8" = 1\'-0"', 'SCALE: 1/4"=1\'-0"'])
        draw.text((tx, ty + th * 1.9), sc, font=font_small, fill=thin_ink)

    # ── North arrow ──
    if rng.random() < 0.6:
        nx = canvas * rng.uniform(0.86, 0.92)
        ny = canvas * rng.uniform(0.10, 0.20)
        rr = canvas * 0.022
        draw.ellipse([nx - rr, ny - rr, nx + rr, ny + rr], outline=ink, width=max(1, SS - 1))
        draw.polygon([(nx, ny - rr), (nx - rr * 0.45, ny + rr * 0.6),
                      (nx, ny + rr * 0.15), (nx + rr * 0.45, ny + rr * 0.6)], fill=ink)
        draw.text((nx - rr * 0.3, ny + rr * 1.1), 'N', font=font_small, fill=ink)

    # ── Sheet border + title block ──
    _draw_border_and_title_block(draw, rng, font_small, font_dim, ink, thin_ink, canvas)

    return img


def _fmt_ft(px: float, ppf: float) -> str:
    total_in = px / ppf * 12.0
    ft = int(total_in // 12)
    inch = int(round(total_in - ft * 12))
    if inch == 12:
        ft += 1
        inch = 0
    return f"{ft}'-{inch}\""


def _draw_dimensions(draw, img, plan: Plan, rng: random.Random, font,
                     thin_ink: int, ink: int, canvas: int) -> None:
    f = plan.footprint
    ppf = plan.px_per_ft
    lw = max(1, SS - 1)
    tick = canvas * 0.008

    # ── Horizontal dimension string above the building ──
    if rng.random() < 0.95:
        y = f.y0 - canvas * rng.uniform(0.045, 0.085)
        xs = sorted([f.x0] + [x for x in plan.split_xs
                              if f.x0 + 4 < x < f.x1 - 4] + [f.x1])
        # de-duplicate near-coincident stations
        keep = [xs[0]]
        for x in xs[1:]:
            if x - keep[-1] > canvas * 0.05:
                keep.append(x)
        keep[-1] = f.x1
        draw.line([(keep[0], y), (keep[-1], y)], fill=thin_ink, width=lw)
        for x in keep:
            draw.line([(x, y - tick), (x, y + tick)], fill=thin_ink, width=lw)
            draw.line([(x, y + tick), (x, f.y0 - canvas * 0.006)],
                      fill=thin_ink, width=max(1, lw - 1))
        for a, b in zip(keep, keep[1:]):
            txt = _fmt_ft(b - a, ppf)
            tw, th = _text_size(draw, txt, font)
            if tw < (b - a) * 0.95:
                draw.text(((a + b) / 2 - tw / 2, y - th - tick * 1.6),
                          txt, font=font, fill=thin_ink)
        # overall dimension line further out
        if rng.random() < 0.7:
            y2 = y - canvas * 0.035
            draw.line([(f.x0, y2), (f.x1, y2)], fill=thin_ink, width=lw)
            for x in (f.x0, f.x1):
                draw.line([(x, y2 - tick), (x, y2 + tick)], fill=thin_ink, width=lw)
            txt = _fmt_ft(f.w, ppf)
            tw, th = _text_size(draw, txt, font)
            draw.text((f.cx - tw / 2, y2 - th - tick * 1.4), txt, font=font, fill=thin_ink)

    # ── Vertical dimension string left of the building ──
    if rng.random() < 0.9:
        x = f.x0 - canvas * rng.uniform(0.045, 0.09)
        ys = sorted([f.y0] + [v for v in plan.split_ys
                              if f.y0 + 4 < v < f.y1 - 4] + [f.y1])
        keep = [ys[0]]
        for v in ys[1:]:
            if v - keep[-1] > canvas * 0.05:
                keep.append(v)
        keep[-1] = f.y1
        draw.line([(x, keep[0]), (x, keep[-1])], fill=thin_ink, width=lw)
        for v in keep:
            draw.line([(x - tick, v), (x + tick, v)], fill=thin_ink, width=lw)
            draw.line([(x + tick, v), (f.x0 - canvas * 0.006, v)],
                      fill=thin_ink, width=max(1, lw - 1))
        for a, b in zip(keep, keep[1:]):
            if b - a < canvas * 0.07:
                continue
            txt = _fmt_ft(b - a, ppf)
            _draw_rot_text(img, (x - font.size * 1.5, (a + b) / 2 - font.size * 1.4),
                           txt, font, thin_ink, 90)


def _draw_border_and_title_block(draw, rng: random.Random, font_small, font_tiny,
                                 ink: int, thin_ink: int, canvas: int) -> None:
    lw = max(1, SS)
    m = canvas * rng.uniform(0.012, 0.028)
    draw.rectangle([m, m, canvas - m, canvas - m], outline=ink, width=lw)
    if rng.random() < 0.5:
        m2 = m + canvas * 0.008
        draw.rectangle([m2, m2, canvas - m2, canvas - m2],
                       outline=thin_ink, width=max(1, lw - 1))

    style = rng.random()
    rows = rng.randint(3, 5)
    lines = TITLE_LINES[:rows]
    if style < 0.6:
        # bottom-right block
        bw = canvas * rng.uniform(0.24, 0.34)
        bh = canvas * rng.uniform(0.09, 0.15)
        bx1, by1 = canvas - m, canvas - m
        bx0, by0 = bx1 - bw, by1 - bh
    else:
        # full-width strip along the bottom
        bw = canvas - 2 * m
        bh = canvas * rng.uniform(0.06, 0.10)
        bx0, by0 = m, canvas - m - bh
        bx1, by1 = canvas - m, canvas - m
    draw.rectangle([bx0, by0, bx1, by1], outline=ink, width=lw, fill=None)

    n = len(lines)
    for i, (label, opts) in enumerate(lines):
        if style < 0.6:
            ry = by0 + bh * i / n
            draw.line([(bx0, ry), (bx1, ry)], fill=thin_ink, width=max(1, lw - 1))
            draw.text((bx0 + canvas * 0.006, ry + bh / n * 0.12), label,
                      font=font_tiny, fill=thin_ink)
            draw.text((bx0 + bw * 0.38, ry + bh / n * 0.08), rng.choice(opts),
                      font=font_small, fill=ink)
        else:
            cx = bx0 + bw * i / n
            draw.line([(cx, by0), (cx, by1)], fill=thin_ink, width=max(1, lw - 1))
            draw.text((cx + canvas * 0.006, by0 + bh * 0.12), label,
                      font=font_tiny, fill=thin_ink)
            draw.text((cx + canvas * 0.006, by0 + bh * 0.45), rng.choice(opts),
                      font=font_small, fill=ink)


# ── Augmentation ──────────────────────────────────────────────────────────────

def _smooth_noise(rng: random.Random, size: int, cells: int) -> np.ndarray:
    """Low-frequency field in [0,1] via upsampled random grid."""
    g = np.random.RandomState(rng.randint(0, 2 ** 31 - 1)).rand(cells, cells)
    small = Image.fromarray((g * 255).astype(np.uint8), mode='L')
    return np.asarray(small.resize((size, size), Image.BICUBIC), dtype=np.float32) / 255.0


def augment_pair(
    img: Image.Image,
    mask: Image.Image,
    rng: random.Random,
) -> Tuple[Image.Image, Image.Image]:
    """Scan/photo degradation chain.  Geometry is applied to both; photometric
    effects to the image only."""
    size = img.size[0]

    # ── Geometric: small rotation + perspective-ish skew (applies to both) ──
    if rng.random() < 0.8:
        angle = rng.uniform(-4.0, 4.0)
        img = img.rotate(angle, resample=Image.BICUBIC, fillcolor=250)
        mask = mask.rotate(angle, resample=Image.BILINEAR, fillcolor=0)
    if rng.random() < 0.45:
        # affine shear
        sx = rng.uniform(-0.035, 0.035)
        sy = rng.uniform(-0.035, 0.035)
        coeffs = (1, sx, -sx * size / 2, sy, 1, -sy * size / 2)
        img = img.transform((size, size), Image.AFFINE, coeffs,
                            resample=Image.BICUBIC, fillcolor=250)
        mask = mask.transform((size, size), Image.AFFINE, coeffs,
                              resample=Image.BILINEAR, fillcolor=0)
    if rng.random() < 0.5:
        # slight scale/crop jitter (simulates framing)
        s = rng.uniform(0.94, 1.06)
        nw = int(size * s)
        tmp_i = img.resize((nw, nw), Image.BICUBIC)
        tmp_m = mask.resize((nw, nw), Image.BILINEAR)
        if s >= 1.0:
            ox = rng.randint(0, nw - size)
            oy = rng.randint(0, nw - size)
            img = tmp_i.crop((ox, oy, ox + size, oy + size))
            mask = tmp_m.crop((ox, oy, ox + size, oy + size))
        else:
            canvas_i = Image.new('L', (size, size), 250)
            canvas_m = Image.new('L', (size, size), 0)
            ox = rng.randint(0, size - nw)
            oy = rng.randint(0, size - nw)
            canvas_i.paste(tmp_i, (ox, oy))
            canvas_m.paste(tmp_m, (ox, oy))
            img, mask = canvas_i, canvas_m

    a = np.asarray(img, dtype=np.float32)

    # ── Paper texture ──
    if rng.random() < 0.7:
        tex = _smooth_noise(rng, size, rng.randint(24, 64))
        a += (tex - 0.5) * rng.uniform(4, 16)

    # ── Uneven lighting / shadow ──
    if rng.random() < 0.7:
        field = _smooth_noise(rng, size, rng.randint(2, 5))
        gain = 1.0 - rng.uniform(0.05, 0.30) * (1.0 - field)
        a *= gain
    if rng.random() < 0.3:
        # hard-ish shadow band from a hand / page edge
        yy, xx = np.mgrid[0:size, 0:size]
        ang = rng.uniform(0, math.pi)
        d = xx * math.cos(ang) + yy * math.sin(ang)
        edge = rng.uniform(d.min(), d.max())
        soft = 1.0 / (1.0 + np.exp(-(d - edge) / max(2.0, size * 0.03)))
        a *= 1.0 - rng.uniform(0.12, 0.35) * soft

    # ── Global brightness / contrast ──
    a = (a - 128.0) * rng.uniform(0.75, 1.25) + 128.0 + rng.uniform(-22, 18)

    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode='L')

    # ── Blur (focus / low-res scan) ──
    if rng.random() < 0.65:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.4)))

    # ── Sensor noise ──
    a = np.asarray(img, dtype=np.float32)
    if rng.random() < 0.8:
        rs = np.random.RandomState(rng.randint(0, 2 ** 31 - 1))
        a += rs.randn(size, size) * rng.uniform(2.0, 11.0)
    if rng.random() < 0.15:
        rs = np.random.RandomState(rng.randint(0, 2 ** 31 - 1))
        sp = rs.rand(size, size)
        a[sp < 0.002] = 0
        a[sp > 0.998] = 255
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode='L')

    # ── JPEG compression artifacts ──
    if rng.random() < 0.75:
        buf = io.BytesIO()
        img.convert('RGB').save(buf, format='JPEG', quality=rng.randint(28, 85))
        buf.seek(0)
        img = Image.open(buf).convert('L')

    # Re-binarise the mask after resampling.
    mask = Image.fromarray(
        ((np.asarray(mask, dtype=np.uint8) > 127) * 255).astype(np.uint8), mode='L'
    )
    return img, mask


# ── Sample generation ─────────────────────────────────────────────────────────

def generate_sample(
    seed: int,
    img_size: int,
    augment: bool,
) -> Tuple[Image.Image, Image.Image, dict]:
    """Generate one (image, mask, meta) triple deterministically from *seed*."""
    rng = random.Random(seed)
    canvas = img_size * SS

    plan = generate_plan(rng, canvas)
    union, ext, inte = build_wall_mask(plan, canvas)
    img_hi = render_plan(plan, canvas, rng, union, ext, inte)

    mask_hi = Image.fromarray((union * 255).astype(np.uint8), mode='L')

    img = img_hi.resize((img_size, img_size), Image.LANCZOS)
    mask = mask_hi.resize((img_size, img_size), Image.BILINEAR)
    mask = Image.fromarray(
        ((np.asarray(mask, dtype=np.uint8) > 127) * 255).astype(np.uint8), mode='L'
    )

    if augment:
        img, mask = augment_pair(img, mask, rng)

    meta = {
        'seed': seed,
        'rooms': len(plan.rooms),
        'walls': len(plan.walls),
        'openings': len(plan.openings),
        'px_per_ft': round(plan.px_per_ft / SS, 3),
        'wall_frac': float((np.asarray(mask) > 127).mean()),
    }
    return img, mask, meta


def main() -> None:
    ap = argparse.ArgumentParser(
        description='Generate synthetic floor-plan / wall-mask training pairs.')
    ap.add_argument('--out', required=True, help='Output dataset directory')
    ap.add_argument('--count', type=int, default=1000, help='Number of pairs')
    ap.add_argument('--seed', type=int, default=0, help='Base RNG seed')
    ap.add_argument('--img-size', type=int, default=256, dest='img_size')
    ap.add_argument('--augment', action='store_true',
                    help='Apply scan/photo degradation to close the sim-to-real gap')
    ap.add_argument('--val-frac', type=float, default=0.15, dest='val_frac')
    ap.add_argument('--rgb', action='store_true',
                    help='Write 3-channel PNGs instead of grayscale')
    args = ap.parse_args()

    out = Path(args.out)
    n_val = int(args.count * args.val_frac)
    n_train = args.count - n_val
    for split in ('train', 'val'):
        (out / split / 'images').mkdir(parents=True, exist_ok=True)
        (out / split / 'masks').mkdir(parents=True, exist_ok=True)

    metas = []
    fracs = []
    for i in range(args.count):
        split = 'train' if i < n_train else 'val'
        seed = args.seed * 1_000_003 + i
        img, mask, meta = generate_sample(seed, args.img_size, args.augment)
        if args.rgb:
            img = img.convert('RGB')
        name = f'plan_{i:06d}.png'
        img.save(out / split / 'images' / name)
        mask.save(out / split / 'masks' / name)
        meta['split'] = split
        meta['file'] = name
        metas.append(meta)
        fracs.append(meta['wall_frac'])
        if (i + 1) % 50 == 0 or i + 1 == args.count:
            print(f'  {i + 1}/{args.count}', flush=True)

    fa = np.array(fracs)
    summary = {
        'count': args.count,
        'train': n_train,
        'val': n_val,
        'img_size': args.img_size,
        'seed': args.seed,
        'augment': bool(args.augment),
        'wall_frac_mean': float(fa.mean()),
        'wall_frac_min': float(fa.min()),
        'wall_frac_max': float(fa.max()),
    }
    (out / 'meta.json').write_text(
        json.dumps({'summary': summary, 'samples': metas}, indent=2), encoding='utf-8')

    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
