# The rest of the props: nature, structures, furniture, dungeon dressing.
# Same rules as the sample pieces: each is a family grown from a seed, built from
# chunky bevelled parts, with its front toward -Y and its origin on the floor at
# the middle of its cell.
import math

from mathutils import Euler, Vector

from kitlib import hexcol, mix, mul
from pieces_sample import (DARK, GOLD, IRON, MOSS, PLASTER, RED, STEEL, STONE, STONE_D, WOOD, WOOD_D, WOOD_L,
                           board_colour, canopy, courses, greens, limb, piece, roots, stone_colour, trunk)

TAU = math.tau
CLOTHS = ('#a8433a', '#3f5f9a', '#3f7a55', '#8a5aa0', '#c08a3a', '#4a8f95')


def ring(p, centre, radius, n, a0, a1, size, col, axis='y', **kw):
    """Blocks set round an arc like the stones of an arch (axis 'y': standing up, facing the front) or a well (axis 'z': lying flat)."""
    for i in range(n):
        a = a0 + (a1 - a0) * (i + 0.5) / n
        c = col() if callable(col) else col
        if axis == 'y':
            up = Vector((math.sin(a), 0, math.cos(a)))
            p.box(size, tuple(Vector(centre) + up * (radius - size[2] / 2)), c, rot=(0, a, 0), **kw)
        else:
            p.box(size, (centre[0] + math.cos(a) * radius, centre[1] + math.sin(a) * radius, centre[2]), c, rot=(0, 0, a + math.pi / 2), **kw)


def flame(p, at, size, n=3):
    """A few tongues of fire: hot at the heart, redder outside."""
    r = p.rng
    for i in range(n):
        t = i / max(1, n - 1)
        p.cyl(size * (0.5 - t * 0.2), size * r.uniform(1.1, 1.6) * (1 - t * 0.25), (at[0] + r.uniform(-0.3, 0.3) * size * t, at[1] + r.uniform(-0.3, 0.3) * size * t, at[2]),
              mix(hexcol('#ffd257'), hexcol('#ff7a1f'), t), seg=5, r2=0, bevel=0, grad=0, smooth=False, tex='glow', rot=(r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.15), r.uniform(0, 3)))


# ---- nature ------------------------------------------------------------------------

@piece(4)
def p_bush(p):
    r = p.rng
    lo, hi = greens(p)
    lobes = [(Vector((r.uniform(-0.16, 0.16), r.uniform(-0.16, 0.16), r.uniform(0.14, 0.26))), r.uniform(0.17, 0.28), r.uniform(0.15, 0.22)) for _ in range(r.choice((3, 4, 5)))]
    p.fused(lobes, tris=170, voxel=0.035, rough=0.03, col=(1.0,), smooth=True, tex='leaf', head=1, ramp=(lo, hi, 0.0, 0.5))
    if p.v % 2:  # in berry
        for _ in range(r.randint(5, 9)):
            c, w, h = r.choice(lobes)
            a, up = r.uniform(0, TAU), r.uniform(0.1, 0.9)
            k = math.sqrt(1 - up * up)
            p.blob(0.022, (c.x + math.cos(a) * k * w, c.y + math.sin(a) * k * w, c.z + up * h), r.choice(('#c8372d', '#5a3f8f')), sub=1, grad=0, smooth=True)


@piece(3)
def p_reeds(p):
    r = p.rng
    for _ in range(r.randint(7, 11)):
        x, y = r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25)
        p.cyl(0.016, r.uniform(0.45, 0.95), (x, y, 0), p.vary(mix(hexcol('#6e9a48'), hexcol('#a9b45c'), r.random()), 0.06), seg=3, r2=0.004, bevel=0, grad=0.3, smooth=False,
              rot=(r.uniform(-0.18, 0.18), r.uniform(-0.18, 0.18), r.uniform(0, 3)))
    for _ in range(r.randint(1, 3)):  # cat's-tails
        x, y, h = r.uniform(-0.2, 0.2), r.uniform(-0.2, 0.2), r.uniform(0.6, 0.85)
        p.cyl(0.01, h, (x, y, 0), '#7f9a4c', seg=3, bevel=0, grad=0.2, smooth=False)
        p.cyl(0.028, 0.13, (x, y, h - 0.02), '#5d3d26', seg=6, bevel=0.01, grad=0.1)


@piece(4)
def p_flowers(p):
    r = p.rng
    petal = ('#f4f1e6', '#f2cf4a', '#b48be0', '#e9788f')[p.v]
    for _ in range(r.randint(6, 10)):
        x, y, h = r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(0.12, 0.3)
        p.cyl(0.01, h, (x, y, 0), '#5e9443', seg=3, bevel=0, grad=0.2, smooth=False, rot=(r.uniform(-0.12, 0.12), r.uniform(-0.12, 0.12), 0))
        p.blob(0.045, (x, y, h), p.vary(petal, 0.07), sub=1, scale=(1, 1, 0.45), grad=0.15, smooth=True)
        p.blob(0.018, (x, y, h + 0.016), '#e8b93a' if p.v != 1 else '#b9722a', sub=1, grad=0, smooth=True)
    for _ in range(4):  # leaves at the foot
        p.blob(0.06, (r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), 0.03), p.vary('#6ea34c', 0.08), sub=1, scale=(1.3, 0.9, 0.35), grad=0.2, smooth=True, tex='leaf')


def toadstool(p, at, height, cap, colour, stem='#efe6d2', gills='#e9dcc2', tilt=(0, 0, 0), shape='dome', warts=None, glow=False, girth=1.0):
    """
    One mushroom, turned like a real one: a stem that swells at the foot and narrows under
    the cap, pale gills, and a cap that domes over and curls in at its edge. `shape` is
    'dome' (open cap), 'bun' (thick and round) or 'cone' (a young, pointed cap).
    """
    r = p.rng
    w = cap * 0.2 * girth
    p.lathe([(w * 1.35, 0), (w * 1.5, height * 0.08), (w * 1.05, height * 0.3), (w * 0.8, height * 0.7), (w * 0.9, height)], tuple(at), stem, seg=6, rot=tilt,
            grad=0.18, smooth=True, close=True)
    top = Vector(at) + Euler(tilt).to_matrix() @ Vector((0, 0, height))
    R = cap
    if shape == 'cone':
        outline = [(R * 0.2, -R * 0.08), (R * 0.7, -R * 0.32), (R * 0.78, -R * 0.2), (R * 0.62, R * 0.2), (R * 0.36, R * 0.62), (R * 0.12, R * 0.9), (0, R * 0.98)]
    elif shape == 'bun':
        outline = [(R * 0.3, -R * 0.04), (R * 0.86, -R * 0.1), (R, R * 0.06), (R * 0.97, R * 0.28), (R * 0.8, R * 0.5), (R * 0.48, R * 0.66), (0, R * 0.72)]
    else:
        outline = [(R * 0.22, R * 0.02), (R * 0.9, -R * 0.07), (R, R * 0.01), (R * 0.96, R * 0.12), (R * 0.8, R * 0.28), (R * 0.52, R * 0.42), (R * 0.22, R * 0.5), (0, R * 0.52)]
    kind = 'glow' if glow else None
    p.lathe(outline[:2], tuple(top), gills, seg=8, rot=tilt, grad=0, smooth=True, tex=kind, close=False)  # the gills, facing down
    p.lathe(outline[1:], tuple(top), colour, seg=8, rot=tilt, grad=0.22, lift=0.08, smooth=True, tex=kind, close=False)
    for _ in range(warts or 0):  # flecks of veil left on the cap
        k = r.uniform(0.15, 0.85)
        i = min(len(outline) - 2, 2 + int(k * (len(outline) - 3)))
        (r0, z0), (r1, z1) = outline[i], outline[i + 1]
        f, a = r.random(), r.uniform(0, TAU)
        rr, zz = r0 + (r1 - r0) * f, z0 + (z1 - z0) * f
        q = top + Euler(tilt).to_matrix() @ Vector((math.cos(a) * rr, math.sin(a) * rr, zz + 0.004))
        p.blob(R * r.uniform(0.07, 0.11), tuple(q), '#f6f0e2', sub=1, scale=(1, 1, 0.45), grad=0, smooth=True)


