"""Face landmarks -> head pose, eye aspect ratio, face size/position."""
from __future__ import annotations

import cv2
import numpy as np

from .signals import FaceOverlay, NO_FACE, VisionSignals

# MediaPipe FaceMesh landmark indices.
POSE_IDX = (1, 152, 33, 263, 61, 291)  # nose, chin, eye corners, mouth corners
LEFT_EYE = (33, 160, 158, 133, 153, 144)    # p1..p6
RIGHT_EYE = (362, 385, 387, 263, 373, 380)  # p1..p6

# Generic 3D face model in camera axes (x right, y down, z away from camera),
# nose tip at the origin. A frontal face therefore gives ~identity rotation.
# Order matches POSE_IDX: image-left eye corner (33), image-right (263), etc.
MODEL_3D = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, 330.0, 65.0),
        (-225.0, -170.0, 135.0),
        (225.0, -170.0, 135.0),
        (-150.0, 150.0, 125.0),
        (150.0, 150.0, 125.0),
    ],
    dtype=np.float64,
)


def _wrap(angle: float) -> float:
    return (angle + 180.0) % 360.0 - 180.0


def head_pose(points_px: np.ndarray, width: int, height: int) -> tuple[float, float] | None:
    """Return (yaw_deg, pitch_deg) from the 6 POSE_IDX points in pixel coords."""
    focal = float(width)
    cam = np.array([[focal, 0, width / 2], [0, focal, height / 2], [0, 0, 1]], dtype=np.float64)
    ok, rvec, _ = cv2.solvePnP(
        MODEL_3D, points_px.astype(np.float64), cam, None, flags=cv2.SOLVEPNP_ITERATIVE
    )
    if not ok:
        return None
    rot, _ = cv2.Rodrigues(rvec)
    angles = cv2.RQDecomp3x3(rot)[0]  # degrees about x, y, z
    return _wrap(float(angles[1])), _wrap(float(angles[0]))


def eye_aspect_ratio(p: np.ndarray) -> float:
    """p is 6x2, ordered p1..p6 around the eye."""
    v1 = np.linalg.norm(p[1] - p[5])
    v2 = np.linalg.norm(p[2] - p[4])
    h = np.linalg.norm(p[0] - p[3])
    return float((v1 + v2) / (2.0 * h)) if h > 0 else 0.0


class FaceTracker:
    def __init__(self) -> None:
        import mediapipe as mp  # imported here so the helpers above are testable without it

        self._mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )

    def __enter__(self) -> "FaceTracker":
        return self

    def __exit__(self, *exc) -> None:
        self._mesh.close()

    def process(self, frame_bgr: np.ndarray) -> VisionSignals:
        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        result = self._mesh.process(rgb)
        if not result.multi_face_landmarks:
            return NO_FACE

        lm = result.multi_face_landmarks[0].landmark
        pts = np.array([(p.x * w, p.y * h) for p in lm], dtype=np.float64)

        pose = head_pose(pts[list(POSE_IDX)], w, h)
        yaw, pitch = pose if pose is not None else (0.0, 0.0)
        ear = (eye_aspect_ratio(pts[list(LEFT_EYE)]) + eye_aspect_ratio(pts[list(RIGHT_EYE)])) / 2.0

        y_min, y_max = float(pts[:, 1].min()), float(pts[:, 1].max())

        # Build the face overlay (pixel coords) for the preview.
        bbox = (
            int(float(pts[:, 0].min())),
            int(float(pts[:, 1].min())),
            int(float(pts[:, 0].max())),
            int(float(pts[:, 1].max())),
        )
        nose = (int(pts[1, 0]), int(pts[1, 1]))
        left_eye = tuple((int(x), int(y)) for x, y in pts[list(LEFT_EYE)])
        right_eye = tuple((int(x), int(y)) for x, y in pts[list(RIGHT_EYE)])
        overlay = FaceOverlay(bbox=bbox, nose=nose, left_eye=left_eye, right_eye=right_eye)

        return VisionSignals(
            face_present=True,
            yaw_deg=yaw,
            pitch_deg=pitch,
            ear=ear,
            face_size=(y_max - y_min) / h,
            face_y=((y_max + y_min) / 2.0) / h,
            overlay=overlay,
        )
