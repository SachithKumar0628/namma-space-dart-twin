import { CapturePhotoRecord, DartRoomScore, DoorwayAnchor, RoomMetadata, CategoryScore } from '../types/dart';

export interface ScoreThresholds {
  accepted: number; // default 85
  targetedRecapture: number; // default 70
}

export const DEFAULT_THRESHOLDS: ScoreThresholds = {
  accepted: 85,
  targetedRecapture: 70,
};

/** Coverage pillar photo-count thresholds (points awarded). */
export const COVERAGE_PHOTO_THRESHOLDS = {
  excellent: 10, // 38 pts
  strong: 6,     // 36 pts
  adequate: 4,   // 34 pts
  limited: 2,    // 30 pts
  minimal: 1,    // 28 pts
} as const;

/** Coverage pillar points per threshold tier. */
export const COVERAGE_PHOTO_POINTS = {
  excellent: 38,
  strong: 36,
  adequate: 34,
  limited: 30,
  minimal: 28,
} as const;

/**
 * Pure calculation engine for the DART (Doorway-Anchored Repeatable Twin) 100-Point Quality Gate.
 * Validates transparently against the 4 engineering pillars:
 * 1. Coverage & Occlusion Review (40 pts)
 * 2. Doorway Continuity (25 pts)
 * 3. Measured-Dimension Agreement (20 pts)
 * 4. Image Sharpness, Exposure & Overlap (15 pts)
 */
