# The sample sheet: the pieces that set the look of the kit.
#
# Names are catalogue ids with a prefix (b_ block, p_ prop, m_ mini, g_ ground
# cover) and a variant number: `p_tree~3`. Nothing in a forest or a wall should
# look stamped, so most pieces are a family grown from a seed; the app picks a
# member by where the piece stands.
import math
import os

from mathutils import Euler, Vector

from kitlib import Piece, hexcol, mix, mul

STONE, STONE_D = '#a8a195', '#6f6a62'
WOOD, WOOD_D, WOOD_L = '#a8733f', '#6b4728', '#c4935a'
PLASTER = '#e9dbb8'
GRASS, DIRT = '#86b552', '#8b5e3c'
IRON, STEEL = '#4b4a50', '#b7bec6'
SKIN, GOBLIN = '#edba90', '#8ab552'
RED, BLUE, GOLD, DARK = '#c8453f', '#3f68b5', '#e2b647', '#22201f'
MOSS = '#7ba34f'

PIECES = {}


def piece(variants=1, ground=True):
    """Register a family: `fn(p)` models one member on a Piece seeded by its variant number."""
    def register(fn):
        for v in range(variants):
            name = f'{fn.__name__}~{v}'

            def make(name=name, v=v):
                p = Piece(name, seed=hash_seed(fn.__name__, v), ground=ground)
                p.v = v
                fn(p)
                return p
            PIECES[name] = make
        return fn
    return register


def hash_seed(name, v):
    return sum(ord(c) * (i + 7) for i, c in enumerate(name)) * 31 + v * 1009


# ---- blocks: they tile, so no contact shadow and an exact 1 x 1 x 1 envelope ----

def board_colour(p):
    """Boards from different trees and different years: fresh, greyed, dark, reddish."""
    r = p.rng
    base = mix(hexcol(WOOD), hexcol(r.choice(('#8f7a62', '#7a5232', '#a8643a', '#b98a52', '#96693c'))), r.uniform(0.2, 0.9))
    return p.vary(base, 0.1)


@piece(5, ground=False)
def b_wood(p):
    # Boards run the full length of the block (and a hair past it), so a floor reads as long
    # planks. Every member has its own widths, gaps, joints and mix of timber.
    r = p.rng
    p.box((1, 1, 0.9), (0, 0, 0), mul(hexcol(WOOD_D), 0.7), bevel=0, grad=0.25, tex='wood', grain=2)
    n = r.choice((3, 4, 4, 5, 6))
    cuts = sorted(r.uniform(0.1, 0.9) for _ in range(n - 1))
    for i in range(1, len(cuts)):  # keep boards from getting too thin
        cuts[i] = max(cuts[i], cuts[i - 1] + 0.12)
    edges = [0.0] + [c for c in cuts if c < 0.9] + [1.0]
    for a, b in zip(edges, edges[1:]):
        x, w = (a + b) / 2 - 0.5, b - a - r.uniform(0.008, 0.026)
        top = 0.1 + r.uniform(-0.012, 0.008)  # some boards have sunk or cupped a little
        tilt = (0, r.uniform(-0.012, 0.012), 0)
        if r.random() < 0.4:
            j = r.uniform(-0.3, 0.3)
            for y0, y1 in ((-0.52, j - 0.006), (j + 0.006, 0.52)):
                p.box((w, y1 - y0, top), (x, (y0 + y1) / 2, 0.9), board_colour(p), bevel=0.014, grad=0.03, tex='wood', rot=tilt)
            for s in (-1, 1):  # nailed down either side of the joint
                p.cyl(0.011, 0.01, (x + r.uniform(-0.3, 0.3) * w, j + s * 0.035, 0.9 + top - 0.004), IRON, seg=5, bevel=0, grad=0)
        else:
            p.box((w, 1.04, top), (x, 0, 0.9), board_colour(p), bevel=0.014, grad=0.03, tex='wood', rot=tilt)


def flag_colour(p):
    r = p.rng
    base = mix(hexcol(STONE), hexcol(r.choice(('#8d9199', '#b3a48f', '#7f7b76', '#a39c90', '#9c8f86', '#8a927f'))), r.uniform(0.3, 1))
    return p.vary(base, 0.1)


@piece(6, ground=False)
def b_stone(p):
    # Flagstones: every member is cut up differently, from two or three big slabs to a
    # patch of cobbles, with stones of several quarries, chipped corners and weeds in the joints.
    r = p.rng
    p.box((1, 1, 0.88), (0, 0, 0), mul(hexcol(STONE_D), 0.75), bevel=0, grad=0.25, tex='stone')
    flags = [(-0.5, -0.5, 0.5, 0.5)]
    want = r.choice((2, 3, 4, 5, 6, 8, 11))
    while len(flags) < want:
        flags.sort(key=lambda f: (f[2] - f[0]) * (f[3] - f[1]) * r.uniform(0.6, 1))
        x0, y0, x1, y1 = flags.pop()
        if x1 - x0 > y1 - y0:
            c = x0 + (x1 - x0) * r.uniform(0.3, 0.7)
            flags += [(x0, y0, c, y1), (c, y0, x1, y1)]
        else:
            c = y0 + (y1 - y0) * r.uniform(0.3, 0.7)
            flags += [(x0, y0, x1, c), (x0, c, x1, y1)]
    for x0, y0, x1, y1 in flags:
        gap = r.uniform(0.02, 0.045)
        p.box((x1 - x0 - gap, y1 - y0 - gap, 0.12 + r.uniform(-0.025, 0.012)), ((x0 + x1) / 2, (y0 + y1) / 2, 0.88), flag_colour(p),
              bevel=r.uniform(0.018, 0.05), grad=0.05, tex='stone', taper=r.choice((1, 1, 1, 0.94, 0.9)),
              rot=(r.uniform(-0.02, 0.02), r.uniform(-0.02, 0.02), r.uniform(-0.035, 0.035)))
        if r.random() < 0.22:  # something growing in the joint
            p.blob(r.uniform(0.025, 0.045), (x0 + r.uniform(0, x1 - x0), y0, 0.985), p.vary(MOSS, 0.12), sub=1, scale=(1.6, 0.8, 0.5), grad=0.2, smooth=True, tex='needle')


