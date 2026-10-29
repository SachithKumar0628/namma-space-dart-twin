export type CapturePass = 'Pass A' | 'Pass B' | 'Pass C';

export interface DoorwayAnchor {
  id: string; // e.g., 'D01'
  projectId?: string; // Owning project (set when uploaded to a user project)
  name: string;
  connectedRoomIds: [string, string]; // [Room A, Room B]
  widthMeters: number;
  heightMeters: number;
  wallLocation: 'north' | 'south' | 'east' | 'west';
  offsetMeters: number; // offset along the wall from room origin
  hasClearLineOfSight: boolean;
  observations: {
    roomAObserved: boolean;
    roomBObserved: boolean;
    hasContinuousPassCPhoto: boolean;
    measuredWidthDiffMm?: number; // disparity in mm if measured twice
  };
}

export interface RoomMetadata {
  id: string; // e.g., 'R01'
  projectId?: string; // Owning project (set when uploaded to a user project)
  name: string;
  category: 'Laboratory' | 'Office' | 'Corridor' | 'Workshop' | 'Living' | 'Control Room' | 'Bedroom' | 'Kitchen' | 'Balcony' | 'Dining' | 'Entrance' | 'Bathroom';
  lengthMeters: number;
  widthMeters: number;
  heightMeters: number;
  originDescription: string;
  coordinateConvention: 'Right-Handed Y-Up (Three.js standard)' | 'Right-Handed Z-Up (Blender standard)';
  connectedDoorwayIds: string[];
  features: {
    doorsCount: number;
    windowsCount: number;
    reflectiveSurfaces: boolean;
    featurelessWhiteWalls: boolean;
  };
  reconstructionDimensionEstimate?: {
    lengthMeters: number;
    widthMeters: number;
    heightMeters: number;
    source: 'COLMAP Sparse Pointcloud' | 'Manual Inspection' | 'Blender Mesh';
  };
}

export type CaptureModality = 'Still Photograph' | 'Extracted Video Frame' | 'Sensor Augmented';

export interface SensorMetadata {
  pitchDeg?: number; // IMU pitch angle relative to horizon
  rollDeg?: number; // IMU roll angle
  yawDeg?: number; // Compass heading or relative azimuth
  luxLevel?: number; // Ambient light reading in lux
  rangefinderDistanceMeters?: number; // Laser distance datum
  source: 'IMU Gyroscope' | 'Phone Orientation' | 'Manual' | 'None';
}

export interface CapturePhotoRecord {
  id: string;
  projectId?: string; // Owning project (set when uploaded to a user project)
  filename: string;
  roomId: string;
  pass: CapturePass;
  modality?: CaptureModality; // Photograph vs Extracted Video Frame vs Sensor Augmented
  cameraPoseTag: string; // e.g., 'Perimeter_NW_Corner', 'Door_D01_Facing_R02'
  focalLengthMm: number;
  sharpnessScore: number; // 0 to 100 (automated or reviewer estimated)
  exposureReview: 'Good' | 'Overexposed' | 'Underexposed';
  overlapReview: 'Sufficient (>70%)' | 'Marginal (50-70%)' | 'Insufficient (<50%)';
  occlusionFlag: boolean;
  doorwayAnchorId?: string; // Links this photo to a doorway anchor
  sensorMetadata?: SensorMetadata; // Optional IMU / orientation / rangefinder readings
  reviewerNotes?: string;
  timestamp: string;
  isAutomatedMetric: boolean;
  imageUrl?: string; // Data URL or object URL for real image thumbnail and 3D texture projection
  spatialPose?: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch?: number;
  };
  dominantColor?: string; // Extracted hex color
}

export interface CategoryScore {
  category: 'coverage' | 'doorway' | 'dimension' | 'imageQuality';
  name: string;
  maxPoints: number;
  earnedPoints: number;
  percentage: number;
  evidence: string[];
  deductions: string[];
  missingChecks: string[];
}