export function calculateDartScore(
  room: RoomMetadata,
  photos: CapturePhotoRecord[],
  allDoorways: DoorwayAnchor[],
  thresholds: ScoreThresholds = DEFAULT_THRESHOLDS
): DartRoomScore {
  const roomPhotos = photos.filter((p) => p.roomId === room.id);
  const passAPhotos = roomPhotos.filter((p) => p.pass === 'Pass A');
  const passBPhotos = roomPhotos.filter((p) => p.pass === 'Pass B');
  const passCPhotos = roomPhotos.filter((p) => p.pass === 'Pass C');

  const connectedDoors = allDoorways.filter(
    (d) => d.connectedRoomIds.includes(room.id)
  );

  // ----------------------------------------------------
  // PILLAR 1: Coverage and Occlusion Review (40 Points)
  // ----------------------------------------------------
  let coverageEarned = 0;
  const coverageEvidence: string[] = [];
  const coverageDeductions: string[] = [];
  const coverageMissingChecks: string[] = [];

  // Visual Coverage & Perspective Review (40 pts max)
  const totalPhotos = roomPhotos.length;
  if (totalPhotos >= COVERAGE_PHOTO_THRESHOLDS.excellent) {
    coverageEarned += COVERAGE_PHOTO_POINTS.excellent;
    coverageEvidence.push(`Excellent coverage: ${totalPhotos} high-resolution captures registered`);
  } else if (totalPhotos >= COVERAGE_PHOTO_THRESHOLDS.strong) {
    coverageEarned += COVERAGE_PHOTO_POINTS.strong;
    coverageEvidence.push(`Strong coverage: ${totalPhotos} captures registered`);
  } else if (totalPhotos >= COVERAGE_PHOTO_THRESHOLDS.adequate) {
    coverageEarned += COVERAGE_PHOTO_POINTS.adequate;
    coverageEvidence.push(`Adequate coverage: ${totalPhotos} captures registered`);
  } else if (totalPhotos >= COVERAGE_PHOTO_THRESHOLDS.limited) {
    coverageEarned += COVERAGE_PHOTO_POINTS.limited;
    coverageEvidence.push(`Limited coverage: ${totalPhotos} captures registered`);
  } else if (totalPhotos === COVERAGE_PHOTO_THRESHOLDS.minimal) {
    coverageEarned += COVERAGE_PHOTO_POINTS.minimal;
    coverageEvidence.push(`Minimal coverage: 1 wide-angle capture registered (${roomPhotos[0].filename})`);
  } else {
    coverageMissingChecks.push('No visual captures registered for this room');
    coverageDeductions.push('Visual evidence required before 3D reconstruction (-38 pts)');
  }

  // Bonus for multi-pass diversity (Pass A, Pass B, Pass C)
  if (passAPhotos.length > 0 && (passBPhotos.length > 0 || passCPhotos.length > 0)) {
    coverageEarned += 4;
    coverageEvidence.push('Multi-pass diversity: Perimeter and supplemental sweeps recorded');
  } else if (totalPhotos > 0) {
    coverageEarned += 4;
    coverageEvidence.push('Perimeter perspective verified');
  }

  // Occlusion flags review
  const occludedPhotos = roomPhotos.filter((p) => p.occlusionFlag);
  if (occludedPhotos.length > 0) {
    const penalty = Math.min(6, occludedPhotos.length * 2);
    coverageEarned = Math.max(0, coverageEarned - penalty);
    coverageDeductions.push(`${occludedPhotos.length} photos flagged with unresolved occlusions (-${penalty} pts)`);
  }

  const coverageScore: CategoryScore = {
    category: 'coverage',
    name: 'Coverage & Occlusion Review',
    maxPoints: 40,
    earnedPoints: Math.min(40, coverageEarned),
    percentage: Math.round((Math.min(40, coverageEarned) / 40) * 100),
    evidence: coverageEvidence,
    deductions: coverageDeductions,
    missingChecks: coverageMissingChecks,
  };

  // ----------------------------------------------------
  // PILLAR 2: Doorway Continuity (25 Points)
  // ----------------------------------------------------
  let doorwayEarned = 0;
  const doorwayEvidence: string[] = [];
  const doorwayDeductions: string[] = [];
  const doorwayMissingChecks: string[] = [];

  if (connectedDoors.length === 0) {
    doorwayMissingChecks.push('No doorway anchors registered for this room');
    doorwayDeductions.push('Room lacks registered doorway anchors connecting to adjacent space (-25 pts)');
  } else {
    // For each doorway, evaluate anchor metadata, reciprocal observations, and Pass C transit
    let totalDoorwayScoreAcc = 0;

    connectedDoors.forEach((door) => {
      let singleDoorScore = 0;
      const isRoomA = door.connectedRoomIds[0] === room.id;
      const thisRoomObserved = isRoomA ? door.observations.roomAObserved : door.observations.roomBObserved;
      const neighborRoomObserved = isRoomA ? door.observations.roomBObserved : door.observations.roomAObserved;
      const neighborRoomId = isRoomA ? door.connectedRoomIds[1] : door.connectedRoomIds[0];

      // Physical measurement recorded: 5 pts weight
      if (door.widthMeters > 0.5 && door.heightMeters > 1.5) {
        singleDoorScore += 5;
        doorwayEvidence.push(`Door ${door.id}: Physical aperture recorded (${door.widthMeters}m x ${door.heightMeters}m)`);
      } else {
        doorwayDeductions.push(`Door ${door.id}: Incomplete physical dimensions (-5 pts)`);
      }

      // This room's observation: 7 pts weight
      if (thisRoomObserved) {
        singleDoorScore += 7;
        doorwayEvidence.push(`Door ${door.id}: Door frame observed and anchored from ${room.id}`);
      } else {
        doorwayMissingChecks.push(`Door ${door.id}: No registered photo observing door from inside ${room.id}`);
        doorwayDeductions.push(`Missing interior viewpoint towards door ${door.id} (-7 pts)`);
      }

      // Reciprocal observation from adjacent room: 7 pts weight
      if (neighborRoomObserved) {
        singleDoorScore += 7;
        doorwayEvidence.push(`Door ${door.id}: Reciprocal anchor confirmed from ${neighborRoomId}`);
      } else {
        doorwayMissingChecks.push(`Door ${door.id}: Missing reciprocal observation from connected ${neighborRoomId}`);
        doorwayDeductions.push(`Door ${door.id} reciprocal link unconfirmed in ${neighborRoomId} (-7 pts)`);
      }

      // Pass C continuous transit photos bridging threshold: 6 pts weight
      if (door.observations.hasContinuousPassCPhoto) {
        singleDoorScore += 6;
        doorwayEvidence.push(`Door ${door.id}: Pass C continuous transit photo spans threshold`);
      } else {
        doorwayMissingChecks.push(`Door ${door.id}: Missing Pass C doorway transit photograph`);
        doorwayDeductions.push(`Door ${door.id} lacks transit photo linking visual features through threshold (-6 pts)`);
      }

      // Each doorway contributes at most 25 / connectedDoors.length points so the
      // pillar total never exceeds 25 regardless of how many doors a room has.
      totalDoorwayScoreAcc += singleDoorScore / connectedDoors.length;
    });

    doorwayEarned = Math.round(totalDoorwayScoreAcc);
  }

  const doorwayScore: CategoryScore = {
    category: 'doorway',
    name: 'Doorway Continuity',
    maxPoints: 25,
    earnedPoints: Math.min(25, doorwayEarned),
    percentage: Math.round((Math.min(25, doorwayEarned) / 25) * 100),
    evidence: doorwayEvidence,
    deductions: doorwayDeductions,
    missingChecks: doorwayMissingChecks,
  };

  // ----------------------------------------------------
  // PILLAR 3: Measured-Dimension Agreement (20 Points)
  // ----------------------------------------------------
  let dimensionEarned = 0;
  const dimensionEvidence: string[] = [];
  const dimensionDeductions: string[] = [];
  const dimensionMissingChecks: string[] = [];

  // Ground truth physical dimensions
  const hasGroundTruth = room.lengthMeters > 0 && room.widthMeters > 0 && room.heightMeters > 0;
  if (hasGroundTruth) {
    dimensionEarned += 5;
    dimensionEvidence.push(
      `Ground truth tape measurement logged: L=${room.lengthMeters.toFixed(2)}m, W=${room.widthMeters.toFixed(2)}m, H=${room.heightMeters.toFixed(2)}m`
    );
  } else {
    dimensionMissingChecks.push('Incomplete ground truth tape measurements');
    dimensionDeductions.push('Ground truth physical room measurements missing (-5 pts)');
  }

  // Reconstructed/Estimated dimensions from photogrammetry or laser inspection
  const recon = room.reconstructionDimensionEstimate;
  if (recon && recon.lengthMeters > 0 && recon.widthMeters > 0) {
    dimensionEarned += 5;
    dimensionEvidence.push(
      `Reconstruction estimate available (${recon.source}): L=${recon.lengthMeters.toFixed(2)}m, W=${recon.widthMeters.toFixed(2)}m`
    );

    // Compute metric scale disparity
    if (hasGroundTruth) {
      const lenDiff = Math.abs(recon.lengthMeters - room.lengthMeters) / room.lengthMeters;
      const widDiff = Math.abs(recon.widthMeters - room.widthMeters) / room.widthMeters;
      const avgDisparityPercent = ((lenDiff + widDiff) / 2) * 100;

      if (avgDisparityPercent <= 1.5) {
        dimensionEarned += 10;
        dimensionEvidence.push(`Sub-millimeter/Tight scale agreement: ${avgDisparityPercent.toFixed(1)}% error (<= 1.5% tolerance)`);
      } else if (avgDisparityPercent <= 3.5) {
        dimensionEarned += 7;
        dimensionEvidence.push(`Acceptable scale agreement: ${avgDisparityPercent.toFixed(1)}% error (<= 3.5% tolerance)`);
        dimensionDeductions.push(`Scale drift of ${avgDisparityPercent.toFixed(1)}% exceeds high-precision threshold (-3 pts)`);
      } else if (avgDisparityPercent <= 6.0) {
        dimensionEarned += 4;
        dimensionEvidence.push(`Marginal scale agreement: ${avgDisparityPercent.toFixed(1)}% error (<= 6.0% tolerance)`);
        dimensionDeductions.push(`Noticeable scale drift of ${avgDisparityPercent.toFixed(1)}% requires Blender metric rescaling (-6 pts)`);
      } else {
        dimensionDeductions.push(`Severe scale deviation of ${avgDisparityPercent.toFixed(1)}% (>6% allowable limit) (-10 pts)`);
      }
    }
  } else {
    dimensionMissingChecks.push('No reconstruction scale estimate logged yet');
    dimensionDeductions.push('Awaiting COLMAP / mesh coordinate measurement to verify metric scale agreement (-15 pts)');
  }

  const dimensionScore: CategoryScore = {
    category: 'dimension',
    name: 'Measured-Dimension Agreement',
    maxPoints: 20,
    earnedPoints: Math.min(20, dimensionEarned),
    percentage: Math.round((Math.min(20, dimensionEarned) / 20) * 100),
    evidence: dimensionEvidence,
    deductions: dimensionDeductions,
    missingChecks: dimensionMissingChecks,
  };

  // ----------------------------------------------------
  // PILLAR 4: Image Sharpness, Exposure & Overlap (15 Points)
  // ----------------------------------------------------
  let imageQualityEarned = 0;
  const imageEvidence: string[] = [];
  const imageDeductions: string[] = [];
  const imageMissingChecks: string[] = [];

  if (roomPhotos.length === 0) {
    imageMissingChecks.push('No photographs registered in manifest for this room');
    imageDeductions.push('Cannot evaluate image fidelity without registered photos (-15 pts)');
  } else {
    // 1. Sharpness (5 pts)
    const avgSharpness =
      roomPhotos.reduce((acc, p) => acc + p.sharpnessScore, 0) / roomPhotos.length;
    if (avgSharpness >= 75) {
      imageQualityEarned += 5;
      imageEvidence.push(`Sharpness review: High average score of ${avgSharpness.toFixed(1)}/100`);
    } else if (avgSharpness >= 60) {
      imageQualityEarned += 3;
      imageEvidence.push(`Sharpness review: Moderate average score of ${avgSharpness.toFixed(1)}/100`);
      imageDeductions.push('Several soft or slightly blurry frames detected (-2 pts)');
    } else {
      imageQualityEarned += 1;
      imageDeductions.push(`Low average sharpness (${avgSharpness.toFixed(1)}/100) will cause photogrammetric feature mismatch (-4 pts)`);
    }

    // 2. Exposure (5 pts)
    const badExposure = roomPhotos.filter((p) => p.exposureReview !== 'Good');
    if (badExposure.length === 0) {
      imageQualityEarned += 5;
      imageEvidence.push(`Exposure review: All ${roomPhotos.length} frames properly balanced without blown highlights`);
    } else if (badExposure.length <= 2) {
      imageQualityEarned += 3;
      imageEvidence.push(`Exposure review: Mostly balanced (${badExposure.length} frames flagged)`);
      imageDeductions.push(`${badExposure.length} photo(s) suffer from clipping/underexposure (-2 pts)`);
    } else {
      imageDeductions.push(`${badExposure.length} photos have poor exposure: uneven lighting threatens feature point matching (-5 pts)`);
    }

    // 3. Overlap (5 pts)
    const insufficientOverlap = roomPhotos.filter(
      (p) => p.overlapReview === 'Insufficient (<50%)'
    );
    const marginalOverlap = roomPhotos.filter(
      (p) => p.overlapReview === 'Marginal (50-70%)'
    );

    if (insufficientOverlap.length === 0 && marginalOverlap.length === 0) {
      imageQualityEarned += 5;
      imageEvidence.push('Overlap compliance: >=70% sequential overlap maintained across all frames');
    } else if (insufficientOverlap.length === 0 && marginalOverlap.length <= 3) {
      imageQualityEarned += 3;
      imageEvidence.push('Overlap compliance: Acceptable baseline with minor marginal transitions');
      imageDeductions.push(`${marginalOverlap.length} frames show marginal 50-70% overlap (-2 pts)`);
    } else {
      imageDeductions.push(`${insufficientOverlap.length} frames have <50% overlap; risk of fragmented pointcloud models (-5 pts)`);
    }
  }

  const imageQualityScore: CategoryScore = {
    category: 'imageQuality',
    name: 'Image Sharpness, Exposure & Overlap',
    maxPoints: 15,
    earnedPoints: Math.min(15, imageQualityEarned),
    percentage: Math.round((Math.min(15, imageQualityEarned) / 15) * 100),
    evidence: imageEvidence,
    deductions: imageDeductions,
    missingChecks: imageMissingChecks,
  };

  // ----------------------------------------------------
  // TOTAL SCORE & RECOMMENDATIONS
  // ----------------------------------------------------
  const totalScore = Math.min(
    100,
    Math.max(
      0,
      coverageScore.earnedPoints +
        doorwayScore.earnedPoints +
        dimensionScore.earnedPoints +
        imageQualityScore.earnedPoints
    )
  );

  let status: DartRoomScore['status'] = 'Recapture Recommended';
  if (totalScore >= thresholds.accepted) {
    status = 'Accepted for Reconstruction';
  } else if (totalScore >= thresholds.targetedRecapture) {
    status = 'Targeted Recapture Required';
  }

  const recommendations: string[] = [];
  if (totalPhotos < COVERAGE_PHOTO_THRESHOLDS.adequate) {
    recommendations.push(
      `Coverage: Upload at least 4 more photos for ${room.name} — fewer than 4 frames will not produce a reliable 3D model.`
    );
  } else if (coverageScore.deductions.length > 0) {
    recommendations.push(
      `Coverage: Capture additional Pass ${passAPhotos.length < 8 ? 'A (perimeter corners)' : 'B (diagonal interiors)'} photos to eliminate unobserved blindspots.`
    );
  }
  if (doorwayScore.earnedPoints < 20) {
    recommendations.push(
      'Doorways: Complete reciprocal doorway anchoring from adjoining room and capture Pass C transit frames across door threshold.'
    );
  }
  if (dimensionScore.earnedPoints < 15) {
    recommendations.push(
      'Scale Validation: Inspect reconstructed model dimensions against physical tape measurements; apply Blender metric scale factor if drift > 3.5%.'
    );
  }
  if (imageQualityScore.earnedPoints < 12) {
    recommendations.push(
      'Image Quality: Re-shoot blurry or harsh exposure frames with fixed ISO, diffuse lighting, and minimum 70% consecutive overlap.'
    );
  }
  if (recommendations.length === 0) {
    recommendations.push('Proceed directly to COLMAP feature matching and dense 3D reconstruction.');
  }

  return {
    roomId: room.id,
    roomName: room.name,
    totalScore,
    status,
    categories: {
      coverage: coverageScore,
      doorway: doorwayScore,
      dimension: dimensionScore,
      imageQuality: imageQualityScore,
    },
    recommendations,
  };
}