# ---- walls: thin, standing on the far edge of the cell (y = +0.5) ----

def stone_colour(p):
    """Stone from more than one quarry, weathered unevenly: greys, warm tans, darker and greened-over blocks."""
    r = p.rng
    k = r.random()
    c = mix(hexcol(STONE), hexcol(r.choice(('#b3a48f', '#8d9199', '#9c8f86', '#a39c90'))), r.uniform(0, 0.7))
    if k < 0.14:
        c = mix(c, hexcol('#7d8a6a'), r.uniform(0.35, 0.6))  # greened over
    elif k < 0.3:
        c = mix(c, hexcol('#b89a7c'), r.uniform(0.3, 0.6))  # a warmer stone
    elif k < 0.44:
        c = mul(c, r.uniform(0.68, 0.85))
    return p.vary(c, 0.1)


def courses(p, x0, x1, y, depth, rows=4, z0=0.0, height=1.0):
    """
    Fill a stretch of wall with stones of very different sizes: big blocks, long thin
    ones, small fillers. The stretch is cut and cut again, courses first, so it still
    reads as laid masonry, but no two stretches (or two stones) come out alike.
    """
    r = p.rng
    todo, stones = [(x0, z0, x1, z0 + height)], []
    while todo:
        a = todo.pop()
        w, h = a[2] - a[0], a[3] - a[1]
        max_w, max_h = r.uniform(0.22, 0.66), r.uniform(0.9, 1.3) / rows * r.choice((1, 1, 1, 1.9))
        if h > max_h and (h / max_h >= w / max_w or w <= max_w):
            c = a[1] + h * r.uniform(0.36, 0.64)
            todo += [(a[0], a[1], a[2], c), (a[0], c, a[2], a[3])]
        elif w > max_w:
            c = a[0] + w * r.uniform(0.3, 0.7)
            todo += [(a[0], a[1], c, a[3]), (c, a[1], a[2], a[3])]
        else:
            stones.append(a)
    for sx0, sz0, sx1, sz1 in stones:
        w, h = sx1 - sx0, sz1 - sz0
        p.box((w - r.uniform(0.01, 0.022), depth + r.uniform(-0.03, 0.045), h - r.uniform(0.01, 0.022)), ((sx0 + sx1) / 2, y, sz0 + 0.007), stone_colour(p),
              bevel=min(r.uniform(0.012, 0.04), w * 0.3, h * 0.3), grad=0.06, tex='stone', taper=r.choice((1, 1, 1, 0.97, 0.94)),
              rot=(0, r.uniform(-0.025, 0.025), 0))


def moss(p, y, n):
    for _ in range(n):
        s = p.rng.choice((-1, 1))
        p.blob(p.rng.uniform(0.06, 0.11), (p.rng.uniform(-0.42, 0.42), y + s * 0.1, p.rng.uniform(0.0, 0.2)), p.vary(MOSS, 0.1), sub=1, scale=(1.5, 0.5, 0.8), grad=0.2, smooth=True, tex='needle')


@piece(6)
def p_wall(p):
    p.box((1, 0.11, 0.985), (0, 0.5, 0), STONE_D, bevel=0, grad=0.1, tex='stone')  # mortar showing in the joints
    courses(p, -0.5, 0.5, 0.5, 0.18, rows=p.rng.choice((3, 4, 4, 5, 6)))
    if p.v % 3 == 1:
        moss(p, 0.5, p.rng.randint(1, 3))


# Half-timbering: a stout oak frame standing proud of pale infill panels. The frame is the
# structure, so everything else is hung between its timbers: panels, braces, and windows too.

def timber_frame(p):
    """The parts every half-timbered stretch shares. Returns helpers for filling it in."""
    r = p.rng
    oak = mix(hexcol('#5d3f26'), hexcol('#7a5636'), r.random())
    y = 0.5

    def beam(size, at, rot=(0, 0, 0), grain=None, depth=None):
        p.box((size[0], depth or size[1], size[2]), at, p.vary(oak, 0.08), bevel=0.02, grad=0.05, rot=rot, tex='wood', grain=grain)

    def brace(x0, z0, x1, z1, w=0.075):
        a = math.atan2(x1 - x0, z1 - z0)
        beam((w, 0.19, math.hypot(x1 - x0, z1 - z0)), (x0, y, z0), rot=(0, a, 0))

    def panel(x0, z0, x1, z1):
        # Limewash, a touch grubbier toward the ground. Left untextured: it is meant to be the clean part.
        p.box((x1 - x0, 0.13, z1 - z0), ((x0 + x1) / 2, y, z0), p.vary(PLASTER, 0.035), bevel=0.01, grad=0.14)

    beam((1.0, 0.21, 0.1), (0, y, 0), grain=0)  # sill beam
    beam((1.0, 0.23, 0.1), (0, y, 0.9), grain=0)  # wall plate
    for x in (-0.465, 0.465):  # half a post at each end: two walls side by side make a whole one
        beam((0.07, 0.2, 0.8), (x, y, 0.1))
    return beam, brace, panel, oak


