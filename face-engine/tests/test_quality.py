from types import SimpleNamespace

import numpy as np

from app.core.quality import check_frame_quality


def make_test_image() -> np.ndarray:
    checkerboard = np.indices((400, 400)).sum(axis=0) % 2
    grayscale = (checkerboard * 255).astype(np.uint8)

    return np.repeat(grayscale[:, :, np.newaxis], 3, axis=2)


def make_face(yaw: float) -> SimpleNamespace:
    return SimpleNamespace(
        bbox=np.asarray([100, 100, 300, 300]),
        pose=np.asarray([0.0, yaw, 0.0]),
    )


def test_front_pose_rejects_a_side_facing_photo() -> None:
    is_valid, code, _, _ = check_frame_quality(
        make_test_image(),
        make_face(30.0),
        expected_pose="front",
    )

    assert is_valid is False
    assert code == "POSE_INVALID"


def test_left_pose_accepts_a_matching_side_facing_photo() -> None:
    is_valid, code, _, _ = check_frame_quality(
        make_test_image(),
        make_face(25.0),
        expected_pose="slight_left",
    )

    assert is_valid is True
    assert code == "OK"


def test_right_pose_accepts_a_matching_side_facing_photo() -> None:
    is_valid, code, _, _ = check_frame_quality(
        make_test_image(),
        make_face(-25.0),
        expected_pose="slight_right",
    )

    assert is_valid is True
    assert code == "OK"


def test_side_pose_rejects_the_wrong_direction() -> None:
    is_valid, code, message, _ = check_frame_quality(
        make_test_image(),
        make_face(-25.0),
        expected_pose="slight_left",
    )

    assert is_valid is False
    assert code == "POSE_INVALID"
    assert "kiri" in message.lower()
