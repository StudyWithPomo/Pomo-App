import cv2
import numpy as np
import pytest

from pomo.vision import MODEL_3D, eye_aspect_ratio, head_pose

W, H = 640, 480
CAM = np.array([[W, 0, W / 2], [0, W, H / 2], [0, 0, 1]], dtype=np.float64)


def project(yaw_deg, pitch_deg):
    y, p = np.radians(yaw_deg), np.radians(pitch_deg)
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rx = np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])
    rvec, _ = cv2.Rodrigues(ry @ rx)
    tvec = np.array([0.0, 0.0, 1500.0])
    pts, _ = cv2.projectPoints(MODEL_3D, rvec, tvec, CAM, None)
    return pts.reshape(-1, 2)


def test_frontal_face_is_near_zero():
    yaw, pitch = head_pose(project(0, 0), W, H)
    assert abs(yaw) < 2 and abs(pitch) < 2


@pytest.mark.parametrize("yaw,pitch", [(25, 0), (-25, 0), (0, 15), (0, -15), (20, 10)])
def test_recovers_known_angles(yaw, pitch):
    est_yaw, est_pitch = head_pose(project(yaw, pitch), W, H)
    assert abs(est_yaw - yaw) < 3
    assert abs(est_pitch - pitch) < 3


def test_eye_aspect_ratio():
    open_eye = np.array([(0, 0), (1, 1), (2, 1), (3, 0), (2, -1), (1, -1)], dtype=float)
    closed_eye = open_eye.copy()
    closed_eye[:, 1] = 0.0
    assert eye_aspect_ratio(open_eye) == pytest.approx(4 / 6)
    assert eye_aspect_ratio(closed_eye) == pytest.approx(0.0)
