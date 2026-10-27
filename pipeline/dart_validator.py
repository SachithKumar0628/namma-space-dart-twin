#!/usr/bin/env python3
"""
DART-Twin: Doorway-Anchored Repeatable Twin
Capture Manifest & Quality Gate Validator (Python 3 Reference CLI)
Techfest 2026-27, IIT Bombay - Namma Space Round 1

Validates:
1. Room plan geometry and unique identifiers
2. Doorway anchors, dimensions, and reciprocal room observations
3. Manifest photo registration, passes (A/B/C), and quality metrics
4. Computes the 100-Point DART Quality Score
"""

import sys
import json
import csv
from typing import Dict, List, Any, Tuple

DEFAULT_PASS_A_MIN = 8
DEFAULT_PASS_B_MIN = 4
DEFAULT_PASS_C_MIN = 2

def compute_dart_score(room: Dict[str, Any], photos: List[Dict[str, Any]], doorways: List[Dict[str, Any]]) -> Dict[str, Any]:
    room_id = room.get("id")
    room_photos = [p for p in photos if p.get("roomId") == room_id]
    pass_a = [p for p in room_photos if p.get("pass") == "Pass A"]
    pass_b = [p for p in room_photos if p.get("pass") == "Pass B"]
    pass_c = [p for p in room_photos if p.get("pass") == "Pass C"]

    connected_doors = [d for d in doorways if room_id in d.get("connectedRoomIds", [])]

    # 1. Coverage & Occlusion (40 pts)
    coverage_score = 0
    coverage_deductions = []

    if len(pass_a) >= DEFAULT_PASS_A_MIN:
        coverage_score += 18
    elif len(pass_a) >= 4:
        coverage_score += int((len(pass_a) / DEFAULT_PASS_A_MIN) * 18)
        coverage_deductions.append(f"Pass A sparse ({len(pass_a)}/{DEFAULT_PASS_A_MIN})")
    else:
        coverage_deductions.append("Pass A structural perimeter incomplete (<4 photos)")

    if len(pass_b) >= DEFAULT_PASS_B_MIN:
        coverage_score += 14
    elif len(pass_b) >= 2:
        coverage_score += 8
        coverage_deductions.append(f"Pass B diagonal sweep marginal ({len(pass_b)}/{DEFAULT_PASS_B_MIN})")
    else:
        coverage_deductions.append("Pass B missing: High risk of occlusions")

    if len(pass_c) >= DEFAULT_PASS_C_MIN:
        coverage_score += 8
    elif len(pass_c) == 1:
        coverage_score += 4
        coverage_deductions.append("Pass C minimal: 1 photo logged")
    else:
        coverage_deductions.append("Pass C supplemental capture not recorded")

    occlusions = [p for p in room_photos if p.get("occlusionFlag") is True]
    if occlusions:
        penalty = min(6, len(occlusions) * 2)
        coverage_score = max(0, coverage_score - penalty)
        coverage_deductions.append(f"{len(occlusions)} unmitigated occlusions (-{penalty} pts)")

    coverage_score = min(40, coverage_score)

    # 2. Doorway Continuity (25 pts)
    doorway_score = 0
    doorway_deductions = []

    if not connected_doors:
        doorway_deductions.append("No doorway anchors registered for this room (-25 pts)")
    else:
        door_points = 0
        max_per_door = 25.0 / len(connected_doors)
        for door in connected_doors:
            sub = 0
            is_room_a = door.get("connectedRoomIds", [""])[0] == room_id
            obs = door.get("observations", {})
            this_obs = obs.get("roomAObserved") if is_room_a else obs.get("roomBObserved")
            recip_obs = obs.get("roomBObserved") if is_room_a else obs.get("roomAObserved")

            # Physical dims (5 pts weight)
            if door.get("widthMeters", 0) > 0.5 and door.get("heightMeters", 0) > 1.5:
                sub += 5
            else:
                doorway_deductions.append(f"Door {door.get('id')}: Incomplete physical dimensions")

            # This room observed (7 pts)
            if this_obs:
                sub += 7
            else:
                doorway_deductions.append(f"Door {door.get('id')}: Not observed from {room_id}")

            # Reciprocal observed (7 pts)
            if recip_obs:
                sub += 7
            else:
                doorway_deductions.append(f"Door {door.get('id')}: Missing reciprocal observation")

            # Continuous Pass C (6 pts)
            if obs.get("hasContinuousPassCPhoto"):
                sub += 6
            else:
                doorway_deductions.append(f"Door {door.get('id')}: Missing Pass C transit photo")

            door_points += sub * (max_per_door / 25.0)
        doorway_score = min(25, round(door_points))

    # 3. Measured Dimension Agreement (20 pts)
    dim_score = 0
    dim_deductions = []
    l = room.get("lengthMeters", 0)
    w = room.get("widthMeters", 0)
    h = room.get("heightMeters", 0)

    if l > 0 and w > 0 and h > 0:
        dim_score += 5
        recon = room.get("reconstructionDimensionEstimate")
        if recon and recon.get("lengthMeters", 0) > 0 and recon.get("widthMeters", 0) > 0:
            dim_score += 5
            rl = recon["lengthMeters"]
            rw = recon["widthMeters"]
            disparity = (((abs(rl - l) / l) + (abs(rw - w) / w)) / 2.0) * 100.0
            if disparity <= 1.5:
                dim_score += 10
            elif disparity <= 3.5:
                dim_score += 7
                dim_deductions.append(f"Scale drift {disparity:.1f}% exceeds 1.5% target (-3 pts)")
            elif disparity <= 6.0:
                dim_score += 4
                dim_deductions.append(f"Noticeable scale drift {disparity:.1f}% requires rescaling (-6 pts)")
            else:
                dim_deductions.append(f"Severe scale deviation {disparity:.1f}% (>6.0%) (-10 pts)")
        else:
            dim_deductions.append("Awaiting reconstructed dimension comparison (-15 pts)")
    else:
        dim_deductions.append("Ground truth dimensions missing (-20 pts)")

    dim_score = min(20, dim_score)

    # 4. Image Sharpness, Exposure & Overlap (15 pts)
    iq_score = 0
    iq_deductions = []

    if not room_photos:
        iq_deductions.append("No photographs registered in manifest (-15 pts)")
    else:
        # Sharpness (5 pts)
        sharp_vals = [p.get("sharpnessScore", 0) for p in room_photos]
        avg_sharp = sum(sharp_vals) / len(sharp_vals) if sharp_vals else 0
        if avg_sharp >= 75:
            iq_score += 5
        elif avg_sharp >= 60:
            iq_score += 3
            iq_deductions.append(f"Moderate average sharpness: {avg_sharp:.1f}/100")
        else:
            iq_score += 1
            iq_deductions.append(f"Low average sharpness: {avg_sharp:.1f}/100")

        # Exposure (5 pts)
        bad_exp = [p for p in room_photos if p.get("exposureReview") != "Good"]
        if not bad_exp:
            iq_score += 5
        elif len(bad_exp) <= 2:
            iq_score += 3
            iq_deductions.append(f"{len(bad_exp)} frame(s) with sub-optimal exposure")
        else:
            iq_deductions.append(f"{len(bad_exp)} frames with poor exposure (-5 pts)")

        # Overlap (5 pts)
        insufficient = [p for p in room_photos if p.get("overlapReview") == "Insufficient (<50%)"]
        marginal = [p for p in room_photos if p.get("overlapReview") == "Marginal (50-70%)"]
        if not insufficient and not marginal:
            iq_score += 5
        elif not insufficient and len(marginal) <= 3:
            iq_score += 3
            iq_deductions.append(f"{len(marginal)} frames with marginal 50-70% overlap")
        else:
            iq_deductions.append("Insufficient overlap (<50%) detected in sequence (-5 pts)")

    iq_score = min(15, iq_score)

    total = coverage_score + doorway_score + dim_score + iq_score
    status = "Recapture Recommended"
    if total >= 85:
        status = "Accepted for Reconstruction"
    elif total >= 70:
        status = "Targeted Recapture Required"

    return {
        "roomId": room_id,
        "roomName": room.get("name"),
        "totalScore": total,
        "status": status,
        "categories": {
            "coverage": {"score": coverage_score, "max": 40, "deductions": coverage_deductions},
            "doorway": {"score": doorway_score, "max": 25, "deductions": doorway_deductions},
            "dimension": {"score": dim_score, "max": 20, "deductions": dim_deductions},
            "imageQuality": {"score": iq_score, "max": 15, "deductions": iq_deductions},
        }
    }