@piece(5)
def p_mushroom(p):
    # A little troop of mushrooms of one kind: different ages and sizes, leaning away from each other.
    r = p.rng
    kinds = (
        dict(colour='#c53a34', shape='dome', warts=7, n=(2, 3), tall=(0.2, 0.32), cap=(0.11, 0.16)),  # fly agaric
        dict(colour='#8f5f3a', shape='bun', n=(2, 3), tall=(0.12, 0.2), cap=(0.1, 0.15), girth=1.9, stem='#e9dcc2'),  # penny bun
        dict(colour='#d9b77a', shape='cone', n=(4, 6), tall=(0.14, 0.3), cap=(0.045, 0.075), girth=0.8),  # a tuft of honey fungus
        dict(colour='#e9e2d2', shape='dome', n=(3, 4), tall=(0.1, 0.18), cap=(0.07, 0.11), gills='#c9a59a'),  # field mushrooms
        dict(colour='#5fe0d0', shape='cone', n=(3, 5), tall=(0.2, 0.42), cap=(0.07, 0.11), glow=True, stem='#bfeee6', gills='#9ff5e6', girth=0.7),  # cave lights
    )[p.v]
    n = r.randint(*kinds.pop('n'))
    tall, cap = kinds.pop('tall'), kinds.pop('cap')
    spread = 0.1 if kinds['shape'] == 'cone' else 0.2
    for i in range(n):
        a = i * TAU / n + r.uniform(-0.5, 0.5)
        d = r.uniform(0.3, 1.0) * spread * (0.4 if i == 0 else 1)
        age = 1.0 if i == 0 else r.uniform(0.45, 0.9)  # the first is full grown; the rest are coming on
        lean = r.uniform(0.05, 0.28)
        opts = dict(kinds)
        if age < 0.6 and opts['shape'] == 'dome':
            opts['shape'] = 'bun'  # a young one has not opened yet
        toadstool(p, (math.cos(a) * d, math.sin(a) * d, 0), r.uniform(*tall) * age, r.uniform(*cap) * (0.6 + age * 0.4), p.vary(opts.pop('colour'), 0.06),
                  tilt=(math.sin(a) * -lean, math.cos(a) * lean, 0), **opts)
    for _ in range(3):  # leaf litter at their feet
        p.blob(0.05, (r.uniform(-0.2, 0.2), r.uniform(-0.2, 0.2), 0.008), p.vary('#7a5c40', 0.1), sub=1, scale=(1.3, 0.9, 0.14), grad=0, smooth=True)


def cactus_column(p, at, radius, height, col, rot=(0, 0, 0), seg=10):
    """A ribbed cactus stem with a domed top, standing on `at`. Returns where its top is."""
    r, h = radius, height
    dome = [(r, h - r * 0.9), (r * 0.94, h - r * 0.55), (r * 0.78, h - r * 0.25), (r * 0.5, h - r * 0.07), (0.0, h)]
    p.lathe([(r * 0.9, 0), (r, min(r, h * 0.3))] + dome, tuple(at), col, seg=seg, rot=rot, grad=0.2, lift=0.05, smooth=True, tex='needle', rib=0.16)
    return Vector(at) + Euler(rot).to_matrix() @ Vector((0, 0, h))


def cactus_flower(p, at, col='#e9788f'):
    for i in range(5):
        a = i * TAU / 5
        p.blob(0.02, (at[0] + math.cos(a) * 0.022, at[1] + math.sin(a) * 0.022, at[2] + 0.008), col, sub=1, scale=(1.2, 1.2, 0.6), grad=0, smooth=True)
    p.blob(0.014, (at[0], at[1], at[2] + 0.016), '#f2cf4a', sub=1, grad=0, smooth=True)


@piece(5)
def p_cactus(p):
    r = p.rng
    g = p.vary(mix(hexcol('#5a9a5c'), hexcol('#7dae62'), r.random()), 0.05)
    p.blob(0.2, (0, 0, 0.0), p.vary('#c9a878', 0.06), sub=1, rough=0.3, scale=(1.3, 1.2, 0.18), grad=0.15, tex='stone')  # a lip of sand round the foot
    if p.v in (0, 1):  # saguaro: a tall ribbed trunk, with arms that leave it level, then turn up
        h, rad = r.uniform(0.75, 1.05), r.uniform(0.1, 0.125)
        top = cactus_column(p, (0, 0, 0), rad, h, g)
        if p.v == 0:
            cactus_flower(p, top)
        turn = r.uniform(0, TAU)
        for i in range(r.choice((1, 2, 2)) if p.v == 0 else 3):
            a = turn + i * (math.pi + r.uniform(-0.5, 0.5)) if p.v == 0 else turn + i * TAU / 3
            z, arm = h * r.uniform(0.3, 0.55), rad * r.uniform(0.6, 0.72)
            out = Vector((math.cos(a), math.sin(a), 0))
            reach = rad + arm * r.uniform(1.3, 1.9)
            # the elbow: three short ribbed lengths swinging from sideways to upright
            p.lathe([(arm, 0), (arm, reach - rad * 0.4)], tuple(out * rad * 0.4 + Vector((0, 0, z))), g, seg=10, rot=(0, math.pi / 2, a), grad=0, smooth=True, tex='needle', rib=0.16)
            p.blob(arm * 1.04, tuple(out * reach + Vector((0, 0, z))), g, sub=2, grad=0.05, smooth=True, tex='needle')
            cactus_column(p, out * reach + Vector((0, 0, z)), arm, r.uniform(0.2, 0.42), g, seg=10)
    elif p.v == 2:  # barrel cactus: fat ribbed globes, flowering on top
        for i in range(r.choice((1, 2, 3))):
            s = 1.0 if i == 0 else r.uniform(0.45, 0.7)
            x, y = (0, 0) if i == 0 else (math.cos(i * 2.4) * 0.22, math.sin(i * 2.4) * 0.22)
            R, H = 0.18 * s, 0.3 * s
            prof = [(R * 0.55, 0), (R * 0.9, H * 0.15), (R, H * 0.4), (R * 0.95, H * 0.65), (R * 0.72, H * 0.86), (R * 0.35, H * 0.97), (0, H)]
            p.lathe(prof, (x, y, 0), p.vary(g, 0.05), seg=12, grad=0.2, lift=0.05, smooth=True, tex='needle', rib=0.18)
            cactus_flower(p, (x, y, H), r.choice(('#e9788f', '#f2cf4a', '#f08a3a')))
    else:  # prickly pear: flat pads growing out of the edges of one another
        def pad(at, size, lean, turn, depth=0):
            c = Vector(at) + Euler((lean, 0, turn)).to_matrix() @ Vector((0, 0, size * 0.95))
            p.blob(size, tuple(c), p.vary(g, 0.06), sub=2, scale=(0.82, 0.24, 1.0), rot=(lean, 0, turn), grad=0.15, lift=0.05, smooth=True, tex='needle')
            tip = Vector(at) + Euler((lean, 0, turn)).to_matrix() @ Vector((0, 0, size * 1.85))
            if depth < 2:
                for k in range(r.choice((1, 2, 2))):
                    side = Euler((lean, 0, turn)).to_matrix() @ Vector(((k * 2 - 1) * size * 0.5, 0, size * 1.5))
                    pad(Vector(at) + side, size * r.uniform(0.6, 0.78), lean + r.uniform(-0.5, 0.5), turn + r.uniform(-0.9, 0.9), depth + 1)
            elif r.random() < 0.7:
                p.blob(0.03, tuple(tip), '#c8453f', sub=1, scale=(1, 1, 1.3), grad=0.1, smooth=True)  # fruit
        pad((0, 0, 0), r.uniform(0.16, 0.2), r.uniform(-0.15, 0.15), r.uniform(0, TAU))
        if p.v == 4:
            pad((0.16, 0.08, 0), 0.13, r.uniform(-0.3, 0.3), r.uniform(0, TAU), 1)


@piece(3)
def p_stalagmite(p):
    r = p.rng
    for i in range(r.choice((2, 3, 4))):
        s = 1.0 if i == 0 else r.uniform(0.3, 0.7)
        x, y = (0, 0) if i == 0 else (r.uniform(-0.28, 0.28), r.uniform(-0.28, 0.28))
        p.cyl(0.17 * s, r.uniform(0.7, 1.0) * s, (x, y, 0), stone_colour(p), seg=6, r2=0.012, bevel=0, grad=0.3, smooth=False, tex='stone', rot=(r.uniform(-0.08, 0.08), r.uniform(-0.08, 0.08), r.uniform(0, 3)))
    p.blob(0.2, (0, 0, 0.02), stone_colour(p), sub=1, rough=0.4, scale=(1.4, 1.3, 0.35), grad=0.2, tex='stone')


@piece(3)
def p_crystal(p):
    r = p.rng
    hue = (hexcol('#56d8e6'), hexcol('#b47cf0'), hexcol('#f0b84a'))[p.v]
    p.blob(0.22, (0, 0, 0.03), stone_colour(p), sub=1, rough=0.4, scale=(1.3, 1.2, 0.4), grad=0.2, tex='stone')
    for i in range(r.choice((3, 4, 5))):
        s = 1.0 if i == 0 else r.uniform(0.35, 0.75)
        rot = (r.uniform(-0.45, 0.45) * (i > 0), r.uniform(-0.45, 0.45) * (i > 0), r.uniform(0, 3))
        at = Vector((0, 0, 0.02)) if i == 0 else Vector((r.uniform(-0.14, 0.14), r.uniform(-0.14, 0.14), 0.02))
        p.cyl(0.085 * s, 0.5 * s, tuple(at), mul(hue, r.uniform(0.75, 1.0)), seg=6, r2=0.07 * s, bevel=0, grad=0.2, smooth=False, tex='glow', rot=rot)
        tip = at + Euler(rot).to_matrix() @ Vector((0, 0, 0.5 * s))
        p.cyl(0.07 * s, 0.16 * s, tuple(tip), mul(hue, 1.15), seg=6, r2=0, bevel=0, grad=0, smooth=False, tex='glow', rot=rot)