export interface DartRoomScore {
  roomId: string;
  roomName: string;
  totalScore: number; // 0 - 100
  status: 'Accepted for Reconstruction' | 'Targeted Recapture Required' | 'Recapture Recommended';
  categories: {
    coverage: CategoryScore;
    doorway: CategoryScore;
    dimension: CategoryScore;
    imageQuality: CategoryScore;
  };
  recommendations: string[];
  reviewedBy?: string;
  reviewDate?: string;
  reviewerNotes?: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'doorway' | 'manifest' | 'dimension' | 'coverage';
  entityId: string;
  message: string;
  suggestedFix: string;
}

export interface SOPCheckItem {
  id: string;
  pass: CapturePass | 'General';
  title: string;
  description: string;
  ruleReference: string;
  completed: boolean;
  critical: boolean;
}

export type ProjectStatus = 'Draft' | 'Ready for Upload' | 'Processing' | 'Completed' | 'Failed';
export type SpaceType = 'Bedroom' | 'Living Room' | 'Apartment' | 'Office' | 'Corridor' | 'Custom';
export type MeasurementUnit = 'metres' | 'feet';
export type CaptureMethod = 'Still Photos Loop' | 'Walkthrough Video Frames' | 'Hybrid Multi-Modal';

export interface NammaProject {
  id: string;
  name: string;
  description: string;
  spaceType: SpaceType;
  roomCount: number;
  units: MeasurementUnit;
  floorArea?: number;
  ceilingHeight?: number;
  captureMethod: CaptureMethod;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
  videoCount: number;
  hasFloorPlan: boolean;
  floorPlanName?: string;
  startingAnchor: string;
  referenceMeasurement?: string;
  reconstructionEngine: 'Calibrated Geometric Twin' | 'COLMAP Photogrammetry';
  reconstructionProgress: number;
  lastErrorMessage?: string;
  reconstructionModelStats?: ReconstructionModelStats | null;
}

/**
 * Stats produced either by the metric geometric generator (triangle metrics) or
 * by the photo reconstruction service (COLMAP SfM + Brush Gaussian splats).
 * Fields are optional so projects created before photoreal reconstruction keep
 * working and so the UI can show whatever the local machine actually produced.
 */
export interface ReconstructionModelStats {
  triangleCount?: number;
  vertexCount?: number;
  pointCloudCount?: number;
  reprojectionErrorPx?: number;
  scaleDisparityPercent?: number;
  lastGeneratedAt?: string;

  jobId?: string;
  jobStatus?: 'queued' | 'running' | 'succeeded' | 'failed';
  error?: string | null;
  engine?: string;
  sfmEngine?: string;
  splatEngine?: string | null;
  cameraModel?: string;
  inputImages?: number;
  registeredImages?: number;
  registrationRatePercent?: number;
  sparsePoints?: number;
  splatCount?: number;
  durationSeconds?: number;
  sceneCenter?: [number, number, number];
  sceneRadius?: number;
  splatCenter?: [number, number, number] | null;
  splatRadius?: number | null;
  splatUrl?: string | null;
  pointCloudUrl?: string | null;
  /** Static URL to a locally-produced pipeline mesh (e.g. /models/dart_twin_reconstruction.ply). */
  modelUrl?: string | null;
  splatFilterRemoved?: number;
  viewerCamera?: {
    position: [number, number, number];
    lookAt: [number, number, number];
    up?: [number, number, number];
    image?: string;
  } | null;
  brushWarning?: string | null;
}

export interface VideoExtractionConfig {
  sampleIntervalSeconds: number; // e.g. 0.5, 1.0, 2.0
  blurThreshold: number; // minimum sharpness score (0-100)
  targetResolution: '1080p' | '720p' | 'Original';
  assignedRoomId: string;
  assignedPass: CapturePass;
}

export interface PointOfInterest {
  id: string;
  name: string;
  category: 'Furniture' | 'Fixture' | 'Entrance' | 'Appliance' | 'Amenity';
  roomId: string;
  position: { x: number; y: number; z: number };
  description: string;
  thumbnailUrl?: string;
}

export interface NavigationRoute {
  sourceRoomId: string;
  targetPoiId: string;
  targetPoiName: string;
  waypoints: Array<{ x: number; y: number; z: number }>;
  totalDistanceMeters: number;
  estimatedWalkingTimeSec: number;
  /** Plain-language, turn-by-turn directions for the HUD. */
  instructions: string[];
  /** Room names in the order the route passes through them. */
  roomSequence: string[];
}