def validate_dataset(rooms: List[Dict], doorways: List[Dict], photos: List[Dict]) -> Tuple[bool, List[str]]:
    errors = []
    room_ids = set()

    for r in rooms:
        rid = r.get("id")
        if not rid:
            errors.append("Error: Room entry missing 'id'")
        elif rid in room_ids:
            errors.append(f"Error: Duplicate Room ID '{rid}'")
        else:
            room_ids.add(rid)

        if r.get("lengthMeters", 0) <= 0 or r.get("widthMeters", 0) <= 0 or r.get("heightMeters", 0) <= 0:
            errors.append(f"Error: Room '{rid}' has invalid metric dimensions")

    doorway_ids = set()
    for d in doorways:
        did = d.get("id")
        if not did:
            errors.append("Error: Doorway entry missing 'id'")
        elif did in doorway_ids:
            errors.append(f"Error: Duplicate Doorway ID '{did}'")
        else:
            doorway_ids.add(did)

        c = d.get("connectedRoomIds", [])
        if len(c) != 2:
            errors.append(f"Error: Doorway '{did}' must connect exactly 2 rooms")
        else:
            if c[0] not in room_ids:
                errors.append(f"Error: Doorway '{did}' references non-existent Room '{c[0]}'")
            if c[1] not in room_ids:
                errors.append(f"Error: Doorway '{did}' references non-existent Room '{c[1]}'")
            if c[0] == c[1]:
                errors.append(f"Error: Doorway '{did}' connects room '{c[0]}' to itself")

    for p in photos:
        pid = p.get("filename") or p.get("id")
        rid = p.get("roomId")
        if rid not in room_ids:
            errors.append(f"Error: Photo '{pid}' references unknown Room ID '{rid}'")

    return len(errors) == 0, errors

if __name__ == "__main__":
    print("DART-Twin Capture Manifest Validator (Python 3)")
    print("Run `python3 pipeline/test_validator.py` to execute unit tests.")