@piece(3)
def p_log(p):
    r = p.rng
    bark = p.vary(mix(hexcol('#6f4b2d'), hexcol('#7d6a55'), r.random()), 0.06)
    length, rad = r.uniform(0.7, 0.9), r.uniform(0.11, 0.15)
    p.cyl(rad, length, (0, length / 2, rad * 0.9), bark, seg=8, r2=rad * 0.9, bevel=0, grad=0.05, tex='wood', rot=(math.pi / 2, 0, 0))
    for y in (length / 2 + 0.004, -length / 2 + 0.012):  # pale end grain
        p.cyl(rad * 0.86, 0.012, (0, y, rad * 0.9), '#d6b98a', seg=8, bevel=0, grad=0, rot=(math.pi / 2, 0, 0))
    p.cyl(0.04, 0.14, (0, r.uniform(-0.2, 0.2), rad * 1.5), bark, seg=5, r2=0.03, bevel=0, grad=0, tex='wood', rot=(r.uniform(-0.6, 0.6), r.uniform(0.3, 0.8), 0))
    if p.v:
        p.blob(0.09, (0, r.uniform(-0.2, 0.2), rad * 1.85), p.vary(MOSS, 0.1), sub=1, scale=(1.2, 1.6, 0.3), grad=0.2, smooth=True, tex='needle')


@piece(3)
def p_stump(p):
    r = p.rng
    bark = p.vary(mix(hexcol('#6f4b2d'), hexcol('#7d6a55'), r.random()), 0.06)
    h, rad = r.uniform(0.18, 0.32), r.uniform(0.17, 0.23)
    roots(p, rad * 0.8, bark)
    p.cyl(rad, h, (0, 0, 0), bark, seg=9, r2=rad * 0.85, bevel=0, grad=0.25, tex='wood')
    p.cyl(rad * 0.8, 0.015, (0, 0, h), '#d6b98a', seg=9, bevel=0, grad=0)
    p.cyl(rad * 0.45, 0.004, (rad * 0.08, 0, h + 0.015), '#b9976a', seg=9, bevel=0, grad=0)
    if p.v == 1:  # an axe left in it
        p.box((0.03, 0.03, 0.42), (0.02, 0, h - 0.02), WOOD_L, bevel=0.008, grad=0.05, rot=(0.5, 0, 0.4), tex='wood')
        p.box((0.14, 0.025, 0.1), (0.02, -0.02, h - 0.03), STEEL, bevel=0.01, grad=0.1, rot=(0.5, 0, 0.4), taper=0.7)
    if p.v == 2:
        p.blob(0.08, (0.05, 0.03, h + 0.02), p.vary(MOSS, 0.1), sub=1, scale=(1.4, 1.2, 0.3), grad=0.2, smooth=True, tex='needle')


@piece(4)
def p_palm(p):
    r = p.rng
    bark = p.vary('#8a6d4a', 0.06)
    at, rot = Vector((0, 0, 0)), [r.uniform(-0.2, 0.2), r.uniform(-0.2, 0.2), r.uniform(0, 6)]
    h = r.uniform(1.1, 1.6)
    for i in range(5):  # a ringed trunk that curves as it climbs
        at = limb(p, at, h / 5 * 1.05, 0.085 - i * 0.008, 0.078 - i * 0.008, tuple(rot), mul(bark, 1 - (i % 2) * 0.08), seg=7)
        rot[0] += r.uniform(-0.08, 0.14)
        rot[1] += r.uniform(-0.08, 0.14)
    lo, hi = mix(hexcol('#3f7f45'), hexcol('#5a8f3a'), r.random()), hexcol('#9ccb5e')
    n = r.choice((6, 7, 8))
    for i in range(n):  # fronds: each rises a little, then arches over and hangs
        a = i * TAU / n + r.uniform(-0.25, 0.25)
        mid = at + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, r.uniform(0.02, 0.14)))
        tip = at + Vector((math.cos(a) * r.uniform(0.6, 0.78), math.sin(a) * r.uniform(0.6, 0.78), r.uniform(-0.32, -0.08)))
        side = Vector((-math.sin(a), math.cos(a), 0))
        for q0, q1, w0, w1, c in ((at, mid, 0.05, 0.19, mix(lo, hi, 0.75)), (mid, tip, 0.19, 0.02, mix(lo, hi, 0.35))):
            for s in (1, -1):  # two faces, so the frond shows from above and below
                pts = [q0 + side * w0 / 2, q0 - side * w0 / 2, q1 - side * w1 / 2, q1 + side * w1 / 2][::s]
                p.quad(pts, mul(c, r.uniform(0.92, 1.06)), tex='leaf', head=1)
    for _ in range(r.randint(0, 3)):
        a = r.uniform(0, TAU)
        p.blob(0.055, tuple(at + Vector((math.cos(a) * 0.08, math.sin(a) * 0.08, -0.07))), '#6a4a2c', sub=1, grad=0.2, smooth=True)


# ---- structures --------------------------------------------------------------------

@piece(2)
def p_door(p):
    # A door standing in its own frame, for a gap in a wall of blocks.
    r = p.rng
    oak = p.vary(mix(hexcol('#5d3f26'), hexcol('#7a5636'), r.random()), 0.05)
    for x in (-0.42, 0.42):
        p.box((0.12, 0.16, 0.98), (x, 0, 0), oak, bevel=0.02, grad=0.1, tex='wood')
    p.box((0.96, 0.18, 0.12), (0, 0, 0.88), mul(oak, 0.95), bevel=0.02, grad=0.05, tex='wood', grain=0)
    for i in range(4):
        p.box((0.176, 0.055, 0.86), (-0.27 + i * 0.18, 0, 0.01), board_colour(p), bevel=0.012, grad=0.1, tex='wood')
    for z in (0.16, 0.66):
        p.box((0.7, 0.075, 0.05), (0, 0, z), IRON, bevel=0.01, grad=0.05)
    for y in (-0.05, 0.05):
        p.cyl(0.04, 0.02, (0.24, y, 0.44), GOLD, seg=8, bevel=0.005, rot=(math.pi / 2, 0, 0), grad=0)
    if p.v:  # a little barred window in it
        p.box((0.2, 0.065, 0.16), (0, 0, 0.6), DARK, bevel=0.01, grad=0)


@piece(2)
def p_gate(p):
    r = p.rng
    for x in (-0.4, 0.4):
        courses(p, x - 0.1, x + 0.1, 0, 0.22, rows=5)
        p.box((0.26, 0.28, 0.06), (x, 0, 1.0), p.vary(STONE, 0.05), bevel=0.02, grad=0.05, tex='stone')
    if p.v == 0:  # double doors
        for s in (-1, 1):
            for i in range(2):
                p.box((0.145, 0.05, 0.9), (s * (0.08 + i * 0.15), 0, 0.02), board_colour(p), bevel=0.012, grad=0.1, tex='wood')
            for z in (0.2, 0.7):
                p.box((0.28, 0.07, 0.045), (s * 0.155, 0, z), IRON, bevel=0.01, grad=0.05)
    else:  # a portcullis, half raised
        lift = r.uniform(0.0, 0.3)
        for i in range(5):
            p.box((0.035, 0.035, 0.95 - lift), (-0.24 + i * 0.12, 0, lift), IRON, bevel=0.008, grad=0.1)
            p.cyl(0.024, 0.07, (-0.24 + i * 0.12, 0, lift - 0.06), IRON, seg=4, r2=0, bevel=0, grad=0, smooth=False, rot=(math.pi, 0, 0))
        for z in (0.35, 0.6, 0.85):
            p.box((0.56, 0.03, 0.035), (0, 0, z), IRON, bevel=0.008, grad=0.05)


