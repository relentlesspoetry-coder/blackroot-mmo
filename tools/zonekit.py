"""What every zone builder needs, and only that.

The Dark Woods builder grew to three thousand lines, and the parts of it that
are about ROUTING A ROAD OVER A TRACED GRID rather than about the Dark Woods
were going to be copied wholesale into the next zone. That is the move this
codebase has paid for over and over -- the terrain, the shoreline, the deck
spans, the shore again, two populations of moths -- so the generic half lives
here and both zones import it.

Nothing in this file knows which zone it is working on. Anything that does --
where the water line sits, how tall the cliffs are, what the landmarks are --
stays with the zone.
"""
import heapq
import math


def make_xform(d):
    p = d['px']
    S = p['unitsPerPx']

    def world(px, py):
        return (round((px - p['x0']) * S + d['minX'], 1),
                round((py - p['y0']) * S + d['minZ'], 1))
    return world



# ----------------------------------------------------------------- routing
STEP_COST = {'.': 1.0, 'f': 1.25, 'F': 2.1, 'w': 9.0, 'W': 40.0, 'R': 60.0, ' ': 400.0}

# Wading a river costs this much per cell. It has to be dear enough that the
# router will walk a long way round to reach a bridge, but not so dear that a
# landmark on the far bank becomes unreachable -- so it is a cost, not a wall.
FORD_COST = 26.0


# What a span of plank walk costs the router per cell. Dearer than open ground
# (you would not detour into a marsh for fun) but far cheaper than wading it, so
# where the direct line lies across the fen the road takes it -- on planks.
DECK_COST = 2.4


def route(d, a, b, bridge_cells, river_cells=(), deck_cells=()):
    """A* from cell a to cell b over the traced grid.

    river_cells matters more than it looks. The trace classifies the LAKE and the
    fen as water, but the streams are drawn as thin blue lines that the trace's
    blur washes out -- so as far as the grid is concerned the Crowwater is dry
    open ground. The first build therefore let every road stroll straight across
    every river: five crossings, five fords, and six bridges standing in fields
    nobody walked through. Rivers are rasterised from their POLYLINES and made
    expensive here, so a road goes round to a bridge or pays for the ford.
    """
    W, H, rows = d['w'], d['h'], d['rows']
    (ax, az), (bx, bz) = a, b

    def cost(x, z):
        c = rows[z][x]
        k = STEP_COST.get(c, 4.0)
        wet = c in 'Ww' or (x, z) in river_cells
        if wet:
            if (x, z) in bridge_cells:
                k = 1.4                               # a bridge deck, not a ford
            elif (x, z) in deck_cells:
                k = DECK_COST                         # planked: the Murkfen walks
            elif (x, z) in river_cells:
                k = max(k, FORD_COST)
        return k

    def h(x, z):
        return math.hypot(x - bx, z - bz)

    start = (ax, az)
    goal = (bx, bz)
    best = {start: 0.0}
    came = {}
    pq = [(h(*start), start)]
    seen = set()
    NB = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    while pq:
        _, cur = heapq.heappop(pq)
        if cur in seen:
            continue
        seen.add(cur)
        if cur == goal:
            break
        cx, cz = cur
        for dx, dz in NB:
            nx, nz = cx + dx, cz + dz
            if nx < 0 or nz < 0 or nx >= W or nz >= H:
                continue
            diag = dx and dz
            if diag:
                # never cut a diagonal past a blocked corner: a road that does
                # it looks like it walks through the rock it is going round
                if rows[cz][nx] == ' ' or rows[nz][cx] == ' ':
                    continue
            step = (1.414 if diag else 1.0) * cost(nx, nz)
            g = best[cur] + step
            if g < best.get((nx, nz), 1e18):
                best[(nx, nz)] = g
                came[(nx, nz)] = cur
                heapq.heappush(pq, (g + h(nx, nz), (nx, nz)))
    if goal not in came and goal != start:
        return None
    path = [goal]
    while path[-1] != start:
        path.append(came[path[-1]])
    path.reverse()
    return path


def simplify(pts, tol):
    """Douglas-Peucker, then a pass that puts back any corner the simplifier
    cut across -- a straightened road that clips a cliff is worse than a
    slightly wobbly one."""
    if len(pts) < 3:
        return pts[:]
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz or 1.0
    worst, wi = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, pz = pts[i]
        t = max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2))
        d = math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t))
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [a, b]
    return simplify(pts[:wi + 1], tol)[:-1] + simplify(pts[wi:], tol)

