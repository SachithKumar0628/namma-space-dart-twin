"""Generate a deterministic-texture indoor room for SfM smoke testing."""
import cv2
import numpy as np
import os
import math

os.makedirs("sfm_smoke/images", exist_ok=True)

def tex_color(pt):
    x, y, z = pt
    cx = int(math.floor(x * 2.0))
    cz = int(math.floor(z * 2.0))
    base = ((cx + cz) % 2) * 120 + 60
    if abs(y) < 0.02:
        return (int(base * 0.8), int(base * 0.6), int(base * 0.4))
    stripe = (cx % 2) * 100 + 80
    return (int(stripe * 0.9), int(stripe * 0.7), int(stripe * 1.0))

def render(cam, lookat):
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    f = 500.0
    forward = (lookat - cam).astype(float); forward /= np.linalg.norm(forward)
    right = np.cross(forward, np.array([0, 1, 0], float)); right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    def proj(p):
        p = np.asarray(p, float)
        d = p - cam
        x = float(np.dot(d, right)); y = float(np.dot(d, up)); z = float(np.dot(d, forward))
        if z <= 0.2:
            return None
        return (int(320 + f * x / z), int(240 + f * y / z))
    def quad(c1, c2, c3, c4):
        pts = [proj(c1), proj(c2), proj(c3), proj(c4)]
        if any(q is None for q in pts):
            return
        pts = np.array(pts, np.int32)
        cen = (c1 + c2 + c3 + c4) / 4.0
        cv2.fillConvexPoly(img, pts, tex_color(cen))
        for i in range(1, 4):
            for j in range(1, 4):
                p = c1*(1-i/4)*(1-j/4) + c2*(i/4)*(1-j/4) + c3*(i/4)*(j/4) + c4*(1-i/4)*(j/4)
                pj = proj(p)
                if pj:
                    cv2.circle(img, pj, 2, (200, 200, 200), -1)
    def pillar(c, r, h, color):
        # draw a vertical cylinder pillar as textured rect facing camera approx
        pts = [proj(c + np.array([-r,0,-r])), proj(c + np.array([r,0,-r])),
               proj(c + np.array([r,0,r])), proj(c + np.array([-r,0,r]))]
        if any(p is None for p in pts):
            return
        pts = np.array(pts, np.int32)
        cv2.fillConvexPoly(img, pts, color)
        top = [proj(c + np.array([-r,h,-r])), proj(c + np.array([r,h,-r])),
               proj(c + np.array([r,h,r])), proj(c + np.array([-r,h,r]))]
        if all(p is not None for p in top):
            top = np.array(top, np.int32)
            cv2.fillConvexPoly(img, top, color)
    h = 1.0
    bl = np.array([-2.5, 0, -2.5]); br = np.array([2.5, 0, -2.5])
    tr = np.array([2.5, 0, 2.5]);  tl = np.array([-2.5, 0, 2.5])
    blt = bl + np.array([0, h, 0]); brt = br + np.array([0, h, 0])
    trt = tr + np.array([0, h, 0]); tlt = tl + np.array([0, h, 0])
    quad(bl, br, tr, tl)      # floor
    quad(blt, brt, trt, tlt)  # ceiling
    quad(bl, br, brt, blt)    # south
    quad(br, tr, trt, brt)    # east
    quad(tr, tl, tlt, trt)    # north
    quad(tl, bl, blt, tlt)    # west
    # central textured pillar visible from all views
    pillar(np.array([0.0, 0.0, 0.0]), 0.35, 1.2, (200, 120, 60))
    return img

lookat = np.array([0.0, 1.0, 0.0])
RADIUS = 2.6
for i in range(14):
    ang = 2 * math.pi * i / 14
    cam = np.array([RADIUS * math.cos(ang), 1.0, RADIUS * math.sin(ang)])
    cv2.imwrite(f"sfm_smoke/images/f{i:02d}.jpg", render(cam, lookat))
print(f"Wrote 14 deterministic-texture indoor images (radius={RADIUS}m, central pillar)")