@piece(3)
def p_arch(p):
    # Two piers and a round arch sprung from them. The ring is laid out from the piers:
    # its inner edge meets their inner faces and its outer edge their outer faces, so the
    # stones carry straight on from one into the other.
    r = p.rng
    inner, outer, spring, depth = 0.27, 0.48, 0.5, 0.24
    for s_ in (-1, 1):
        x0, x1 = sorted((s_ * inner, s_ * outer))
        courses(p, x0, x1, 0, depth, rows=3, height=spring - 0.05)
        p.box((outer - inner + 0.05, depth + 0.04, 0.05), (s_ * (inner + outer) / 2, 0, spring - 0.05), p.vary(mix(hexcol(STONE), hexcol('#c2b8a6'), 0.5), 0.04), bevel=0.014, grad=0.05, tex='stone')  # impost
    n = 7 if p.v != 1 else 9
    step = math.pi / n
    for i in range(n):  # voussoirs: wedge stones, narrow inside and wide outside, with a proud keystone
        a = -math.pi / 2 + (i + 0.5) * step
        key = i == n // 2
        up = Vector((math.sin(a), 0, math.cos(a)))
        lo, hi = inner - (0.02 if key else 0), outer + (0.04 if key else r.uniform(-0.01, 0.015))
        p.box((2 * lo * math.tan(step / 2) - 0.012, depth + (0.03 if key else r.uniform(-0.015, 0.015)), hi - lo), tuple(Vector((0, 0, spring)) + up * lo),
              stone_colour(p), bevel=0.016, grad=0.04, tex='stone', rot=(0, a, 0), taper=hi / lo)
    if p.v == 2:
        for _ in range(4):
            a = r.uniform(-1.2, 1.2)
            p.blob(r.uniform(0.05, 0.09), (math.sin(a) * outer, r.choice((-0.13, 0.13)), spring + math.cos(a) * outer), p.vary(MOSS, 0.1), sub=1, scale=(1.4, 0.5, 1), grad=0.2, smooth=True, tex='needle')


@piece(2)
def p_stairs(p):
    r = p.rng
    n = 4
    for i in range(n):  # rising from the front to a full level at the back
        y, z = -0.375 + i * 0.25, i * 0.25
        if p.v == 0:
            p.box((0.94, 0.25 * (n - i), 0.25), (0, 0.5 - 0.125 * (n - i), z), stone_colour(p), bevel=0.022, grad=0.1, tex='stone')
        else:
            p.box((0.9, 0.27, 0.05), (0, y, z + 0.2), board_colour(p), bevel=0.012, grad=0.03, tex='wood', grain=0)
    if p.v:  # the boards the treads sit on, running up either side
        for x in (-0.43, 0.43):
            p.box((0.06, 1.36, 0.12), (x, 0, 0.42), p.vary(WOOD_D), bevel=0.012, grad=0.05, rot=(math.pi / 4, 0, 0), tex='wood', grain=1)


@piece()
def p_ladder(p):
    for x in (-0.2, 0.2):
        p.box((0.05, 0.05, 1.12), (x, -0.3, 0), p.vary(WOOD_L), bevel=0.012, grad=0.1, rot=(-0.38, 0, 0), tex='wood')
    for i in range(6):
        z = 0.12 + i * 0.17
        p.box((0.44, 0.035, 0.035), (0, -0.3 + math.sin(0.38) * z, math.cos(0.38) * z), p.vary(WOOD, 0.08), bevel=0.008, grad=0, tex='wood', grain=0)


@piece(3)
def p_fence(p):
    r = p.rng
    for x in (-0.46, 0.0, 0.46):
        p.box((0.085, 0.085, r.uniform(0.52, 0.62)), (x, 0, 0), p.vary(WOOD_D, 0.1), bevel=0.016, grad=0.2, rot=(r.uniform(-0.04, 0.04), r.uniform(-0.04, 0.04), 0), tex='wood')
    if p.v == 1:  # pickets
        for i in range(7):
            h = r.uniform(0.42, 0.5)
            p.box((0.09, 0.03, h), (-0.4 + i * 0.133, -0.05, 0.03), board_colour(p), bevel=0.01, grad=0.1, tex='wood', taper=0.6)
        for z in (0.15, 0.36):
            p.box((1.0, 0.035, 0.045), (0, -0.025, z), p.vary(WOOD_D), bevel=0.008, grad=0, tex='wood', grain=0)
    else:
        for z in (0.2, 0.42):
            if p.v == 2 and z > 0.3:  # a rail down at one end
                p.box((0.52, 0.045, 0.07), (-0.2, 0, z - 0.12), board_colour(p), bevel=0.012, grad=0, rot=(0, 0.35, 0), tex='wood', grain=0)
                continue
            p.box((1.0, 0.045, 0.075), (0, 0, z), board_colour(p), bevel=0.012, grad=0, rot=(0, r.uniform(-0.02, 0.02), 0), tex='wood', grain=0)


@piece(2)
def p_bridge(p):
    # A plank walkway along x, a cell long, lifted a little in the middle.
    r = p.rng
    for i in range(6):
        x = -0.42 + i * 0.168
        p.box((0.155, 0.92, 0.045), (x, 0, 0.1 + 0.06 * math.cos(x * 3.0)), board_colour(p), bevel=0.012, grad=0.03, tex='wood', rot=(0, math.sin(x * 3.0) * 0.18, 0))
    for y in (-0.43, 0.43):
        p.box((1.0, 0.07, 0.09), (0, y, 0.04), p.vary(WOOD_D), bevel=0.014, grad=0.05, tex='wood', grain=0)
        if p.v:
            for x in (-0.44, 0.44):
                p.box((0.06, 0.06, 0.45), (x, y, 0.1), p.vary(WOOD_D), bevel=0.012, grad=0.1, tex='wood')
            p.box((1.0, 0.04, 0.05), (0, y, 0.5), p.vary(WOOD, 0.08), bevel=0.01, grad=0, tex='wood', grain=0)


@piece(3)
def p_pillar(p):
    r = p.rng
    m = lambda: p.vary(mix(hexcol('#d9d4cc'), hexcol(STONE), r.uniform(0, 0.5)), 0.04)
    p.box((0.56, 0.56, 0.1), (0, 0, 0), m(), bevel=0.022, grad=0.1, tex='stone')
    p.box((0.44, 0.44, 0.06), (0, 0, 0.1), m(), bevel=0.018, grad=0.05, tex='stone')
    h = 0.72 if p.v != 1 else r.uniform(0.3, 0.5)
    drums = 3 if p.v != 1 else 2
    for i in range(drums):
        p.cyl(0.18, h / drums - 0.006, (0, 0, 0.16 + i * h / drums), m(), seg=10, r2=0.175, bevel=0.012, grad=0.04, tex='stone', rot=(0, 0, r.uniform(0, 1)))
    if p.v != 1:
        p.box((0.46, 0.46, 0.06), (0, 0, 0.88), m(), bevel=0.018, grad=0.05, tex='stone')
        p.box((0.56, 0.56, 0.07), (0, 0, 0.93), m(), bevel=0.022, grad=0.05, tex='stone')
    else:  # fallen: the top lies beside it
        p.cyl(0.18, 0.3, (0.34, 0.2, 0.17), m(), seg=10, bevel=0.012, grad=0.05, tex='stone', rot=(math.pi / 2, 0, 0.5))
        p.blob(0.09, (0.1, -0.3, 0.05), m(), sub=1, rough=0.5, scale=(1.2, 1, 0.7), grad=0.2, tex='stone')
    if p.v == 2:
        for _ in range(4):
            p.blob(r.uniform(0.06, 0.1), (math.cos(r.uniform(0, 6)) * 0.19, math.sin(r.uniform(0, 6)) * 0.19, r.uniform(0.15, 0.7)), p.vary(MOSS, 0.1), sub=1, scale=(1, 1, 1.4), grad=0.2, smooth=True, tex='needle')


@piece(2)
def p_well(p):
    r = p.rng
    for z in (0, 0.17):
        ring(p, (0, 0, z), 0.33, 9, z * 2, TAU + z * 2, (0.2, 0.14, 0.165), lambda: stone_colour(p), axis='z', bevel=0.022, grad=0.1, tex='stone')
    p.cyl(0.27, 0.02, (0, 0, 0.16), '#2f5f7f', seg=12, bevel=0, grad=0)  # water, well down
    for x in (-0.36, 0.36):
        p.box((0.07, 0.07, 0.95), (x, 0, 0), p.vary(WOOD_D), bevel=0.014, grad=0.1, tex='wood')
    p.cyl(0.035, 0.66, (0.33, 0, 0.72), p.vary(WOOD), seg=6, bevel=0, grad=0, tex='wood', rot=(0, -math.pi / 2, 0))
    p.cyl(0.006, 0.3, (0, 0, 0.42), '#c9b98a', seg=3, bevel=0, grad=0)  # rope
    p.cyl(0.07, 0.1, (0, 0, 0.33), p.vary(WOOD, 0.08), seg=8, r2=0.085, bevel=0.01, grad=0.1, tex='wood')  # bucket
    if p.v == 0:  # a little roof
        for s in (-1, 1):
            p.box((0.95, 0.42, 0.04), (0, s * 0.02, 0.93), p.vary('#7a4a34', 0.08), bevel=0.012, grad=0.05, rot=(s * 0.6, 0, 0), tex='wood', grain=0)
    else:
        p.box((0.86, 0.09, 0.08), (0, 0, 0.9), p.vary(WOOD_D), bevel=0.014, grad=0, tex='wood', grain=0)


