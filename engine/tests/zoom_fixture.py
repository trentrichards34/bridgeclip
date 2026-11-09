"""A synthetic screen recording for the screen-zoom tests: a 1280x720 fake desktop (a window with a sidebar and
lines of text), a moving cursor, text typed into one box, a webcam-like spot that changes every frame (always busy),
a full-screen scroll and a menu opening in another corner."""
from __future__ import annotations

import subprocess

W, H, FPS = 1280, 720, 30
SECONDS = 16.0
# Where the typing happens (px): the box the zoom should land on.
TYPE_BOX = (140, 170, 560, 250)
TYPE_START, TYPE_END = 2.5, 9.0
SCROLL_AT = 10.0
MENU_BOX = (900, 470, 1180, 640)
MENU_START, MENU_END = 11.0, 15.5
CAM_BOX = (20, 560, 200, 700)
TYPED = "Revenue this month: $1,227.00 from 31 new members"


def frame_at(n: int):
    import cv2
    import numpy as np
    t = n / FPS
    img = np.full((H, W, 3), (70, 60, 50), np.uint8)
    # The window.
    scroll = int(max(0.0, min(1.0, (t - SCROLL_AT) / 0.4)) * 140) if t >= SCROLL_AT else 0
    cv2.rectangle(img, (60, 40), (1220, 680), (245, 245, 245), -1)
    cv2.rectangle(img, (60, 40), (1220, 80), (225, 225, 225), -1)
    for k, c in enumerate(((90, 90, 240), (60, 200, 240), (90, 200, 90))):
        cv2.circle(img, (85 + k * 22, 60), 7, c, -1)
    cv2.rectangle(img, (60, 80), (120, 680), (232, 232, 236), -1)
    for row in range(14):
        y = 300 + row * 28 - scroll
        if 90 < y < 660:
            cv2.putText(img, f"Line {row + 1}: notes about the plan and the steps", (620, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
            cv2.putText(img, "Item", (140, y + 140), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 120, 120), 1, cv2.LINE_AA)
    # The text box and what is typed into it.
    x0, y0, x1, y1 = TYPE_BOX
    cv2.rectangle(img, (x0, y0), (x1, y1), (255, 255, 255), -1)
    cv2.rectangle(img, (x0, y0), (x1, y1), (180, 180, 180), 1)
    if t >= TYPE_START:
        chars = int(min(len(TYPED), (t - TYPE_START) / (TYPE_END - TYPE_START) * len(TYPED)))
        text = TYPED[:chars]
        cv2.putText(img, text[:26], (x0 + 12, y0 + 32), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1, cv2.LINE_AA)
        cv2.putText(img, text[26:], (x0 + 12, y0 + 62), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (30, 30, 30), 1, cv2.LINE_AA)
    # A menu opening (items appear one by one) in the lower right.
    if MENU_START <= t < MENU_END:
        mx0, my0, mx1, my1 = MENU_BOX
        shown = int(min(5, (t - MENU_START) / 0.6 + 1))
        cv2.rectangle(img, (mx0, my0), (mx1, my0 + shown * 34), (255, 250, 240), -1)
        for k in range(shown):
            cv2.putText(img, f"Option {k + 1}", (mx0 + 14, my0 + 24 + k * 34), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 1, cv2.LINE_AA)
    # A webcam-like spot: changes every frame.
    cx0, cy0, cx1, cy1 = CAM_BOX
    img[cy0:cy1, cx0:cx1] = (90, 110, 140)
    bob = int(10 * np.sin(n / 3.0))
    cv2.circle(img, ((cx0 + cx1) // 2 + bob, (cy0 + cy1) // 2 - bob // 2), 40, (170, 190, 230), -1)
    cv2.ellipse(img, ((cx0 + cx1) // 2 + bob, (cy0 + cy1) // 2 + 20), (16, 6 + abs(bob) // 2), 0, 0, 360, (60, 60, 120), -1)
    # The cursor: glides to the box, then sits by the typing, then goes to the menu.
    if t < TYPE_START:
        px, py = 1000 - (1000 - 300) * t / TYPE_START, 600 - (600 - 240) * t / TYPE_START
    elif t < MENU_START:
        px, py = 300, 240
    else:
        p = min(1.0, (t - MENU_START) / 0.8)
        px, py = 300 + (MENU_BOX[0] + 40 - 300) * p, 240 + (MENU_BOX[1] + 10 - 240) * p
    pts = np.array([[px, py], [px, py + 18], [px + 5, py + 13], [px + 12, py + 13]], np.int32)
    cv2.fillPoly(img, [pts], (0, 0, 0))
    return img


def write_fake_desktop(out: str, seconds: float = SECONDS) -> str:
    """The synthetic screen recording as an H.264 MP4 (no sound)."""
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for n in range(int(seconds * FPS)):
            proc.stdin.write(frame_at(n).tobytes())
    finally:
        proc.stdin.close()
        proc.wait()
    if proc.returncode:
        raise RuntimeError("could not write the fake desktop")
    return out
