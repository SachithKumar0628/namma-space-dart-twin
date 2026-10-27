#!/usr/bin/env python3
"""
Unit tests for DART-Twin Python Capture Manifest & Quality Score Validator
"""

import os
import sys
import unittest

# Ensure pipeline directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dart_validator import compute_dart_score, validate_dataset

class TestDartValidator(unittest.TestCase):
    def setUp(self):
        self.sample_room = {
            "id": "R01",
            "name": "Robotics Assembly Bay",
            "lengthMeters": 6.20,
            "widthMeters": 4.50,
            "heightMeters": 2.85,
            "reconstructionDimensionEstimate": {
                "lengthMeters": 6.24,
                "widthMeters": 4.47,
                "heightMeters": 2.84,
            }
        }
        self.sample_doorway = {
            "id": "D01",
            "connectedRoomIds": ["R01", "R02"],
            "widthMeters": 1.05,
            "heightMeters": 2.15,
            "observations": {
                "roomAObserved": True,
                "roomBObserved": True,
                "hasContinuousPassCPhoto": True
            }
        }
        # 8 Pass A, 4 Pass B, 2 Pass C
        self.sample_photos = []
        for i in range(8):
            self.sample_photos.append({
                "id": f"PA_{i}",
                "filename": f"R01_PassA_{i:03d}.jpg",
                "roomId": "R01",
                "pass": "Pass A",
                "sharpnessScore": 90,
                "exposureReview": "Good",
                "overlapReview": "Sufficient (>70%)",
                "occlusionFlag": False
            })
        for i in range(4):
            self.sample_photos.append({
                "id": f"PB_{i}",
                "filename": f"R01_PassB_{i:03d}.jpg",
                "roomId": "R01",
                "pass": "Pass B",
                "sharpnessScore": 88,
                "exposureReview": "Good",
                "overlapReview": "Sufficient (>70%)",
                "occlusionFlag": False
            })
        for i in range(2):
            self.sample_photos.append({
                "id": f"PC_{i}",
                "filename": f"R01_PassC_{i:03d}.jpg",
                "roomId": "R01",
                "pass": "Pass C",
                "sharpnessScore": 92,
                "exposureReview": "Good",
                "overlapReview": "Sufficient (>70%)",
                "occlusionFlag": False
            })

    def test_complete_room_score_accepted(self):
        result = compute_dart_score(self.sample_room, self.sample_photos, [self.sample_doorway])
        self.assertEqual(result["roomId"], "R01")
        self.assertGreaterEqual(result["totalScore"], 85)
        self.assertEqual(result["status"], "Accepted for Reconstruction")

    def test_missing_doorway_penalty(self):
        result = compute_dart_score(self.sample_room, self.sample_photos, [])
        self.assertEqual(result["categories"]["doorway"]["score"], 0)
        self.assertLess(result["totalScore"], 85)

    def test_dataset_validation_detects_broken_room_link(self):
        rooms = [self.sample_room] # missing R02
        doorways = [self.sample_doorway] # references R01 and R02
        is_valid, errors = validate_dataset(rooms, doorways, self.sample_photos)
        self.assertFalse(is_valid)
        self.assertTrue(any("non-existent Room 'R02'" in e for e in errors))

    def test_dataset_validation_detects_duplicate_room(self):
        rooms = [self.sample_room, self.sample_room]
        is_valid, errors = validate_dataset(rooms, [], self.sample_photos)
        self.assertFalse(is_valid)
        self.assertTrue(any("Duplicate Room ID" in e for e in errors))

if __name__ == "__main__":
    unittest.main()