@piece()
def p_fountain(p):
    r = p.rng
    ring(p, (0, 0, 0), 0.4, 11, 0, TAU, (0.22, 0.13, 0.2), lambda: stone_colour(p), axis='z', bevel=0.022, grad=0.1, tex='stone')
    p.cyl(0.36, 0.02, (0, 0, 0.13), '#4b8fb5', seg=14, bevel=0, grad=0)
    p.cyl(0.09, 0.42, (0, 0, 0.02), p.vary(STONE, 0.05), seg=8, r2=0.07, bevel=0.015, grad=0.1, tex='stone')
    p.cyl(0.12, 0.07, (0, 0, 0.44), p.vary(STONE, 0.05), seg=10, r2=0.23, bevel=0.012, grad=0.05, tex='stone')
    p.cyl(0.2, 0.012, (0, 0, 0.5), '#6fb1d3', seg=10, bevel=0, grad=0)
    p.cyl(0.03, 0.14, (0, 0, 0.5), p.vary(STONE, 0.05), seg=6, bevel=0.008, grad=0, tex='stone')
    p.blob(0.045, (0, 0, 0.66), '#9fd3ea', sub=1, scale=(1, 1, 0.7), grad=0, smooth=True)
    for i in range(4):  # water falling from the bowl
        a = i * TAU / 4 + 0.4
        p.cyl(0.016, 0.34, (math.cos(a) * 0.21, math.sin(a) * 0.21, 0.15), '#9fd3ea', seg=3, bevel=0, grad=0, smooth=False)


@piece(2)
def p_statue(p):
    r = p.rng
    m = p.vary(mix(hexcol('#c9c5bd'), hexcol(STONE), r.random()), 0.04)
    p.box((0.5, 0.5, 0.16), (0, 0, 0), stone_colour(p), bevel=0.025, grad=0.1, tex='stone')
    p.box((0.4, 0.4, 0.1), (0, 0, 0.16), stone_colour(p), bevel=0.02, grad=0.05, tex='stone')
    p.cyl(0.15, 0.45, (0, 0, 0.26), m, seg=9, r2=0.1, bevel=0.03, grad=0.2, tex='stone')  # robe
    p.cyl(0.12, 0.2, (0, 0, 0.66), m, seg=8, r2=0.13, bevel=0.03, grad=0.05, tex='stone')
    for s in (-1, 1):
        p.cyl(0.045, 0.24, (s * 0.15, 0, 0.82), m, seg=6, bevel=0.012, grad=0.05, tex='stone', rot=(-0.5 if s > 0 else 0.1, math.pi - s * 0.15, 0))
    if p.v == 0:
        p.blob(0.1, (0, 0, 0.96), m, sub=2, grad=0.1, smooth=True, tex='stone')
        p.box((0.03, 0.03, 0.6), (0.2, -0.16, 0.26), m, bevel=0.008, grad=0.05, tex='stone')  # staff
    else:  # headless, weathered, mossy
        p.blob(0.09, (0.28, -0.25, 0.08), m, sub=2, grad=0.1, smooth=True, tex='stone')
        p.blob(0.1, (-0.05, 0.02, 0.87), p.vary(MOSS, 0.1), sub=1, scale=(1.3, 1.2, 0.35), grad=0.2, smooth=True, tex='needle')


@piece(3)
def p_tent(p):
    r = p.rng
    cloth = p.vary(('#c9b48a', '#8a4b3a', '#5a7a8a')[p.v], 0.05)
    h, w = 0.72, 0.44
    a = math.atan2(w, h)
    for s in (-1, 1):  # two slopes of canvas meeting at the ridge
        p.box((0.03, 0.9, math.hypot(w, h)), (s * w, 0, 0), mul(cloth, 1.0 if s < 0 else 0.92), bevel=0.01, grad=0.12, rot=(0, -s * a, 0))
    p.box((0.05, 0.96, 0.05), (0, 0, h - 0.03), p.vary(WOOD_D), bevel=0.012, grad=0, tex='wood', grain=1)
    for y in (-0.46, 0.46):
        p.box((0.045, 0.045, h), (0, y, 0), p.vary(WOOD_D), bevel=0.01, grad=0.1, tex='wood')
    p.box((0.5, 0.02, 0.55), (0, 0.44, 0), mul(cloth, 0.7), bevel=0, grad=0.2, taper=0.05)  # the closed back
    for s in (-1, 1):  # door flaps tied back
        p.box((0.2, 0.02, 0.6), (s * 0.24, -0.44, 0), mul(cloth, 0.85), bevel=0, grad=0.15, rot=(0, -s * 0.5, 0), taper=0.2)
    for s in (-1, 1):
        for y in (-0.4, 0.4):
            p.cyl(0.015, 0.12, (s * (w + 0.1), y, 0), WOOD_L, seg=4, bevel=0, grad=0, smooth=False, rot=(0, s * 0.5, 0))


@piece(4)
def p_banner(p):
    r = p.rng
    cloth = hexcol(CLOTHS[p.v])
    p.cyl(0.1, 0.05, (0, 0, 0), p.vary(STONE, 0.05), seg=8, bevel=0.012, grad=0.1, tex='stone')
    p.cyl(0.028, 1.35, (0, 0, 0.04), p.vary(WOOD_D), seg=6, bevel=0, grad=0.1, tex='wood')
    p.blob(0.045, (0, 0, 1.41), GOLD, sub=1, grad=0.1, smooth=True)
    p.box((0.5, 0.035, 0.035), (0.16, 0, 1.24), p.vary(WOOD_D), bevel=0.008, grad=0, tex='wood', grain=0)
    p.box((0.4, 0.016, 0.6), (0.18, 0, 0.64), cloth, bevel=0.006, grad=0.18, rot=(r.uniform(-0.06, 0.06), 0, 0))
    for x in (0.08, 0.28):  # swallow tails
        p.box((0.2, 0.016, 0.16), (x, 0, 0.5), mul(cloth, 0.9), bevel=0.004, grad=0, taper=0.05, rot=(math.pi, 0, 0))
    p.blob(0.085, (0.18, 0, 0.95), GOLD, sub=1, scale=(1, 0.14, 1), grad=0.1, smooth=True)


@piece(4)
def p_tombstone(p):
    r = p.rng
    m = p.vary(mix(hexcol('#9a958c'), hexcol('#7f8a83'), r.random()), 0.05)
    lean = (r.uniform(-0.12, 0.12), r.uniform(-0.1, 0.1), 0)
    if p.v % 2 == 0:  # a rounded slab
        p.box((0.46, 0.13, 0.5), (0, 0, 0), m, bevel=0.025, grad=0.2, rot=lean, tex='stone')
        p.cyl(0.23, 0.13, (0, 0.065, 0.48), m, seg=10, bevel=0.02, grad=0, rot=(math.pi / 2 + lean[0], lean[1], 0), tex='stone')
    else:  # a cross
        p.box((0.14, 0.12, 0.78), (0, 0, 0), m, bevel=0.022, grad=0.2, rot=lean, tex='stone')
        p.box((0.46, 0.12, 0.14), (0, 0, 0.46), m, bevel=0.022, grad=0, rot=lean, tex='stone')
    p.blob(0.24, (0, -0.2, 0.0), p.vary('#7a5c40', 0.06), sub=1, rough=0.2, scale=(1.1, 1.5, 0.22), grad=0.2, tex='stone')  # the mound
    if p.v >= 2:
        p.blob(0.09, (r.uniform(-0.15, 0.15), 0.02, r.uniform(0.3, 0.5)), p.vary(MOSS, 0.1), sub=1, scale=(1.4, 0.6, 1), grad=0.2, smooth=True, tex='needle')


@piece(2)
def p_altar(p):
    r = p.rng
    p.box((0.96, 0.7, 0.1), (0, 0, 0), stone_colour(p), bevel=0.022, grad=0.1, tex='stone')
    for x in (-0.3, 0.3):
        p.box((0.2, 0.44, 0.34), (x, 0.04, 0.1), stone_colour(p), bevel=0.022, grad=0.1, tex='stone')
    p.box((0.9, 0.56, 0.1), (0, 0.04, 0.44), p.vary(mix(hexcol(STONE), hexcol('#d9d4cc'), 0.6), 0.04), bevel=0.025, grad=0.05, tex='stone')
    p.box((0.34, 0.6, 0.012), (0, 0.04, 0.54), p.vary(CLOTHS[p.v * 3], 0.05), bevel=0.004, grad=0)
    p.box((0.34, 0.012, 0.2), (0, -0.26, 0.345), p.vary(CLOTHS[p.v * 3], 0.05), bevel=0.004, grad=0.1)
    for x in (-0.34, 0.34):
        p.cyl(0.028, 0.16, (x, 0.1, 0.54), '#efe6d2', seg=6, bevel=0.006, grad=0.05)
        flame(p, (x, 0.1, 0.7), 0.035, 2)
    if p.v:
        p.box((0.2, 0.15, 0.04), (0, 0, 0.552), '#5a2f2a', bevel=0.008, grad=0, rot=(0, 0, 0.2))  # a book
    else:
        p.cyl(0.05, 0.1, (0, 0.02, 0.552), GOLD, seg=8, r2=0.07, bevel=0.01, grad=0.1)  # a chalice


