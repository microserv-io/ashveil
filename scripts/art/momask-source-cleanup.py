import argparse
import json
import os
from pathlib import Path

import numpy as np

import visualization.Animation as Animation
import visualization.BVH_mod as BVH
from visualization.joints2bvh import Joint2BVHConvertor


LEFT_LEG = (1, 4, 7, 10)
RIGHT_LEG = (2, 5, 8, 11)


def rotate_to_positive_z(positions: np.ndarray) -> tuple[np.ndarray, float, np.ndarray]:
    displacement = positions[-1, 0, [0, 2]] - positions[0, 0, [0, 2]]
    distance = np.linalg.norm(displacement)
    if distance < 0.1:
        return positions.copy(), 0.0, displacement
    heading = displacement / distance
    angle = np.arctan2(heading[0], heading[1])
    cosine = np.cos(-angle)
    sine = np.sin(-angle)
    rotation = np.array([[cosine, 0.0, sine], [0.0, 1.0, 0.0], [-sine, 0.0, cosine]])
    origin = positions[0, 0].copy()
    rotated = (positions - origin) @ rotation.T + origin
    return rotated, float(np.degrees(angle)), displacement


def make_in_place(positions: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    root_path = positions[:, 0, [0, 2]].copy()
    offset = root_path - root_path[0]
    result = positions.copy()
    result[:, :, 0] -= offset[:, None, 0]
    result[:, :, 2] -= offset[:, None, 1]
    return result, offset


def close_loop(positions: np.ndarray, blend_frames: int) -> np.ndarray:
    result = positions.copy()
    last = len(result) - 1
    seam = (result[0] + result[last]) * 0.5
    result[0] = seam
    result[last] = seam
    result[1] = seam
    result[last - 1] = seam
    for index in range(2, blend_frames + 1):
        phase = (index - 2) / max(blend_frames - 2, 1)
        weight = 0.5 * (1.0 + np.cos(np.pi * phase))
        symmetric_delta = (result[index] - result[last - index]) * 0.5
        early = seam + symmetric_delta
        late = seam - symmetric_delta
        result[index] = result[index] * (1.0 - weight) + early * weight
        result[last - index] = result[last - index] * (1.0 - weight) + late * weight
    return result


def contiguous_ranges(mask: np.ndarray) -> list[tuple[int, int]]:
    ranges = []
    start = None
    for index, enabled in enumerate(mask):
        if enabled and start is None:
            start = index
        elif not enabled and start is not None:
            ranges.append((start, index - 1))
            start = None
    if start is not None:
        ranges.append((start, len(mask) - 1))
    return ranges


def stabilize_contacts(
    positions: np.ndarray,
    reference_root_path: np.ndarray,
    leg: tuple[int, int, int, int],
    height_margin: float,
    maximum_speed: float,
) -> tuple[np.ndarray, list[dict[str, float | int]]]:
    hip, knee, ankle, toe = leg
    result = positions.copy()
    contact_height = np.minimum(result[:, ankle, 1], result[:, toe, 1])
    midpoint = (result[:, ankle][:, [0, 2]] + result[:, toe][:, [0, 2]]) * 0.5 + reference_root_path
    speed = np.linalg.norm(np.diff(midpoint, axis=0), axis=-1) / 0.05
    speed = np.append(speed, speed[-1])
    contact = (contact_height <= np.min(contact_height) + height_margin) & (speed <= maximum_speed)
    segments = [segment for segment in contiguous_ranges(contact) if segment[1] - segment[0] >= 1]
    evidence = []
    for start, end in segments:
        indices = np.arange(start, end + 1)
        world_midpoint = (result[indices, ankle][:, [0, 2]] + result[indices, toe][:, [0, 2]]) * 0.5
        world_midpoint += reference_root_path[indices]
        anchor = np.median(world_midpoint, axis=0)
        correction = anchor - world_midpoint
        result[indices, ankle, 0] += correction[:, 0]
        result[indices, ankle, 2] += correction[:, 1]
        result[indices, toe, 0] += correction[:, 0]
        result[indices, toe, 2] += correction[:, 1]
        result[indices, knee, 0] += correction[:, 0] * 0.35
        result[indices, knee, 2] += correction[:, 1] * 0.35
        result[indices, hip, 0] += correction[:, 0] * 0.1
        result[indices, hip, 2] += correction[:, 1] * 0.1
        evidence.append(
            {
                "startFrame": int(start),
                "endFrameInclusive": int(end),
                "maximumHorizontalCorrection": float(np.max(np.linalg.norm(correction, axis=-1))),
            }
        )
    return result, evidence


def detect_contacts(
    positions: np.ndarray,
    reference_root_path: np.ndarray,
    leg: tuple[int, int, int, int],
    height_margin: float,
    maximum_speed: float,
) -> list[dict[str, int]]:
    _hip, _knee, ankle, toe = leg
    height = np.minimum(positions[:, ankle, 1], positions[:, toe, 1])
    midpoint = (positions[:, ankle][:, [0, 2]] + positions[:, toe][:, [0, 2]]) * 0.5 + reference_root_path
    speed = np.linalg.norm(np.diff(midpoint, axis=0), axis=-1) / 0.05
    speed = np.append(speed, speed[-1])
    contact = (height <= np.min(height) + height_margin) & (speed <= maximum_speed)
    return [
        {"startFrame": start, "endFrameInclusive": end}
        for start, end in contiguous_ranges(contact)
        if end - start >= 1
    ]


def knee_plane_reference(positions: np.ndarray, leg: tuple[int, int, int, int]) -> np.ndarray:
    hip, knee, ankle, _toe = leg
    plane = np.cross(positions[:, knee] - positions[:, hip], positions[:, ankle] - positions[:, knee])
    plane /= np.maximum(np.linalg.norm(plane, axis=-1, keepdims=True), 1e-8)
    reference = np.median(plane, axis=0)
    return reference / max(np.linalg.norm(reference), 1e-8)


def enforce_knee_plane(
    positions: np.ndarray,
    leg: tuple[int, int, int, int],
    reference: np.ndarray,
) -> tuple[np.ndarray, list[int]]:
    hip, knee, ankle, _toe = leg
    result = positions.copy()
    corrected = []
    for frame in range(len(result)):
        plane = np.cross(result[frame, knee] - result[frame, hip], result[frame, ankle] - result[frame, knee])
        alignment = np.dot(plane, reference) / max(np.linalg.norm(plane), 1e-8)
        if alignment >= 0.35:
            continue
        axis = result[frame, ankle] - result[frame, hip]
        axis /= max(np.linalg.norm(axis), 1e-8)
        relative = result[frame, knee] - result[frame, hip]
        closest = result[frame, hip] + axis * np.dot(relative, axis)
        perpendicular_length = np.linalg.norm(result[frame, knee] - closest)
        desired = np.cross(axis, reference)
        desired /= max(np.linalg.norm(desired), 1e-8)
        result[frame, knee] = closest + desired * perpendicular_length
        corrected.append(frame)
    return result, corrected


def loop_metrics(positions: np.ndarray) -> dict[str, float]:
    root_relative = positions - positions[:, 0:1]
    value_error = np.linalg.norm(root_relative[-1] - root_relative[0], axis=-1)
    start_velocity = root_relative[1] - root_relative[0]
    end_velocity = root_relative[-1] - root_relative[-2]
    velocity_error = np.linalg.norm(start_velocity - end_velocity, axis=-1)
    return {
        "valueRms": float(np.sqrt(np.mean(value_error**2))),
        "valueMax": float(np.max(value_error)),
        "velocityRmsPerFrame": float(np.sqrt(np.mean(velocity_error**2))),
        "velocityMaxPerFrame": float(np.max(velocity_error)),
    }


def correlation(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.corrcoef(first, second)[0, 1])


def knee_plane_metrics(positions: np.ndarray, leg: tuple[int, int, int, int]) -> dict[str, float | int]:
    hip, knee, ankle, _toe = leg
    plane = np.cross(positions[:, knee] - positions[:, hip], positions[:, ankle] - positions[:, knee])
    margin = np.linalg.norm(plane, axis=-1)
    valid = margin > 0.015
    normalized = plane[valid] / margin[valid, None]
    reference = np.median(normalized, axis=0)
    reference /= max(np.linalg.norm(reference), 1e-8)
    dot = normalized @ reference
    deviation = np.degrees(np.arccos(np.clip(np.abs(dot), -1.0, 1.0)))
    return {
        "validFrames": int(np.sum(valid)),
        "signFlipFraction": float(np.mean(dot < 0)),
        "normalDeviationP95Degrees": float(np.quantile(deviation, 0.95)),
    }


def evaluate_bvh(
    path: Path,
    target: np.ndarray,
    root_path: np.ndarray,
    contacts: dict[str, list[dict[str, float | int]]],
) -> dict[str, object]:
    animation = BVH.load(str(path))
    template_positions = Animation.positions_global(animation)
    source_order = [0, 1, 5, 9, 2, 6, 10, 3, 7, 11, 4, 8, 12, 14, 18, 13, 15, 19, 16, 20, 17, 21]
    positions = template_positions[:, source_order]
    residual = np.linalg.norm(positions - target, axis=-1)
    root_relative = positions - positions[:, 0:1]
    left_swing = root_relative[:, 20, 2]
    right_swing = root_relative[:, 21, 2]
    world = positions.copy()
    world[:, :, 0] += root_path[:, None, 0]
    world[:, :, 2] += root_path[:, None, 1]
    contact_evidence = {}
    for side, leg in (("left", LEFT_LEG), ("right", RIGHT_LEG)):
        _hip, _knee, ankle, toe = leg
        midpoint = (world[:, ankle, [0, 2]] + world[:, toe, [0, 2]]) * 0.5
        speed = np.linalg.norm(np.diff(midpoint, axis=0), axis=-1) / 0.05
        contact_speeds = []
        for segment in contacts[side]:
            start = int(segment["startFrame"])
            end = int(segment["endFrameInclusive"])
            if end > start:
                contact_speeds.extend(speed[start:end])
        contact_speeds_array = np.asarray(contact_speeds)
        contact_evidence[side] = {
            "sampleCount": len(contact_speeds),
            "horizontalSpeedP95": float(np.quantile(contact_speeds_array, 0.95)) if len(contact_speeds) else None,
            "horizontalSpeedMax": float(np.max(contact_speeds_array)) if len(contact_speeds) else None,
            "minimumFootOrToeHeight": float(min(np.min(world[:, ankle, 1]), np.min(world[:, toe, 1]))),
        }
    return {
        "sourceFitP95": float(np.quantile(residual, 0.95)),
        "sourceFitMax": float(np.max(residual)),
        "loop": loop_metrics(positions),
        "reciprocalArmCorrelation": correlation(left_swing, right_swing),
        "kneePlane": {
            "left": knee_plane_metrics(positions, LEFT_LEG),
            "right": knee_plane_metrics(positions, RIGHT_LEG),
        },
        "contacts": contact_evidence,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--clip", choices=("idle", "walk", "sprint"), required=True)
    parser.add_argument("--momask-root", type=Path, required=True)
    arguments = parser.parse_args()

    input_path = arguments.input.resolve()
    output_directory = arguments.output_directory.resolve()
    momask_root = arguments.momask_root.resolve()
    if not (momask_root / "visualization/data/template.bvh").is_file():
        raise FileNotFoundError("MoMask template.bvh is missing from --momask-root")
    original = np.load(input_path)
    if len(original) % 2 != 1:
        raise ValueError("Source loop must contain an odd number of samples")
    rotated, heading_correction, original_displacement = rotate_to_positive_z(original)
    in_place, root_path = make_in_place(rotated)
    knee_references = {
        "left": knee_plane_reference(in_place, LEFT_LEG),
        "right": knee_plane_reference(in_place, RIGHT_LEG),
    }
    blend_frames = 10 if arguments.clip == "idle" else 6
    cleaned = close_loop(in_place, blend_frames)
    contact_margin = 0.045 if arguments.clip == "idle" else 0.04
    maximum_contact_speed = {"idle": 0.25, "walk": 0.55, "sprint": 0.85}[arguments.clip]
    stabilization_segments = {}
    for side, leg in (("left", LEFT_LEG), ("right", RIGHT_LEG)):
        cleaned, stabilization_segments[side] = stabilize_contacts(
            cleaned,
            root_path,
            leg,
            contact_margin,
            maximum_contact_speed,
        )
    cleaned = close_loop(cleaned, blend_frames)
    knee_corrections = {}
    for side, leg in (("left", LEFT_LEG), ("right", RIGHT_LEG)):
        cleaned, knee_corrections[side] = enforce_knee_plane(cleaned, leg, knee_references[side])
    foot_indices = [LEFT_LEG[2], LEFT_LEG[3], RIGHT_LEG[2], RIGHT_LEG[3]]
    minimum_foot_height = float(np.min(cleaned[:, foot_indices, 1]))
    if minimum_foot_height < 0:
        cleaned[:, :, 1] -= minimum_foot_height
    contact_schedule = {}
    final_contact_speed = {"idle": 0.2, "walk": 0.3, "sprint": 0.4}[arguments.clip]
    for side, leg in (("left", LEFT_LEG), ("right", RIGHT_LEG)):
        contact_schedule[side] = detect_contacts(
            cleaned,
            root_path,
            leg,
            contact_margin,
            final_contact_speed,
        )

    output_directory.mkdir(parents=True, exist_ok=True)
    np.save(output_directory / "game_loop_source_positions.npy", cleaned)
    os.chdir(momask_root)
    converter = Joint2BVHConvertor()
    converter.convert(
        cleaned,
        str(output_directory / "game_loop_basic_ik.bvh"),
        iterations=100,
        foot_ik=False,
    )
    bvh_metrics = evaluate_bvh(
        output_directory / "game_loop_basic_ik.bvh",
        cleaned,
        root_path,
        contact_schedule,
    )
    correction = np.linalg.norm(cleaned - in_place, axis=-1)
    report = {
        "clip": arguments.clip,
        "frames": len(cleaned),
        "fps": 20,
        "sampleSpanSeconds": (len(cleaned) - 1) / 20,
        "headingCorrectionDegrees": heading_correction,
        "validatedRootDisplacementXZ": original_displacement.tolist(),
        "referenceRootDistance": float(np.linalg.norm(original_displacement)),
        "referenceRootSpeed": float(np.linalg.norm(original_displacement) / ((len(cleaned) - 1) / 20)),
        "inPlaceRootHorizontalRange": np.ptp(cleaned[:, 0, [0, 2]], axis=0).tolist(),
        "loop": loop_metrics(cleaned),
        "stabilizationSegments": stabilization_segments,
        "contactSchedule": contact_schedule,
        "kneePlaneCorrectedFrames": knee_corrections,
        "verticalFloorOffset": max(0.0, -minimum_foot_height),
        "cleanupCorrectionMean": float(np.mean(correction)),
        "cleanupCorrectionP95": float(np.quantile(correction, 0.95)),
        "cleanupCorrectionMax": float(np.max(correction)),
        "bvh": bvh_metrics,
    }
    (output_directory / "game_loop_cleanup.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