@piece(5)
def p_wallwood(p):
    r = p.rng
    beam, brace, panel, _ = timber_frame(p)
    y = 0.5
    panel(-0.47, 0.07, 0.47, 0.92)
    if p.v == 0:  # a middle post with knee braces under the plate
        beam((0.09, 0.2, 0.8), (0, y, 0.1))
        for s in (-1, 1):
            brace(s * 0.045, 0.52, s * 0.43, 0.9)
    elif p.v == 1:  # a saltire
        brace(-0.43, 0.1, 0.43, 0.9)
        brace(0.43, 0.1, -0.43, 0.9)
    elif p.v == 2:  # four small panels
        beam((0.09, 0.2, 0.8), (0, y, 0.1))
        beam((0.86, 0.2, 0.08), (0, y, 0.47), grain=0)
    elif p.v == 3:  # close studding: narrow panels between many uprights, one brace across the corner
        for x in (-0.24, 0, 0.24):
            beam((0.07, 0.2, 0.8), (x, y, 0.1))
        s = r.choice((-1, 1))
        brace(s * 0.43, 0.1, s * 0.04, 0.5)
    else:  # a "man": a post with foot braces rising to it from either side
        beam((0.09, 0.2, 0.8), (0, y, 0.1))
        for s in (-1, 1):
            brace(s * 0.42, 0.1, s * 0.05, 0.62)


def casement(p, x0, z0, x1, z1, y, timber, lights=(2, 2), glass=True):
    """
    What sits inside a window opening: a slim frame hard against the reveal, glazing bars,
    and the glass itself set back in the middle of the wall. Built to the opening it is
    given, so it always fits whatever framed that opening.
    """
    w, h, t = x1 - x0, z1 - z0, 0.03
    for x in (x0 + t / 2, x1 - t / 2):
        p.box((t, 0.07, h), (x, y, z0), timber, bevel=0.006, grad=0.05, tex='wood')
    for z in (z0, z1 - t):
        p.box((w - t * 2, 0.07, t), ((x0 + x1) / 2, y, z), timber, bevel=0.006, grad=0.05, tex='wood', grain=0)
    for i in range(1, lights[0]):
        p.box((0.02, 0.05, h - t * 2), (x0 + w * i / lights[0], y, z0 + t), timber, bevel=0.004, grad=0, tex='wood')
    for i in range(1, lights[1]):
        p.box((w - t * 2, 0.05, 0.02), ((x0 + x1) / 2, y, z0 + h * i / lights[1] - 0.01), timber, bevel=0.004, grad=0, tex='wood', grain=0)
    if glass:  # opaque: dusk-blue, paler toward the foot where it catches the sky
        p.box((w - t * 2, 0.012, h - t * 2), ((x0 + x1) / 2, y, z0 + t), '#42566e', bevel=0, grad=-0.5)


@piece(4)
def p_woodwin(p):
    # A window in a timber frame is not added to the wall: it is the gap between two posts,
    # a sill rail and a head rail, with plaster filling everything except that gap.
    r = p.rng
    beam, brace, panel, oak = timber_frame(p)
    y = 0.5
    half = r.uniform(0.17, 0.22)  # half the width of the opening
    sill, head = r.uniform(0.32, 0.38), r.uniform(0.76, 0.82)
    post = 0.07
    for s in (-1, 1):
        beam((post, 0.2, 0.8), (s * (half + post / 2), y, 0.1))  # window posts
        panel(min(s * 0.47, s * (half + post)), 0.07, max(s * 0.47, s * (half + post)), 0.92)
    beam((half * 2, 0.2, 0.07), (0, y, sill - 0.07), grain=0)  # sill rail
    beam((half * 2, 0.2, 0.07), (0, y, head), grain=0)  # head rail
    panel(-half, 0.07, half, sill - 0.06)  # the apron under the window
    panel(-half, head + 0.06, half, 0.92)
    # A ledge on the weather side (-y, the side away from the wall's own cell edge is +y).
    p.box((half * 2 + 0.1, 0.09, 0.035), (0, y - 0.13, sill - 0.012), p.vary(oak, 0.06), bevel=0.012, grad=0.05, tex='wood', grain=0)
    casement(p, -half, sill, half, head, y, mul(oak, 0.75), lights=(2, 2) if p.v % 2 else (3, 2))
    if p.v == 1:  # a saltire in the apron
        brace(-half, 0.1, half, sill - 0.07, 0.05)
        brace(half, 0.1, -half, sill - 0.07, 0.05)
    if p.v >= 2:  # shutters, hung on the window posts and folded back over the panels beside them
        paint = p.vary(r.choice(('#3f6a5a', '#7a3b34', '#3d5578', '#6b5a2e')), 0.08)
        for s in (-1, 1):
            w = half - 0.01
            p.box((w, 0.028, head - sill), (s * (half + post + w / 2 - 0.02), y - 0.112, sill), paint, bevel=0.008, grad=0.1, tex='wood', grain=2)
            for z in (sill + 0.06, head - 0.09):  # ledges across the boards
                p.box((w - 0.02, 0.012, 0.03), (s * (half + post + w / 2 - 0.02), y - 0.13, z), mul(paint, 0.8), bevel=0.004, grad=0, tex='wood', grain=0)


