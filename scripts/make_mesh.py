"""Generate the adaptively refined FEM-style mesh used as the hero background.

Usage:  pip install numpy scipy && python scripts/make_mesh.py assets/img/mesh.svg
Tweak target_h() for density, cx/cy for the refinement centre, rng seed for a new layout.
"""
import sys, numpy as np
from scipy.spatial import Delaunay

rng = np.random.default_rng(7)
W, H = 1600, 640
# Refinement centre (behind the profile photo, right side of hero)
cx, cy = 1250, 300

def target_h(x, y):
    d = np.hypot(x - cx, (y - cy) * 1.2)
    return 13 + 0.075 * d          # small elements near centre, coarse far away

# Rejection-sample a variable-density point cloud (simple dart throwing)
pts = []
cand = rng.uniform([-60, -60], [W + 60, H + 60], size=(60000, 2))
grid = {}
cell = 20
for x, y in cand:
    h = target_h(x, y)
    gx, gy = int(x // cell), int(y // cell)
    r = int(np.ceil(h / cell))
    ok = True
    for i in range(gx - r, gx + r + 1):
        for j in range(gy - r, gy + r + 1):
            for (px, py) in grid.get((i, j), ()):
                if (px - x) ** 2 + (py - y) ** 2 < (0.5 * (h + target_h(px, py))) ** 2:
                    ok = False; break
            if not ok: break
        if not ok: break
    if ok:
        pts.append((x, y)); grid.setdefault((gx, gy), []).append((x, y))
pts = np.array(pts)
tri = Delaunay(pts)

# A smooth "solution field" to colour elements, like a contour plot
def field(x, y):
    return (np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 260 ** 2))
            + 0.35 * np.sin(x / 210.0) * np.cos(y / 170.0))

bins = 7
groups = [[] for _ in range(bins)]
edges = set()
for s in tri.simplices:
    p = pts[s]
    c = p.mean(axis=0)
    v = field(*c)
    b = int(np.clip((v + 0.35) / 1.4 * bins, 0, bins - 1))
    groups[b].append("M{:.0f} {:.0f}L{:.0f} {:.0f}L{:.0f} {:.0f}Z".format(*p.ravel()))
    for a, bb in ((s[0], s[1]), (s[1], s[2]), (s[2], s[0])):
        edges.add((min(a, bb), max(a, bb)))

edge_d = "".join("M{:.0f} {:.0f}L{:.0f} {:.0f}".format(*pts[a], *pts[b]) for a, b in edges)
out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice">']
VIRIDIS = ["#440154", "#443a83", "#31688e", "#21918c", "#35b779", "#8fd744", "#fde725"]
for i, g in enumerate(groups):
    if not g: continue
    op = 0.06 + 0.34 * (i / (bins - 1)) ** 1.4
    out.append(f'<path fill="{VIRIDIS[i]}" fill-opacity="{op:.3f}" d="{"".join(g)}"/>')
out.append(f'<path fill="none" stroke="#35b779" stroke-opacity=".2" stroke-width="1" d="{edge_d}"/>')
dots = "".join(f'M{x:.0f} {y:.0f}h0' for x, y in pts)
out.append(f'<path stroke="#fde725" stroke-opacity=".4" stroke-width="2.6" stroke-linecap="round" d="{dots}"/>')
out.append('</svg>')
open(sys.argv[1], 'w').write("".join(out))
print(len(pts), "nodes,", len(tri.simplices), "elements")