# ---- furniture ---------------------------------------------------------------------

@piece(2)
def p_chair(p):
    r = p.rng
    w = lambda: p.vary(WOOD, 0.1)
    p.box((0.4, 0.4, 0.05), (0, 0, 0.26), w(), bevel=0.014, grad=0.03, tex='wood')
    for x in (-0.16, 0.16):
        for y in (-0.16, 0.16):
            tall = p.v == 0 and y > 0
            p.box((0.055, 0.055, 0.72 if tall else 0.27), (x, y, 0), p.vary(WOOD_D), bevel=0.012, grad=0.15, tex='wood')
    if p.v == 0:
        for z in (0.42, 0.6):
            p.box((0.3, 0.035, 0.09), (0, 0.16, z), w(), bevel=0.01, grad=0, tex='wood', grain=0)
    else:  # a three-legged stool has no back; give it a cushion
        p.cyl(0.17, 0.04, (0, 0, 0.31), p.vary(CLOTHS[0], 0.06), seg=10, bevel=0.015, grad=0.05)


@piece(2)
def p_bench(p):
    for i in range(2):
        p.box((0.92, 0.17, 0.05), (0, -0.09 + i * 0.18, 0.26), board_colour(p), bevel=0.014, grad=0.03, tex='wood')
    for x in (-0.36, 0.36):
        p.box((0.07, 0.32, 0.26), (x, 0, 0), p.vary(WOOD_D), bevel=0.014, grad=0.15, tex='wood', grain=2)
    p.box((0.66, 0.04, 0.06), (0, 0, 0.1), p.vary(WOOD_D), bevel=0.01, grad=0, tex='wood', grain=0)
    if p.v:
        for x in (-0.4, 0.4):
            p.box((0.055, 0.055, 0.62), (x, 0.17, 0), p.vary(WOOD_D), bevel=0.012, grad=0.1, tex='wood')
        for z in (0.4, 0.54):
            p.box((0.86, 0.035, 0.09), (0, 0.17, z), board_colour(p), bevel=0.01, grad=0, tex='wood', grain=0)


@piece(3)
def p_bed(p):
    r = p.rng
    cover = p.vary(CLOTHS[p.v * 2], 0.05)
    for x in (-0.3, 0.3):
        p.box((0.07, 0.07, 0.5), (x, 0.43, 0), p.vary(WOOD_D), bevel=0.014, grad=0.1, tex='wood')
        p.box((0.07, 0.07, 0.32), (x, -0.43, 0), p.vary(WOOD_D), bevel=0.014, grad=0.1, tex='wood')
    p.box((0.62, 0.05, 0.22), (0, 0.43, 0.24), p.vary(WOOD), bevel=0.014, grad=0.05, tex='wood', grain=0)  # headboard
    p.box((0.62, 0.05, 0.12), (0, -0.43, 0.16), p.vary(WOOD), bevel=0.014, grad=0.05, tex='wood', grain=0)
    p.box((0.62, 0.88, 0.07), (0, 0, 0.12), p.vary(WOOD_D), bevel=0.012, grad=0, tex='wood')
    p.box((0.58, 0.84, 0.09), (0, 0, 0.19), '#e6dcc6', bevel=0.03, grad=0.05)  # mattress
    p.box((0.4, 0.2, 0.07), (0, 0.28, 0.27), '#f3eee2', bevel=0.03, grad=0.05, rot=(0, 0, r.uniform(-0.12, 0.12)))  # pillow
    p.box((0.6, 0.56, 0.05), (0, -0.14, 0.265), cover, bevel=0.022, grad=0.05)
    p.box((0.6, 0.1, 0.055), (0, 0.13, 0.268), mul(cover, 1.25), bevel=0.02, grad=0)  # the turn-down


@piece(3)
def p_bookshelf(p):
    r = p.rng
    case = p.vary(WOOD_D, 0.08)
    p.box((0.9, 0.04, 0.98), (0, 0.16, 0), mul(case, 0.8), bevel=0, grad=0.1, tex='wood')
    for x in (-0.43, 0.43):
        p.box((0.05, 0.32, 0.98), (x, 0.02, 0), case, bevel=0.012, grad=0.1, tex='wood')
    for i in range(4):
        z = i * 0.31
        p.box((0.86, 0.3, 0.04), (0, 0.02, z), p.vary(WOOD, 0.08), bevel=0.01, grad=0, tex='wood', grain=0)
        if i == 3:
            break
        x = -0.39
        while x < 0.36:  # a row of books, no two alike, some leaning, the odd gap
            w, h = r.uniform(0.04, 0.085), r.uniform(0.17, 0.25)
            if r.random() < 0.12:
                x += r.uniform(0.05, 0.12)
                continue
            lean = r.uniform(-0.22, 0.22) if r.random() < 0.2 else 0
            p.box((w - 0.006, r.uniform(0.18, 0.24), h), (x + w / 2, 0.0, z + 0.04), p.vary(r.choice(('#7a2f2a', '#2f4f7a', '#3f6a45', '#7a5a2a', '#5a3a6a', '#c9b98a', '#3a3530')), 0.1),
                  bevel=0, grad=0.05, rot=(0, lean, 0))
            x += w


@piece()
def p_throne(p):
    for x in (-0.28, 0.28):
        p.box((0.1, 0.5, 0.52), (x, 0, 0), p.vary(WOOD_D), bevel=0.02, grad=0.1, tex='wood', grain=2)
        p.blob(0.06, (x, -0.24, 0.55), GOLD, sub=1, grad=0.1, smooth=True)
    p.box((0.5, 0.5, 0.3), (0, 0, 0), p.vary(WOOD_D), bevel=0.02, grad=0.15, tex='wood')
    p.box((0.46, 0.44, 0.07), (0, -0.02, 0.3), RED, bevel=0.03, grad=0.05)
    p.box((0.62, 0.1, 1.15), (0, 0.24, 0), p.vary(WOOD_D), bevel=0.025, grad=0.1, tex='wood', taper=0.8)
    p.box((0.4, 0.03, 0.6), (0, 0.185, 0.42), RED, bevel=0.02, grad=0.1)
    p.box((0.56, 0.12, 0.06), (0, 0.24, 1.13), GOLD, bevel=0.02, grad=0.05)
    for x in (-0.2, 0, 0.2):
        p.cyl(0.035, 0.12, (x, 0.24, 1.18), GOLD, seg=4, r2=0, bevel=0, grad=0, smooth=False)


@piece(4)
def p_rug(p):
    r = p.rng
    main, edge = hexcol(CLOTHS[p.v]), hexcol(CLOTHS[(p.v + 3) % 6])
    p.box((0.92, 0.7, 0.018), (0, 0, 0), mul(edge, 0.9), bevel=0.006, grad=0)
    p.box((0.8, 0.58, 0.02), (0, 0, 0.003), p.vary(main, 0.04), bevel=0.004, grad=0)
    if p.v % 2:
        for x in (-0.24, 0, 0.24):
            p.box((0.1, 0.1, 0.02), (x, 0, 0.006), mul(edge, 1.15), bevel=0.003, grad=0, rot=(0, 0, math.pi / 4))
    else:
        p.box((0.56, 0.34, 0.02), (0, 0, 0.006), mul(edge, 1.1), bevel=0.003, grad=0)
        p.box((0.44, 0.22, 0.02), (0, 0, 0.009), p.vary(main, 0.04), bevel=0.003, grad=0)
    for s in (-1, 1):  # fringe
        for i in range(9):
            p.box((0.012, 0.012, 0.004), (s * 0.475, -0.3 + i * 0.075, 0.004), '#e6dcc6', bevel=0, grad=0)