@piece(4)
def p_wallwin(p):
    # A window in a stone wall: masonry laid around a real opening, with a long lintel stone
    # carrying the wall over it and a sill stone throwing the rain clear.
    r = p.rng
    y, depth = 0.5, 0.18
    half = r.uniform(0.15, 0.2)
    sill, head = r.uniform(0.34, 0.4), r.uniform(0.74, 0.8)
    bear = 0.1  # how far the lintel rests on the wall either side of the opening
    regions = ((-0.5, 0, 0.5, sill), (-0.5, sill, -half - bear, head + 0.1), (half + bear, sill, 0.5, head + 0.1), (-0.5, head + 0.1, 0.5, 1.0))
    for x0, z0, x1, z1 in regions:
        p.box((x1 - x0, 0.11, z1 - z0 - 0.005), ((x0 + x1) / 2, y, z0), STONE_D, bevel=0, grad=0.1, tex='stone')  # mortar
        courses(p, x0, x1, y, depth, rows=max(1, round((z1 - z0) * 4.4)), z0=z0, height=z1 - z0)
    for s in (-1, 1):  # jamb stones: squared blocks stacked up each side of the opening, carrying the lintel
        z, n = sill, r.choice((2, 3))
        for i in range(n):
            h = (head - sill) / n
            p.box((bear - 0.012, depth + r.uniform(0.0, 0.03), h - 0.012), (s * (half + bear / 2), y, z + 0.006), stone_colour(p), bevel=0.02, grad=0.06, tex='stone')
            z += h
    dressed = p.vary(mix(hexcol(STONE), hexcol('#c2b8a6'), 0.6), 0.05)
    if p.v % 2:  # a timber lintel instead of a stone one
        p.box((half * 2 + 0.24, depth + 0.04, 0.1), (0, y, head), p.vary(WOOD_D, 0.08), bevel=0.02, grad=0.05, tex='wood', grain=0)
    else:
        p.box((half * 2 + 0.2, depth + 0.035, 0.1), (0, y, head), dressed, bevel=0.022, grad=0.05, tex='stone')
    p.box((half * 2 + 0.1, depth + 0.1, 0.05), (0, y - 0.03, sill - 0.05), dressed, bevel=0.016, grad=0.05, tex='stone')  # sill stone, proud on the weather side
    casement(p, -half, sill, half, head, y, p.vary('#4f3a28', 0.06), lights=(2, 1) if p.v < 2 else (2, 2))


@piece()
def p_walldoor(p):
    for x0, x1 in ((-0.5, -0.33), (0.33, 0.5)):
        p.box((x1 - x0, 0.11, 0.985), ((x0 + x1) / 2, 0.5, 0), STONE_D, bevel=0, grad=0.1, tex='stone')
        courses(p, x0, x1, 0.5, 0.2)
    p.box((1, 0.22, 0.16), (0, 0.5, 0.84), p.vary(WOOD_D), bevel=0.02, grad=0.05, tex='wood')  # lintel
    for i in range(4):  # the door itself, planked
        p.box((0.158, 0.06, 0.82), (-0.24 + i * 0.16, 0.5, 0.01), p.vary(WOOD, 0.1), bevel=0.012, grad=0.1, tex='wood')
    for z in (0.16, 0.62):
        p.box((0.6, 0.085, 0.05), (0, 0.5, z), IRON, bevel=0.01, grad=0.05)
    for y in (0.445, 0.555):
        p.cyl(0.035, 0.02, (0.2, y, 0.42), GOLD, seg=8, bevel=0.005, rot=(math.pi / 2, 0, 0), grad=0)


@piece(3)
def p_post(p):
    r = p.rng
    n = r.choice((2, 3, 3, 4))
    hs = [r.uniform(0.8, 1.2) for _ in range(n)]
    hs = [h * 0.95 / sum(hs) for h in hs]
    z = 0
    for h in hs:
        p.box((0.27 + r.uniform(-0.02, 0.02), 0.27 + r.uniform(-0.02, 0.02), h - 0.01), (-0.5, 0.5, z), stone_colour(p), bevel=0.028, grad=0.06, tex='stone',
              rot=(0, 0, r.uniform(-0.05, 0.05)))
        z += h
    p.box((0.32, 0.32, 0.06), (-0.5, 0.5, 0.955), p.vary(STONE, 0.05), bevel=0.02, grad=0.05, tex='stone')


# ---- props ----

@piece()
def p_table(p):
    for i in range(3):
        p.box((0.9, 0.2, 0.06), (0, -0.205 + i * 0.205, 0.4), p.vary(WOOD, 0.09), bevel=0.014, grad=0.05, tex='wood')
    p.box((0.74, 0.46, 0.07), (0, 0, 0.335), WOOD_D, bevel=0.01, grad=0.05, tex='wood')
    for x in (-0.36, 0.36):
        for y in (-0.23, 0.23):
            p.box((0.085, 0.085, 0.4), (x, y, 0), p.vary(WOOD_D), bevel=0.014, grad=0.2, taper=1.15, tex='wood')
    p.cyl(0.05, 0.085, (0.2, 0.08, 0.46), p.vary('#8d6a47'), seg=8, bevel=0.01, grad=0.1)  # a mug
    p.box((0.02, 0.03, 0.05), (0.262, 0.08, 0.478), '#8d6a47', bevel=0.006, grad=0)
    p.cyl(0.085, 0.015, (-0.2, -0.08, 0.46), '#d8cfc0', seg=10, bevel=0.005, grad=0)  # a plate
    p.blob(0.04, (-0.2, -0.08, 0.495), '#c58b4a', sub=1, scale=(1.2, 0.9, 0.7), grad=0.2)  # bread


