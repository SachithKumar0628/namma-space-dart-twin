# NammaTwin: LoopAnchor Studio — Privacy-Safe Benchmark Test Dataset
**Competition**: Namma Space, Techfest 2026–27, IIT Bombay — Round 1

---

## Purpose
This directory contains a calibrated, privacy-safe benchmark dataset representing two adjoining indoor spaces connected by a shared doorway anchor. It allows automated testing of the full DART-Twin pipeline without requiring private residential photographs in the public repository.

## Contents
1. `room_plan.json`:
   - Room `R01`: Robotics Assembly Bay ($6.20\text{m} \times 4.50\text{m} \times 2.85\text{m}$)
   - Room `R02`: Operations & Telemetry ($5.40\text{m} \times 4.20\text{m} \times 2.85\text{m}$)
   - Doorway `D01`: Inter-bay aperture ($1.05\text{m} \times 2.15\text{m}$)
   - Coordinate Origin: South-West floor corner at primary column $(0, 0, 0)$

2. `manifest.csv`:
   - 25 photo records logged across Pass A (Perimeter), Pass B (Diagonal), and Pass C (Doorway Continuity Transit).
   - Columns: `id,filename,roomId,pass,cameraPoseTag,focalLengthMm,sharpnessScore,exposureReview,overlapReview,occlusionFlag,doorwayAnchorId,reviewerNotes,timestamp,isAutomatedMetric`.

## Verification Commands
```bash
# 1. Run Python validator on this sample data:
python3 pipeline/test_validator.py

# 2. Run TypeScript scoring tests on this sample data:
npx tsx --test src/utils/dartScoring.test.ts
```