@piece(3)
def p_sacks(p):
    r = p.rng
    for i in range(r.choice((2, 3, 4))):
        x, y = r.uniform(-0.2, 0.2), r.uniform(-0.2, 0.2)
        s = r.uniform(0.8, 1.15)
        z = 0.0 if i < 3 else 0.26
        c = p.vary(mix(hexcol('#c9b48a'), hexcol('#a8916a'), r.random()), 0.05)
        p.blob(0.19 * s, (x, y, z + 0.17 * s), c, sub=2, rough=0.12, scale=(1, 0.9, 1.0), grad=0.25, smooth=True)
        p.cyl(0.05 * s, 0.07 * s, (x, y, z + 0.33 * s), mul(c, 0.95), seg=6, r2=0.08 * s, bevel=0, grad=0, rot=(r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), 0))
        p.cyl(0.055 * s, 0.018, (x, y, z + 0.33 * s), '#7a5c40', seg=6, bevel=0, grad=0)
    if p.v == 2:  # one has split: grain on the floor
        p.blob(0.14, (0.3, -0.26, 0.0), '#e2c66a', sub=1, scale=(1.2, 1, 0.18), grad=0.1, smooth=True)


@piece(2)
def p_cauldron(p):
    r = p.rng
    for i in range(3):
        a = i * TAU / 3
        p.box((0.06, 0.06, 0.14), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0), IRON, bevel=0.012, grad=0.1)
    p.cyl(0.16, 0.14, (0, 0, 0.1), mul(hexcol(IRON), 0.8), seg=12, r2=0.27, bevel=0, grad=0.2)
    p.cyl(0.27, 0.16, (0, 0, 0.24), mul(hexcol(IRON), 0.85), seg=12, r2=0.24, bevel=0, grad=0.05)
    p.cyl(0.265, 0.035, (0, 0, 0.4), IRON, seg=12, bevel=0.01, grad=0)
    brew = ('#7ec84a', '#c85ad0')[p.v]
    p.cyl(0.225, 0.012, (0, 0, 0.415), brew, seg=12, bevel=0, grad=0, tex='glow')
    for _ in range(4):
        p.blob(r.uniform(0.02, 0.045), (r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.15), 0.43), mul(hexcol(brew), 1.2), sub=1, grad=0, smooth=True, tex='glow')
    p.box((0.025, 0.025, 0.42), (0.1, 0.05, 0.3), p.vary(WOOD_L), bevel=0.006, grad=0, rot=(0.3, 0.4, 0), tex='wood')  # a ladle


@piece()
def p_anvil(p):
    p.cyl(0.24, 0.3, (0, 0, 0), p.vary('#6f4b2d'), seg=9, r2=0.22, bevel=0, grad=0.2, tex='wood')
    p.cyl(0.2, 0.012, (0, 0, 0.3), '#d6b98a', seg=9, bevel=0, grad=0)
    iron = mul(hexcol(IRON), 1.1)
    p.box((0.26, 0.18, 0.08), (0, 0, 0.31), iron, bevel=0.018, grad=0.1)
    p.box((0.14, 0.12, 0.1), (0, 0, 0.39), iron, bevel=0.012, grad=0.05)
    p.box((0.44, 0.17, 0.1), (0.02, 0, 0.49), mul(iron, 1.15), bevel=0.018, grad=0.05)
    p.cyl(0.075, 0.24, (-0.2, 0, 0.54), mul(iron, 1.15), seg=7, r2=0.01, bevel=0, grad=0, rot=(0, -math.pi / 2, 0))  # the horn
    p.box((0.035, 0.035, 0.3), (0.18, -0.2, 0.0), p.vary(WOOD_L), bevel=0.008, grad=0, rot=(-0.4, 0, 0), tex='wood')  # hammer, leaning
    p.box((0.13, 0.06, 0.06), (0.18, -0.09, 0.25), IRON, bevel=0.012, grad=0, rot=(-0.4, 0, 0))


@piece(3)
def p_candles(p):
    r = p.rng
    if p.v == 2:  # a standing candelabrum
        p.cyl(0.12, 0.04, (0, 0, 0), IRON, seg=8, bevel=0.01, grad=0.1)
        p.cyl(0.022, 0.8, (0, 0, 0.03), IRON, seg=6, bevel=0, grad=0.1)
        p.box((0.46, 0.03, 0.03), (0, 0, 0.74), IRON, bevel=0.008, grad=0)
        spots = [(-0.2, 0, 0.77), (0, 0, 0.83), (0.2, 0, 0.77)]
    else:
        p.cyl(0.2, 0.02, (0, 0, 0), ('#8a8f96', '#b08d4a')[p.v], seg=10, bevel=0.006, grad=0.05)
        spots = [(r.uniform(-0.12, 0.12), r.uniform(-0.12, 0.12), 0.02) for _ in range(r.randint(3, 5))]
    for x, y, z in spots:
        h = r.uniform(0.08, 0.22)
        p.cyl(0.028, h, (x, y, z), p.vary('#efe6d2', 0.04), seg=6, bevel=0.006, grad=0.05)
        p.blob(0.034, (x + 0.01, y, z + h * 0.95), '#f6f0e2', sub=1, scale=(1.1, 1.1, 0.4), grad=0, smooth=True)  # run wax
        flame(p, (x, y, z + h), 0.03, 2)


# ---- dungeon -----------------------------------------------------------------------

@piece(2)
def p_torch(p):
    if p.v == 0:  # a standing torch
        p.cyl(0.11, 0.05, (0, 0, 0), p.vary(STONE, 0.05), seg=8, bevel=0.012, grad=0.1, tex='stone')
        p.cyl(0.03, 0.78, (0, 0, 0.04), p.vary(WOOD_D), seg=6, bevel=0, grad=0.1, tex='wood')
        p.cyl(0.04, 0.1, (0, 0, 0.78), IRON, seg=7, r2=0.075, bevel=0.008, grad=0.05)
        flame(p, (0, 0, 0.86), 0.075, 3)
    else:  # a brazier on three legs
        for i in range(3):
            a = i * TAU / 3
            p.box((0.035, 0.035, 0.56), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0), IRON, bevel=0.008, grad=0.1, rot=(math.sin(a) * 0.3, -math.cos(a) * 0.3, 0))
        p.cyl(0.1, 0.12, (0, 0, 0.46), IRON, seg=9, r2=0.2, bevel=0.012, grad=0.1)
        p.cyl(0.17, 0.02, (0, 0, 0.57), '#ff7a1f', seg=9, bevel=0, grad=0, tex='glow')
        flame(p, (0, 0, 0.58), 0.1, 4)


@piece(3)
def p_campfire(p):
    r = p.rng
    ring(p, (0, 0, 0), 0.3, r.choice((7, 8, 9)), 0.3, TAU + 0.3, (0.16, 0.13, 0.1), lambda: stone_colour(p), axis='z', bevel=0.03, grad=0.15, tex='stone')
    p.cyl(0.24, 0.02, (0, 0, 0), '#2a2622', seg=10, bevel=0, grad=0)  # ash
    for i in range(r.choice((3, 4))):
        a = i * TAU / 3 + r.uniform(-0.3, 0.3)
        p.cyl(0.045, 0.42, (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.04), p.vary('#4a3423', 0.08), seg=6, bevel=0, grad=0, tex='wood', rot=(0, -1.15, a))
    if p.v < 2:
        p.cyl(0.11, 0.02, (0, 0, 0.05), '#ff6a1f', seg=8, bevel=0, grad=0, tex='glow')
        flame(p, (0, 0, 0.06), 0.13, 4)
    else:  # burnt out: only embers
        for _ in range(5):
            p.blob(0.03, (r.uniform(-0.1, 0.1), r.uniform(-0.1, 0.1), 0.04), '#ff5a1a', sub=1, scale=(1, 1, 0.5), grad=0, tex='glow')


@piece(3)
def p_chest(p):
    r = p.rng
    for i in range(3):
        p.box((0.66, 0.44, 0.105), (0, 0, 0.02 + i * 0.105), board_colour(p), bevel=0.012, grad=0.05, tex='wood', grain=0)
    lid_open = p.v == 2
    if lid_open:  # thrown back on its hinges
        p.box((0.66, 0.07, 0.42), (0, 0.25, 0.33), board_colour(p), bevel=0.014, grad=0.03, tex='wood', grain=0, rot=(-0.3, 0, 0))
    else:  # a barrel lid in three staves
        for y, z, tilt in ((-0.13, 0.335, 0.45), (0, 0.365, 0), (0.13, 0.335, -0.45)):
            p.box((0.66, 0.17, 0.06), (0, y, z), board_colour(p), bevel=0.014, grad=0.03, tex='wood', grain=0, rot=(tilt, 0, 0))
    for x in (-0.24, 0.24):
        p.box((0.06, 0.47, 0.36 if not lid_open else 0.33), (x, 0, 0.015), IRON, bevel=0.01, grad=0.1)
    p.box((0.1, 0.03, 0.12), (0, -0.23, 0.22), GOLD, bevel=0.012, grad=0.05)
    if lid_open:  # and what is inside
        p.blob(0.24, (0, 0, 0.3), GOLD, sub=2, rough=0.25, scale=(1.15, 0.75, 0.45), grad=0.2)
        for _ in range(3):
            p.blob(0.035, (r.uniform(-0.2, 0.2), r.uniform(-0.1, 0.1), 0.4), r.choice(('#e0453f', '#3fb0e0', '#5fd06a')), sub=1, grad=0, tex='glow')