@piece(3)
def p_barrel(p):
    r = p.rng
    w = p.vary(mix(hexcol(WOOD), hexcol(WOOD_D), r.uniform(0, 0.45)), 0.06)
    fat = r.uniform(0.235, 0.255)
    p.cyl(0.19, 0.2, (0, 0, 0), w, seg=12, r2=fat, bevel=0, grad=0.15, smooth=False, tex='wood')
    p.cyl(fat, 0.2, (0, 0, 0.2), mul(w, 1.05), seg=12, bevel=0, grad=0.04, smooth=False, tex='wood')
    p.cyl(fat, 0.2, (0, 0, 0.4), mul(w, 1.08), seg=12, r2=0.19, bevel=0, grad=0.02, smooth=False, tex='wood')
    for z in (r.uniform(0.07, 0.13), r.uniform(0.43, 0.49)):
        p.cyl(fat - 0.017, 0.045, (0, 0, z), IRON, seg=12, bevel=0.008, grad=0.05, smooth=False)
    p.cyl(0.165, 0.012, (0, 0, 0.575), WOOD_D, seg=12, bevel=0, grad=0, tex='wood')
    if p.v == 2:  # tapped
        p.cyl(0.025, 0.09, (0, -fat + 0.02, 0.2), GOLD, seg=6, bevel=0.005, grad=0, rot=(math.pi / 2, 0, 0))


@piece(3)
def p_crate(p):
    r = p.rng
    s = r.uniform(0.52, 0.62)
    h = s / 2
    p.box((s - 0.06, s - 0.06, s - 0.06), (0, 0, 0.02), p.vary(WOOD, 0.08), bevel=0.01, grad=0.15, tex='wood')
    for x in (-h + 0.03, h - 0.03):
        for y in (-h + 0.03, h - 0.03):
            p.box((0.09, 0.09, s), (x, y, 0), p.vary(WOOD_L, 0.09), bevel=0.014, grad=0.12, tex='wood')
    for z in (0, s - 0.08):
        for y in (-h + 0.03, h - 0.03):
            p.box((s - 0.13, 0.085, 0.08), (0, y, z), p.vary(WOOD_L, 0.09), bevel=0.012, grad=0.05, tex='wood')
        for x in (-h + 0.03, h - 0.03):
            p.box((0.085, s - 0.13, 0.08), (x, 0, z), p.vary(WOOD_L, 0.09), bevel=0.012, grad=0.05, tex='wood')
    if p.v:  # a cross-brace on one or two faces
        a = math.pi / 4
        for y in ((-h + 0.02,) if p.v == 1 else (-h + 0.02, h - 0.02)):
            p.box((0.07, 0.05, (s - 0.16) / math.cos(a)), (-h + 0.1, y, 0.08), p.vary(WOOD_L, 0.09), bevel=0.01, grad=0.05, rot=(0, a, 0), tex='wood')


# ---- trees: grown, not copied. A trunk is a chain of limbs that can bend and fork; a crown is
# ---- one or more leafy masses hung on the ends of its boughs.

def limb(p, start, length, r0, r1, rot, col, seg=7):
    """One straight stretch of trunk or branch. Returns where it ends, so the next can carry on from there."""
    p.cyl(r0, length, tuple(start), col, seg=seg, r2=r1, bevel=0, grad=0.06, tex='wood', rot=rot)
    return Vector(start) + Euler(rot).to_matrix() @ Vector((0, 0, length * 0.96))


def trunk(p, height, girth, bark, bend=0.12, parts=3, top=0.5):
    """A trunk that wanders as it rises. Returns its tip and the lean it ended with."""
    r = p.rng
    at, rot = Vector((0, 0, 0)), [r.uniform(-bend, bend) * 0.5, r.uniform(-bend, bend) * 0.5, r.uniform(0, 6)]
    for i in range(parts):
        t0, t1 = i / parts, (i + 1) / parts
        at = limb(p, at, height / parts * 1.04, girth * (1 - t0 * (1 - top)), girth * (1 - t1 * (1 - top)), tuple(rot), mul(bark, 1 + t0 * 0.08), seg=8)
        rot[0] += r.uniform(-bend, bend)
        rot[1] += r.uniform(-bend, bend)
    return at, rot


def roots(p, girth, bark):
    r = p.rng
    for i in range(r.choice((3, 4, 4, 5))):
        a = i * 1.7 + r.uniform(0, 0.8)
        p.box((girth * 0.8, r.uniform(1.6, 2.6) * girth, girth), (math.cos(a) * girth * 0.9, math.sin(a) * girth * 0.9, -0.02), mul(bark, 0.9), bevel=0.03, grad=0.25,
              rot=(0, 0, a + math.pi / 2), taper=0.4, tex='wood')