@piece(2)
def p_hoard(p):
    r = p.rng
    p.blob(0.34, (0, 0, 0.06), GOLD, sub=2, rough=0.3, freq=2.5, scale=(1.15, 1.05, 0.5), grad=0.3, lift=0.1)
    for _ in range(14):  # loose coins round the edge
        a, d = r.uniform(0, TAU), r.uniform(0.25, 0.44)
        p.cyl(0.035, 0.012, (math.cos(a) * d, math.sin(a) * d, r.uniform(0.0, 0.06)), p.vary(GOLD, 0.08), seg=7, bevel=0, grad=0, rot=(r.uniform(-0.6, 0.6), r.uniform(-0.6, 0.6), 0))
    for _ in range(4):
        a, d = r.uniform(0, TAU), r.uniform(0.05, 0.22)
        p.blob(0.04, (math.cos(a) * d, math.sin(a) * d, r.uniform(0.18, 0.24)), r.choice(('#e0453f', '#3fb0e0', '#5fd06a', '#c85ad0')), sub=1, grad=0, tex='glow')
    p.cyl(0.035, 0.06, (0.1, -0.05, 0.24), GOLD, seg=7, r2=0.06, bevel=0.008, grad=0.1, rot=(0.3, 0.2, 0))  # a goblet
    if p.v:
        p.box((0.04, 0.02, 0.5), (-0.12, 0.05, 0.12), '#dfe4ea', bevel=0.008, grad=0.05, rot=(0.5, -0.4, 0), taper=0.5)  # a sword in the pile
        p.box((0.16, 0.035, 0.03), (-0.12, 0.05, 0.14), mul(hexcol(GOLD), 0.8), bevel=0.008, grad=0, rot=(0.5, -0.4, 0))


@piece(4)
def p_potion(p):
    r = p.rng
    liquids = ('#e0453f', '#3fb0e0', '#5fd06a', '#c85ad0')
    for i in range(r.choice((2, 3))):
        x, y = -0.14 + i * 0.15 + r.uniform(-0.03, 0.03), r.uniform(-0.1, 0.1)
        s = r.uniform(0.75, 1.15)
        liquid = liquids[(p.v + i) % 4]
        if (p.v + i) % 2:
            p.blob(0.085 * s, (x, y, 0.08 * s), liquid, sub=2, scale=(1, 1, 0.9), grad=0.2, smooth=True, tex='glow')
        else:
            p.cyl(0.07 * s, 0.14 * s, (x, y, 0), liquid, seg=8, r2=0.05 * s, bevel=0.02, grad=0.2, tex='glow')
        p.cyl(0.028 * s, 0.07 * s, (x, y, 0.14 * s), '#bcd3d6', seg=6, bevel=0.006, grad=0)
        p.cyl(0.03 * s, 0.03 * s, (x, y, 0.2 * s), '#a47a4a', seg=6, bevel=0.006, grad=0)


@piece()
def p_cage(p):
    p.box((0.7, 0.7, 0.07), (0, 0, 0), p.vary(WOOD_D), bevel=0.014, grad=0.1, tex='wood')
    p.box((0.7, 0.7, 0.06), (0, 0, 0.9), IRON, bevel=0.014, grad=0.05)
    for i in range(12):
        t = i / 12 * 4
        side, k = int(t), (t % 1) * 0.6 - 0.3 + 0.025
        x, y = ((k, -0.31), (0.31, k), (-k, 0.31), (-0.31, -k))[side]
        p.cyl(0.018, 0.84, (x, y, 0.06), IRON, seg=5, bevel=0, grad=0.05)
    p.cyl(0.05, 0.03, (0, 0, 0.96), IRON, seg=6, bevel=0.006, grad=0)
    p.box((0.1, 0.03, 0.12), (0.2, -0.32, 0.42), GOLD, bevel=0.01, grad=0)  # the lock


@piece(3)
def p_bones(p):
    r = p.rng
    bone = p.vary('#e6dfcd', 0.04)
    p.blob(0.1, (r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.1), 0.085), bone, sub=2, scale=(1, 1.1, 0.9), grad=0.15, smooth=True)  # skull
    for _ in range(r.choice((3, 4, 5))):
        x, y, a, length = r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), r.uniform(0, TAU), r.uniform(0.2, 0.34)
        p.cyl(0.02, length, (x, y, 0.025), bone, seg=5, bevel=0, grad=0, rot=(math.pi / 2, 0, a))
        for s in (0, 1):
            p.blob(0.032, (x + math.sin(a) * length * s, y - math.cos(a) * length * s, 0.03), bone, sub=1, grad=0, smooth=True)
    if p.v == 2:  # a rib cage
        for i in range(4):
            p.cyl(0.012, 0.3, (-0.12 + i * 0.07, 0.25, 0.02), bone, seg=4, bevel=0, grad=0, rot=(0.9, 0, 0))


@piece(2)
def p_spikes(p):
    r = p.rng
    p.box((0.92, 0.92, 0.04), (0, 0, 0), mul(hexcol(IRON), 0.8), bevel=0.012, grad=0)
    n = 4 if p.v == 0 else 3
    for i in range(n):
        for j in range(n):
            x, y = -0.33 + i * 0.66 / (n - 1), -0.33 + j * 0.66 / (n - 1)
            h = r.uniform(0.3, 0.42)
            p.cyl(0.05, h, (x, y, 0.03), p.vary(STEEL, 0.05), seg=5, r2=0, bevel=0, grad=0.2, smooth=False)
            if p.v and r.random() < 0.3:
                p.cyl(0.03, h * 0.35, (x, y, 0.03 + h * 0.65), '#8f2a26', seg=5, r2=0, bevel=0, grad=0, smooth=False)


@piece(2)
def p_coffin(p):
    r = p.rng
    w = p.vary(mix(hexcol(WOOD_D), hexcol('#3a2a20'), 0.4), 0.05)
    for y0, y1, w0, w1 in ((-0.46, 0.14, 0.3, 0.48), (0.14, 0.46, 0.48, 0.36)):  # wide at the shoulders
        p.box((max(w0, w1), y1 - y0, 0.24), (0, (y0 + y1) / 2, 0), w, bevel=0.016, grad=0.15, tex='wood')
    shift = (0.16, 0, 0.26, 0.25) if p.v else (0, 0, 0.24, 0)
    for y0, y1, wide in ((-0.46, 0.14, 0.44), (0.14, 0.46, 0.44)):
        p.box((wide, y1 - y0 - 0.01, 0.04), (shift[0], (y0 + y1) / 2, shift[2]), mul(w, 1.12), bevel=0.014, grad=0, tex='wood', rot=(0, shift[3], 0))
    p.box((0.05, 0.3, 0.012), (shift[0], 0.12, shift[2] + 0.04), GOLD, bevel=0.004, grad=0, rot=(0, shift[3], 0))
    p.box((0.18, 0.05, 0.012), (shift[0], 0.2, shift[2] + 0.04), GOLD, bevel=0.004, grad=0, rot=(0, shift[3], 0))
    if p.v:
        p.blob(0.07, (-0.05, 0.22, 0.2), '#e6dfcd', sub=1, grad=0.1, smooth=True)  # someone is home


@piece(3)
def p_portal(p):
    r = p.rng
    light = (hexcol('#7a5cf0'), hexcol('#3fd0c0'), hexcol('#f06a3a'))[p.v]
    p.box((0.9, 0.3, 0.1), (0, 0, 0), stone_colour(p), bevel=0.022, grad=0.1, tex='stone')
    ring(p, (0, 0, 0.6), 0.5, 13, -2.6, 2.6, (0.2, 0.2, 0.16), lambda: stone_colour(p), bevel=0.025, grad=0.05, tex='stone', taper=0.85)
    p.cyl(0.35, 0.03, (0, 0.015, 0.6), mul(light, 0.75), seg=14, bevel=0, grad=0, tex='glow', rot=(math.pi / 2, 0, 0))
    p.cyl(0.24, 0.04, (0, 0.02, 0.6), light, seg=12, bevel=0, grad=0, tex='glow', rot=(math.pi / 2, 0, 0))
    p.cyl(0.11, 0.05, (0, 0.025, 0.6), mix(light, (1, 1, 1), 0.5), seg=10, bevel=0, grad=0, tex='glow', rot=(math.pi / 2, 0, 0))
    for i in range(4):  # runes on the stones
        a = -1.8 + i * 1.2
        p.box((0.05, 0.22, 0.05), (math.sin(a) * 0.42, 0, 0.6 + math.cos(a) * 0.42), light, bevel=0, grad=0, tex='glow', rot=(0, a, 0))