def canopy(p, pads, lo, hi, tris=105, thick=0.44, tex='leaf'):
    """
    Foliage as layered pads: flat, cloud-shaped shelves of leaf, each a few masses fused into
    one seamless skin, set at different heights on the ends of the boughs. `pads` are
    (centre, width). The whole tree is coloured by height (cool and deep under the lowest
    shelf, warm and bright on the top one) and lit as a single form, so it reads as one
    crown in tiers rather than as separate lumps.
    """
    r = p.rng
    z0, z1 = min(c.z for c, _ in pads) - 0.16, max(c.z for c, _ in pads) + 0.2
    style = os.environ.get('CANOPY', 'A')
    if style != 'A':
        # Clumped foliage: each shelf is a cluster of many small masses, so its surface is knobbly
        # with leaf rather than smooth, and the hollows between the clumps hold shadow.
        p.leaf_ao = 0.8
        for c, w in pads:
            w *= 1.12
            lobes = [(c, w * 0.52, w * thick * 0.9)]
            for _ in range(r.randint(9, 13)):
                a, d = r.uniform(0, math.tau), w * 0.74 * math.sqrt(r.random())
                at = c + Vector((math.cos(a) * d, math.sin(a) * d, r.uniform(-0.05, 0.09) * w / 0.34))
                size = w * r.uniform(0.2, 0.34)
                lobes.append((at, size, size * r.uniform(0.75, 1.0)))
            p.fused(lobes, tris=int(tris * 2.4 * max(0.5, min(1.4, w / 0.34))), voxel=max(0.02, w * 0.065), rough=w * 0.05, col=(r.uniform(0.93, 1.05),), smooth=True,
                    tex=tex, head=1, ramp=(lo, hi, z0, z1))
            if style == 'C':  # sprigs of leaf breaking the outline
                for _ in range(r.randint(10, 14)):
                    a = r.uniform(0, math.tau)
                    out = Vector((math.cos(a), math.sin(a), r.uniform(-0.15, 0.5))).normalized()
                    at = c + Vector((out.x * w * 0.78, out.y * w * 0.78, out.z * w * thick * 0.8))
                    t = max(0.0, min(1.0, (at.z - z0) / (z1 - z0)))
                    p.leaf(at, out + Vector((0, 0, r.uniform(-0.2, 0.3))), Vector((-out.y, out.x, 0)), w * r.uniform(0.2, 0.3), w * r.uniform(0.1, 0.15),
                           mix(lo, hi, t), out, head=1, tex=tex)
        return
    for c, w in pads:
        w *= 1.1
        lobes = [(c, w * 0.7, w * thick)]
        n, turn = r.choice((3, 3, 4)), r.uniform(0, math.tau)
        for i in range(n):  # uneven bulges round the rim, so no two shelves have the same outline
            a = turn + i * math.tau / n + r.uniform(-0.5, 0.5)
            out = w * r.uniform(0.42, 0.62)
            lobes.append((c + Vector((math.cos(a) * out, math.sin(a) * out, r.uniform(-0.03, 0.05))), w * r.uniform(0.32, 0.56), w * thick * r.uniform(0.75, 0.9)))
        p.fused(lobes, tris=int(tris * max(0.5, min(1.4, w / 0.34))), voxel=max(0.028, w * 0.11), rough=w * 0.09, col=(r.uniform(0.93, 1.05),), smooth=True,
                tex=tex, head=1, ramp=(lo, hi, z0, z1))


def greens(p):
    """This tree's own green: from deep and bluish to bright and yellowish."""
    t = p.rng.random()
    return mix(hexcol('#356f45'), hexcol('#4f7a3a'), t), mix(hexcol('#93c95a'), hexcol('#bccb5a'), t)


@piece(8)
def p_tree(p):
    # Broadleaf trees in four habits (round, spreading, tall, forked), each with its own bark,
    # girth, bend and arrangement of boughs. The foliage sits on the boughs, so you see how
    # the tree is built.
    r = p.rng
    bark = p.vary(mix(hexcol('#6f4b2d'), hexcol(r.choice(('#8a7a68', '#4f3a2a', '#7d6248'))), r.uniform(0, 0.7)), 0.06)
    lo, hi = greens(p)
    habit, girth = p.v % 4, r.uniform(0.1, 0.16)
    roots(p, girth, bark)
    pads = []

    def bough(start, length, tilt, turn, radius, pad):
        end = limb(p, start, length, radius, radius * 0.55, (0, tilt, turn), bark, seg=6)
        pads.append((end + Vector((0, 0, pad * 0.2)), pad))
        return end
    turn = r.uniform(0, math.tau)
    if habit == 0:  # round: boughs all round a single trunk, a wide shelf on each, more above
        tip, _ = trunk(p, r.uniform(0.6, 0.9), girth, bark)
        n = r.choice((3, 3, 4))
        for i in range(n):
            bough(tip - Vector((0, 0, r.uniform(0.04, 0.16))), r.uniform(0.34, 0.48), r.uniform(0.75, 1.05), turn + i * math.tau / n + r.uniform(-0.3, 0.3), girth * 0.5, r.uniform(0.3, 0.38))
        pads.append((tip + Vector((r.uniform(-0.06, 0.06), r.uniform(-0.06, 0.06), 0.4)), r.uniform(0.34, 0.42)))
        pads.append((tip + Vector((r.uniform(-0.12, 0.12), r.uniform(-0.12, 0.12), 0.72)), r.uniform(0.2, 0.27)))
    elif habit == 1:  # spreading: a short bole and long level boughs carrying a broad, flat canopy
        tip, _ = trunk(p, r.uniform(0.42, 0.6), girth * 1.15, bark, parts=2, top=0.7)
        n = r.choice((3, 4, 4))
        for i in range(n):
            bough(tip - Vector((0, 0, 0.05)), r.uniform(0.5, 0.68), r.uniform(0.95, 1.2), turn + i * math.tau / n + r.uniform(-0.3, 0.3), girth * 0.55, r.uniform(0.34, 0.44))
        pads.append((tip + Vector((0, 0, 0.36)), r.uniform(0.36, 0.44)))
    elif habit == 2:  # tall: a long stem with shelves stepping up it, smaller toward the top
        h = r.uniform(1.0, 1.35)
        tip, _ = trunk(p, h, girth * 0.85, bark, bend=0.07)
        n = r.choice((3, 4))
        for i in range(n):
            t = i / n
            at = tip * (0.55 + t * 0.4)
            bough(at, r.uniform(0.22, 0.34) * (1 - t * 0.4), r.uniform(0.8, 1.1), turn + i * 2.4 + r.uniform(-0.3, 0.3), girth * 0.38, r.uniform(0.27, 0.34) * (1 - t * 0.3))
        pads.append((tip + Vector((0, 0, 0.14)), r.uniform(0.2, 0.26)))
    else:  # forked: the trunk divides low; each stem carries its own tiers
        tip, _ = trunk(p, r.uniform(0.35, 0.5), girth * 1.1, bark, parts=2, top=0.75)
        for s in (0, math.pi):
            mid = limb(p, tip - Vector((0, 0, 0.04)), r.uniform(0.32, 0.44), girth * 0.75, girth * 0.55, (0, r.uniform(0.45, 0.7), turn + s), bark)
            end = limb(p, mid - Vector((0, 0, 0.02)), r.uniform(0.25, 0.38), girth * 0.55, girth * 0.35, (0, r.uniform(0.1, 0.3), turn + s), bark, seg=6)
            bough(mid, r.uniform(0.25, 0.36), r.uniform(0.9, 1.2), turn + s + r.uniform(-0.8, 0.8), girth * 0.35, r.uniform(0.26, 0.33))
            pads.append((end + Vector((0, 0, 0.1)), r.uniform(0.32, 0.4)))
            pads.append((end + Vector((r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), 0.36)), r.uniform(0.19, 0.25)))
    canopy(p, pads, lo, hi)


@piece(5)
def p_birch(p):
    # Slender and pale, with dark scars on the bark and small, light shelves of leaf up the top of the stem.
    r = p.rng
    bark, girth, h = p.vary('#e4e0d6', 0.04), r.uniform(0.055, 0.075), r.uniform(1.05, 1.45)
    pads = []
    for i in range(r.choice((1, 1, 2))):  # birches like company: sometimes two stems from one foot
        base = Vector((i * 0.16, i * 0.05, 0))
        rot = [r.uniform(-0.1, 0.1) + i * 0.14, r.uniform(-0.1, 0.1), r.uniform(0, 6)]
        at, joints = base, [base]
        for k in range(3):
            at = limb(p, at, h / 3 * 1.04, girth * (1 - k * 0.2), girth * (1 - (k + 1) * 0.2), tuple(rot), bark)
            joints.append(at)
            for _ in range(r.randint(1, 2)):  # scars
                q = joints[-2].lerp(at, r.uniform(0.2, 0.8))
                p.box((girth * 1.5, girth * 1.7, 0.024), tuple(q), '#3a3632', bevel=0.006, grad=0)
            rot[0] += r.uniform(-0.08, 0.08)
            rot[1] += r.uniform(-0.08, 0.08)
        n, turn = r.choice((5, 6, 6)), r.uniform(0, 6)
        for k in range(n):  # twiggy side shoots, each with its own little shelf
            t = k / (n - 1)
            start = joints[2].lerp(at, t * 0.9) if t > 0.25 else joints[1].lerp(joints[2], 0.5 + t * 2)
            end = limb(p, start, r.uniform(0.16, 0.26) * (1 - t * 0.4), girth * 0.3, girth * 0.15, (0, r.uniform(0.9, 1.25), turn + k * 2.4), bark, seg=4)
            pads.append((end + Vector((0, 0, 0.03)), r.uniform(0.17, 0.25) * (1 - t * 0.25)))
        pads.append((at + Vector((0, 0, 0.05)), r.uniform(0.15, 0.2)))
    canopy(p, pads, mix(hexcol('#5f9a4a'), hexcol('#7fa23e'), r.random()), mix(hexcol('#b4dc6c'), hexcol('#d9dc62'), r.random()), tris=60, thick=0.4)


@piece(4)
def p_poplar(p):
    # A tall dark column: a straight stem clothed almost to the ground in one continuous sleeve of leaf.
    r = p.rng
    bark = p.vary('#5d4a38', 0.06)
    h, w = r.uniform(1.5, 2.0), r.uniform(0.22, 0.28)
    trunk(p, 0.45, 0.08, bark, bend=0.03, parts=1)
    lo, hi = mix(hexcol('#2f6440'), hexcol('#476d35'), r.random()), mix(hexcol('#79b55a'), hexcol('#9cbb56'), r.random())
    n, lobes = r.choice((6, 7)), []
    for i in range(n):
        t = i / (n - 1)
        k = math.sin(0.3 + t * 2.3) * 0.5 + 0.55  # fattest a third of the way up, tapering to a point
        a = i * 2.4
        lobes.append((Vector((math.cos(a) * w * 0.25 * k, math.sin(a) * w * 0.25 * k, 0.4 + t * (h - 0.5))), w * k * r.uniform(0.9, 1.1), (h - 0.5) / n * 0.95))
    p.fused(lobes, tris=300, voxel=0.045, rough=0.045, col=(1.0,), smooth=True, tex='leaf', head=1, ramp=(lo, hi, 0.3, h + 0.1))


@piece(4)
def p_deadtree(p):
    # No leaves at all: a winter tree, or a dead one. All the interest is in the branching.
    r = p.rng
    bark = p.vary(mix(hexcol('#5b4636'), hexcol('#7b756c'), r.uniform(0, 0.8)), 0.06)
    girth = r.uniform(0.09, 0.14)
    roots(p, girth, bark)
    tip, _ = trunk(p, r.uniform(0.55, 0.95), girth, bark, bend=0.16, top=0.6)

    def branch(at, radius, length, tilt, turn, depth):
        end = limb(p, at, length, radius, radius * 0.55, (0, tilt, turn), bark, seg=(6, 4, 3)[depth])
        if depth >= 2:
            return
        for _ in range(2 if depth else r.choice((2, 2, 3))):
            branch(at + (end - at) * r.uniform(0.55, 0.95), radius * 0.55, length * r.uniform(0.55, 0.8), max(0.2, tilt + r.uniform(-0.7, 0.5)), turn + r.uniform(-1.3, 1.3), depth + 1)
    n = r.choice((3, 4, 5))
    for i in range(n):
        branch(tip - Vector((0, 0, r.uniform(0.02, 0.25))), girth * 0.5, r.uniform(0.4, 0.62), r.uniform(0.35, 1.0), i * math.tau / n + r.uniform(-0.5, 0.5), 0)
    branch(tip - Vector((0, 0, 0.03)), girth * 0.5, r.uniform(0.35, 0.55), r.uniform(0, 0.25), r.uniform(0, 6), 1)  # a leader


@piece(5)
def p_pine(p):
    r = p.rng
    tiers = r.choice((5, 6, 6, 7))
    spread, rise = r.uniform(0.42, 0.54), r.uniform(0.2, 0.25)
    p.cyl(0.1, 0.5, (0, 0, 0), p.vary('#644328'), seg=7, r2=0.06, bevel=0, grad=0.3, tex='wood')
    season = r.random()
    lo, hi = mix(hexcol('#2c6247'), hexcol('#31583a'), season), mix(hexcol('#58a05c'), hexcol('#6f9a4f'), season)
    lean = (r.uniform(-0.05, 0.05), r.uniform(-0.05, 0.05))
    for i in range(tiers):
        t = i / (tiers - 1)
        z = 0.3 + i * rise
        p.cyl(spread * (1 - t * 0.72) * r.uniform(0.9, 1.1), 0.42 - t * 0.1, (lean[0] * z, lean[1] * z, z), p.vary(mix(lo, hi, t), 0.05), seg=12, r2=0, bevel=0,
              grad=0.45, smooth=False, tex='needle', jag=r.uniform(0.2, 0.36), droop=r.uniform(0.04, 0.1), rot=(0, 0, r.uniform(0, 3)))


@piece(6)
def p_rock(p):
    r = p.rng
    grey = mix(hexcol('#96918a'), hexcol('#a08f7c'), r.random())
    big = r.uniform(0.24, 0.36)
    flat = r.uniform(0.5, 0.95)  # a slab, or a boulder
    p.blob(big, (r.uniform(-0.08, 0.08), r.uniform(-0.08, 0.08), big * flat * 0.5), p.vary(grey), sub=2, rough=0.7, freq=1.3, scale=(r.uniform(1, 1.3), 1, flat), grad=0.35, lift=0.1, tex='stone')
    for _ in range(r.randint(0, 3)):
        a, s = r.uniform(0, math.tau), r.uniform(0.09, 0.2)
        p.blob(s, (math.cos(a) * (big + s * 0.3), math.sin(a) * (big + s * 0.3), s * 0.4), p.vary(mul(grey, 0.88)), sub=2 if s > 0.14 else 1, rough=0.6, freq=1.5,
               scale=(1.1, 1, 0.7), grad=0.35, lift=0.1, tex='stone')
    if r.random() < 0.6:
        p.blob(big * 0.5, (r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), big * flat * 1.05), p.vary(MOSS, 0.1), sub=2, scale=(1.25, 1.1, 0.22), grad=0.2, smooth=True, tex='needle')


# ---- ground cover: scattered over grass by the app, thinning out and changing with what is nearby ----

@piece(5, ground=False)
def g_tuft(p):
    r = p.rng
    for _ in range(r.randint(6, 11)):
        p.cyl(r.uniform(0.014, 0.024), r.uniform(0.07, 0.2), (r.uniform(-0.08, 0.08), r.uniform(-0.08, 0.08), -0.005), p.vary(mix(hexcol('#6f9c46'), hexcol('#a9c862'), r.random()), 0.08),
              seg=3, r2=0, bevel=0, grad=0.55, smooth=False, rot=(r.uniform(-0.5, 0.5), r.uniform(-0.5, 0.5), r.uniform(0, 3)))


@piece(4, ground=False)
def g_sward(p):
    """A patch of short grass: what makes a lawn a lawn rather than a green sheet with tufts on it."""
    r = p.rng
    for _ in range(r.randint(15, 21)):
        a, d = r.uniform(0, math.tau), 0.24 * math.sqrt(r.random())
        p.cyl(r.uniform(0.012, 0.02), r.uniform(0.035, 0.1), (math.cos(a) * d, math.sin(a) * d, -0.004), p.vary(mix(hexcol('#62903f'), hexcol('#93b955'), r.random()), 0.07),
              seg=3, r2=0, bevel=0, grad=0.6, smooth=False, rot=(r.uniform(-0.55, 0.55), r.uniform(-0.55, 0.55), r.uniform(0, 3)))


@piece(4, ground=False)
def g_flower(p):
    r = p.rng
    petal = ('#f4f1e6', '#f2cf4a', '#b48be0', '#e9788f')[p.v]
    for _ in range(r.randint(1, 3)):
        x, y, h = r.uniform(-0.07, 0.07), r.uniform(-0.07, 0.07), r.uniform(0.08, 0.15)
        p.cyl(0.008, h, (x, y, 0), '#5e9443', seg=3, bevel=0, grad=0.2, smooth=False)
        p.blob(0.032, (x, y, h), p.vary(petal, 0.05), sub=1, scale=(1, 1, 0.45), grad=0.15, smooth=True)
        p.blob(0.013, (x, y, h + 0.012), '#e8b93a' if p.v != 1 else '#b9722a', sub=1, grad=0, smooth=True)


@piece(4, ground=False)
def g_pebble(p):
    r = p.rng
    for _ in range(r.randint(1, 4)):
        s = r.uniform(0.025, 0.06)
        p.blob(s, (r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), s * 0.25), p.vary(mix(hexcol('#9a958c'), hexcol('#b3a48f'), r.random()), 0.1), sub=1, rough=0.4,
               scale=(1.2, 1, 0.6), grad=0.3, tex='stone')


import props  # noqa: E402,F401  (the rest of the props register themselves)
import imported  # noqa: E402  (the miniatures: posed figures from the CC0 packs in assets/cc0)

for _name, _make in imported.IMPORTED.items():
    PIECES[f'{_name}~0'] = lambda make=_make, name=_name: make(f'{name}~0')
