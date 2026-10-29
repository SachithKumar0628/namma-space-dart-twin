import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { UploadCloud, Box } from 'lucide-react';
import { Navbar, ActiveTab } from './components/Navbar';
import { LandingPageView } from './components/LandingPageView';
import { SpacesLibraryView } from './components/SpacesLibraryView';
import { CaptureStudioView } from './components/CaptureStudioView';
import { ReconstructionWorkspaceView } from './components/ReconstructionWorkspaceView';
import { CaptureSOPView } from './components/CaptureSOPView';
import { CreateProjectModal } from './components/CreateProjectModal';
import { RoomInventoryView } from './components/RoomInventoryView';
import { ManifestView } from './components/ManifestView';
import { QualityInspectorView } from './components/QualityInspectorView';
const Viewer3DView = lazy(() =>
  import('./components/Viewer3DView').then((m) => ({ default: m.Viewer3DView }))
);
const PhotorealScanView = lazy(() =>
  import('./components/PhotorealScanView').then((m) => ({ default: m.PhotorealScanView }))
);
import { ErrorBoundary } from './components/ErrorBoundary';
import { PipelineDocsView } from './components/PipelineDocsView';
import { HowToUseModal } from './components/HowToUseModal';

import { INITIAL_SOP_CHECKLIST } from './utils/sampleData';
import { calculateDartScore, DEFAULT_THRESHOLDS, ScoreThresholds } from './utils/dartScoring';
import { useProjects } from './hooks/useProjects';
import { useRooms } from './hooks/useRooms';
import { useDoorways } from './hooks/useDoorways';
import { usePhotos } from './hooks/usePhotos';
import { validateDartDataset } from './utils/dartValidator';
import { analyzeImageFile, ImageAnalysisResult } from './utils/mediaProcessor';
import { estimateRoomFootprint } from './utils/roomModeling';
import {
  getPhotoCountRecommendation,
  evaluateRoomPhotoCoverage,
} from './utils/reconstruction3DGenerator';
import { groupPhotoFilenames } from './utils/photoRoomGrouping';
import { reconstructionApi, type ReconstructionJob } from './services/reconstructionApi';
import {
  RoomMetadata,
  DoorwayAnchor,
  CapturePhotoRecord,
  SOPCheckItem,
  DartRoomScore,
  NammaProject,
  CapturePass,
} from './types/dart';

const LOCAL_STORAGE_KEY = 'nammatwin_state_v3';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('landing');
  const [isHowToUseOpen, setIsHowToUseOpen] = useState<boolean>(false);

  // Projects (backend via hook)
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    create: createProjectApi,
    update: updateProjectApi,
    remove: removeProjectApi,
  } = useProjects();
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('nammatwin_current_project');
      // Never restore the bundled B-804 sample as the user's active space.
      return stored && stored !== 'proj_b804' ? stored : '';
    } catch {
      return '';
    }
  });
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [reconstructionJob, setReconstructionJob] = useState<ReconstructionJob | null>(null);
  const [reconstructionServiceError, setReconstructionServiceError] = useState<string | null>(null);

  // Rooms / Doorways / Photos (backend via hooks)
  const {
    rooms,
    create: createRoomApi,
    update: updateRoomApi,
    remove: removeRoomApi,
  } = useRooms(currentProjectId);
  const {
    doorways,
    create: createDoorwayApi,
    update: updateDoorwayApi,
    remove: removeDoorwayApi,
  } = useDoorways(currentProjectId);
  const {
    photos,
    create: createPhotoApi,
    update: updatePhotoApi,
    remove: removePhotoApi,
  } = usePhotos(currentProjectId);

  // Checklist stays local
  const [checklist, setChecklist] = useState<SOPCheckItem[]>(() => {
    try {
      const saved = localStorage.getItem(`${LOCAL_STORAGE_KEY}_checklist`);
      return saved ? (JSON.parse(saved) as SOPCheckItem[]) : INITIAL_SOP_CHECKLIST;
    } catch {
      return INITIAL_SOP_CHECKLIST;
    }
  });

  const [thresholds, setThresholds] = useState<ScoreThresholds>(DEFAULT_THRESHOLDS);

  // Sync checklist to LocalStorage (other datasets are persisted by backend hooks)
  useEffect(() => {
    localStorage.setItem(`${LOCAL_STORAGE_KEY}_checklist`, JSON.stringify(checklist));
  }, [checklist]);

  // Dynamically compute DART Quality Scores for all rooms
  const scores: Record<string, DartRoomScore> = useMemo(() => {
    const res: Record<string, DartRoomScore> = {};
    rooms.forEach((room) => {
      res[room.id] = calculateDartScore(room, photos, doorways, thresholds);
    });
    return res;
  }, [rooms, photos, doorways, thresholds]);

  // Dynamically compute dataset consistency validation
  const validationSummary = useMemo(() => {
    return validateDartDataset(rooms, doorways, photos);
  }, [rooms, doorways, photos]);

  // Export full project JSON
  const handleExportJSON = () => {
    const payload = {
      project: 'Namma Space Digital Twin',
      platform: 'Namma Space — Enterprise Spatial Computing Platform',
      exportedAt: new Date().toISOString(),
      rooms,
      doorways,
      photos,
      checklist,
      scores,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `namma_space_project_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // CSV Import
  const handleImportCSV = async (csvText: string) => {
    try {
      const lines = csvText.split('\n').filter((l) => l.trim() !== '');
      if (lines.length < 2) return;

      const importedPhotos: CapturePhotoRecord[] = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map((c) => c.trim());
        if (row.length < 4) continue;

        const photo: CapturePhotoRecord = {
          id: row[0] || `P${i}`,
          projectId: currentProjectId,
          filename: row[1] || `photo_${i}.jpg`,
          roomId: row[2] || rooms[0]?.id || 'R01',
          pass: (row[3] as CapturePass) || 'Pass A',
          cameraPoseTag: row[4] || 'Perimeter_Sweep',
          focalLengthMm: Number(row[5]) || 24,
          sharpnessScore: Number(row[6]) || 85,
          exposureReview: (row[7] as CapturePhotoRecord['exposureReview']) || 'Good',
          overlapReview: (row[8] as CapturePhotoRecord['overlapReview']) || 'Sufficient (>70%)',
          occlusionFlag: row[9] === 'true',
          doorwayAnchorId: row[10] || undefined,
          reviewerNotes: row[11] || undefined,
          timestamp: row[12] || new Date().toISOString().replace('T', ' ').substring(0, 19),
          isAutomatedMetric: row[13] !== 'false',
        };
        importedPhotos.push(photo);
      }

      if (importedPhotos.length > 0) {
        for (const p of importedPhotos) {
          await createPhotoApi(p as any);
        }
        alert(`Successfully imported ${importedPhotos.length} photograph records.`);
      }
    } catch (err: any) {
      alert(`Failed to parse CSV: ${err.message}`);
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = [
      'id',
      'filename',
      'roomId',
      'pass',
      'cameraPoseTag',
      'focalLengthMm',
      'sharpnessScore',
      'exposureReview',
      'overlapReview',
      'occlusionFlag',
      'doorwayAnchorId',
      'reviewerNotes',
      'timestamp',
      'isAutomatedMetric',
    ];

    const rows = photos.map((p) =>
      [
        p.id,
        p.filename,
        p.roomId,
        p.pass,
        `"${p.cameraPoseTag || ''}"`,
        p.focalLengthMm,
        p.sharpnessScore,
        p.exposureReview,
        `"${p.overlapReview}"`,
        p.occlusionFlag,
        p.doorwayAnchorId || '',
        `"${p.reviewerNotes || ''}"`,
        p.timestamp,
        p.isAutomatedMetric,
      ].join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `namma_space_manifest_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // SOP Checklist Toggle
  const handleToggleCheckItem = (id: string) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
  };

  const handleResetChecklist = () => {
    setChecklist(INITIAL_SOP_CHECKLIST);
  };

  // Room Actions
  const handleAddRoom = (newRoom: RoomMetadata) => {
    createRoomApi({ ...newRoom, projectId: currentProjectId } as any);
  };
  const handleUpdateRoom = (updated: RoomMetadata) => {
    updateRoomApi(updated.id, updated as any);
  };
  const handleDeleteRoom = (roomId: string) => {
    removeRoomApi(roomId);
  };

  // Doorway Actions
  const handleAddDoorway = (newDoorway: DoorwayAnchor) => {
    createDoorwayApi({ ...newDoorway, projectId: currentProjectId } as any);
  };
  const handleUpdateDoorway = (updated: DoorwayAnchor) => {
    updateDoorwayApi(updated.id, updated as any);
  };
  const handleDeleteDoorway = (doorwayId: string) => {
    removeDoorwayApi(doorwayId);
  };

  // Photo Actions
  const handleAddPhoto = (newPhoto: CapturePhotoRecord) => {
    createPhotoApi({ ...newPhoto, projectId: currentProjectId } as any);
  };
  const handleUpdatePhoto = (updated: CapturePhotoRecord) => {
    updatePhotoApi(updated.id, updated as any);
  };
  const handleDeletePhoto = (photoId: string) => {
    removePhotoApi(photoId);
  };

  const handleUpdateReviewerNotes = (roomId: string, reviewer: string, notes: string) => {
    console.log(`[DART Reviewer Note] Room ${roomId} reviewed by ${reviewer}: ${notes}`);
  };

  /**
   * Kick off the local COLMAP + Brush job. The walkable twin is already usable
   * when this is called, so failures are recorded on the project instead of
   * blocking the upload flow.
   */
  const handleStartPhotorealReconstruction = async (
    files: File[],
    projectIdArg?: string
  ): Promise<ReconstructionJob> => {
    const targetProjectId = projectIdArg || currentProjectId;
    if (!targetProjectId) {
      throw new Error('Create or select a space before starting a photoreal scan.');
    }
    if (files.length < 3) {
      throw new Error('Add at least 3 overlapping photos before starting a photoreal scan.');
    }

    const startedAt = new Date().toISOString();
    const result = await reconstructionApi.createJob(files, targetProjectId);
    if (!result.ok || !result.data) {
      const message =
        result.error ||
        `The reconstruction service at ${reconstructionApi.baseUrl} did not accept the photos.`;
      await updateProjectApi(targetProjectId, {
        status: 'Failed',
        reconstructionProgress: 0,
        reconstructionModelStats: {
          jobStatus: 'failed',
          error: message,
          engine: 'COLMAP SfM + Brush Gaussian Splatting',
          inputImages: files.length,
          lastGeneratedAt: startedAt,
        },
        updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      } as any);
      throw new Error(message);
    }

    const job = result.data;
    setReconstructionJob(job);
    setReconstructionServiceError(null);
    await updateProjectApi(targetProjectId, {
      reconstructionModelStats: {
        jobId: job.id,
        jobStatus: job.status,
        engine: 'COLMAP SfM + Brush Gaussian Splatting',
        inputImages: job.inputCount || files.length,
        lastGeneratedAt: startedAt,
      },
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    } as any);
    return job;
  };

  const handleDeletePhotorealScan = async (projectId: string): Promise<void> => {
    const knownJobId =
      (reconstructionJob?.projectId === projectId ? reconstructionJob.id : '') ||
      projects.find((project) => project.id === projectId)?.reconstructionModelStats?.jobId ||
      '';
    if (knownJobId) {
      const result = await reconstructionApi.deleteJob(knownJobId);
      if (!result.ok && result.status !== 404) {
        throw new Error(result.error || 'Could not delete the reconstruction assets.');
      }
    }

    const cleared = await updateProjectApi(projectId, {
      reconstructionModelStats: null,
      reconstructionEngine: 'Calibrated Geometric Twin',
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    } as any);
    if (!cleared) {
      throw new Error('Could not update the space after removing the scan.');
    }
    setReconstructionJob(null);
    setReconstructionServiceError(null);
  };

  // Project Handlers
  const handleCreateProject = async (newProject: NammaProject) => {
    // Persist the project first so every follow-up record can be scoped to it.
    const created = await createProjectApi(newProject as any);
    if (!created) {
      alert('Could not create the project. Please check the API server on port 5000.');
      return;
    }
    const projectId = created.id || newProject.id;

    // Generate an initial room for the custom space so the user can upload and
    // walk through immediately. The ID is unique per project so the generic
    // room layout solver is used instead of the B-804 demo layout.
    const newRoomId = `R_${projectId}_1`;
    const mappedCategory: RoomMetadata['category'] =
      newProject.spaceType === 'Bedroom'
        ? 'Bedroom'
        : newProject.spaceType === 'Office'
        ? 'Office'
        : newProject.spaceType === 'Corridor'
        ? 'Corridor'
        : 'Living';

    const initialProjectRoom: RoomMetadata = {
      id: newRoomId,
      projectId,
      name: `${newProject.name} — Main Room`,
      category: mappedCategory,
      lengthMeters: 5.4,
      widthMeters: 4.2,
      heightMeters: newProject.ceilingHeight || 2.85,
      originDescription: `${newProject.startingAnchor || 'Entrance Doorway'} threshold`,
      coordinateConvention: 'Right-Handed Y-Up (Three.js standard)',
      connectedDoorwayIds: [],
      features: {
        doorsCount: 1,
        windowsCount: 1,
        reflectiveSurfaces: false,
        featurelessWhiteWalls: false,
      },
    };

    const savedRoom = await createRoomApi(initialProjectRoom as any, projectId);
    if (savedRoom) {
      try {
        localStorage.setItem(`nammatwin_rooms_${projectId}`, JSON.stringify([savedRoom]));
      } catch {
        /* ignore */
      }
    }

    setCurrentProjectId(projectId);
    setActiveTab('sop');
  };

  /**
   * Landing-page upload flow: take the user's own photos, build a project,
   * scale the photos into rooms with calibrated dimensions, and open the
   * generated 3D walkthrough. Everything is scoped to the new project so the
   * preloaded B-804 demo never mixes with the user's capture.
   */
  const handleUploadPhotos = async (
    files: File[],
    onProgress?: (done: number, total: number) => void
  ) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      throw new Error('Please choose at least one JPG, PNG or WebP photo.');
    }

    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const readableDate = now.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const projectId = `proj_user_${Date.now()}`;

    // Prefer explicit room labels in filenames. A set such as
    // Entrance/Living/Dining/Kitchen/Bedroom/Balcony is a multi-room capture,
    // not six overlapping views of one room.
    const filenameGroups = groupPhotoFilenames(imageFiles.map((file) => file.name));
    const roomGroups =
      filenameGroups.length > 1
        ? filenameGroups
        : [{ key: 'captured', name: 'Your Captured Space', category: 'Living' as const }];
    const roomCount = Math.min(6, roomGroups.length);

    // 1. Analyse every photo first — the real image dimensions and colours
    //    drive each room's footprint, so the generated geometry matches the
    //    capture instead of using one fixed box for every upload.
    const analyses: ImageAnalysisResult[] = [];
    for (const file of imageFiles) {
      try {
        analyses.push(await analyzeImageFile(file));
      } catch {
        throw new Error(`Could not read "${file.name}". Try a JPG, PNG or WebP photo.`);
      }
    }

    const analysisGroups: ImageAnalysisResult[][] = Array.from(
      { length: roomCount },
      () => []
    );
    imageFiles.forEach((file, index) => {
      const inferredKey = groupPhotoFilenames([file.name])[0]?.key || 'captured';
      const roomIndex = roomCount > 1
        ? Math.max(0, filenameGroups.findIndex((group) => group.key === inferredKey))
        : 0;
      analysisGroups[roomIndex].push(analyses[index]);
    });

    const footprints = analysisGroups.map((group, index) =>
      estimateRoomFootprint(group, `${projectId}_${index + 1}`)
    );
    const totalFloorArea =
      Math.round(footprints.reduce((sum, footprint) => sum + footprint.areaSqm, 0) * 10) / 10;
    const ceilingHeight = Math.max(...footprints.map((footprint) => footprint.heightMeters));

    // Per-room photo coverage validation — reject rooms with too few images
    // for a usable reconstruction, warn on rooms below the quality target.
    const photosPerRoom: Record<string, number> = {};
    analysisGroups.forEach((group, index) => {
      const roomId = `${projectId}_${index + 1}`;
      photosPerRoom[roomId] = group.length;
    });
    const coverageIssues = evaluateRoomPhotoCoverage(roomCount, photosPerRoom, 'good');
    const blockingIssues = coverageIssues.filter((i) => i.severity === 'error');
    if (blockingIssues.length > 0) {
      const messages = blockingIssues.map((i) => i.message).join(' ');
      throw new Error(
        `Insufficient photos for reconstruction: ${messages} Upload more photos for each room before continuing.`
      );
    }

    const recommendation = getPhotoCountRecommendation(roomCount, 'good');
    const totalPhotos = imageFiles.length;
    if (totalPhotos < recommendation.targetTotal) {
      // Non-blocking warning: attach to project metadata so the UI can show it.
      // eslint-disable-next-line no-console
      console.warn(
        `[Photo count] ${recommendation.message} You uploaded ${totalPhotos} photo(s).`
      );
    }

    const createdProject = await createProjectApi({
      id: projectId,
      name: `My 3D Space — ${readableDate}`,
      description: `Generated from ${imageFiles.length} uploaded photo${
        imageFiles.length === 1 ? '' : 's'
      } across ${roomCount} room${roomCount === 1 ? '' : 's'}.`,
      spaceType: 'Apartment',
      roomCount,
      units: 'metres',
      floorArea: totalFloorArea,
      ceilingHeight,
      captureMethod: 'Still Photos Loop',
      status: imageFiles.length >= 3 ? 'Processing' : 'Completed',
      createdAt: stamp,
      updatedAt: stamp,
      photoCount: imageFiles.length,
      videoCount: 0,
      hasFloorPlan: false,
      startingAnchor: 'Main entrance',
      referenceMeasurement: `${totalFloorArea} m² footprint auto-calibrated from the uploaded photo set`,
      reconstructionEngine:
        imageFiles.length >= 3
          ? 'COLMAP SfM + Brush Gaussian Splatting'
          : 'Calibrated Geometric Twin',
      reconstructionProgress: imageFiles.length >= 3 ? 10 : 100,
    } as any);

    if (!createdProject) {
      throw new Error('Could not create your project. Is the API server running on port 5000?');
    }

    // 2. Rooms — unique IDs keep the user's model out of the B-804 demo layout
    //    and each room uses the footprint estimated from its own photos.
    const newRooms: RoomMetadata[] = [];
    for (let i = 0; i < roomCount; i++) {
      const footprint = footprints[i];
      const roomGroup = roomGroups[i];
      const room: RoomMetadata = {
        id: `R_${projectId}_${i + 1}`,
        projectId,
        name: roomCount === 1 ? 'Your Captured Space' : roomGroup.name,
        category: roomCount === 1 ? 'Living' : roomGroup.category,
        lengthMeters: footprint.lengthMeters,
        widthMeters: footprint.widthMeters,
        heightMeters: footprint.heightMeters,
        originDescription: i === 0 ? 'Main entrance threshold' : `Doorway from Room ${i}`,
        coordinateConvention: 'Right-Handed Y-Up (Three.js standard)',
        connectedDoorwayIds: [],
        features: {
          doorsCount: 1,
          windowsCount: 1,
          reflectiveSurfaces: false,
          featurelessWhiteWalls: false,
        },
      };
      const savedRoom = await createRoomApi({ ...room, projectId } as any, projectId);
      if (!savedRoom) {
        throw new Error('Could not create the 3D room for your photos. Please try again.');
      }
      newRooms.push(savedRoom as RoomMetadata);
    }

    // 3. Doorway anchors connect the rooms into one continuous walkthrough.
    const newDoorways: DoorwayAnchor[] = [];
    for (let i = 1; i < newRooms.length; i++) {
      const doorway: DoorwayAnchor = {
        id: `D_${projectId}_${i}`,
        projectId,
        name: `Passage ${i} → ${i + 1}`,
        connectedRoomIds: [newRooms[i - 1].id, newRooms[i].id],
        widthMeters: 0.95,
        heightMeters: 2.1,
        wallLocation: 'east',
        // 0 = centred on the shared wall (see getDoorwayPlacement).
        offsetMeters: 0,
        hasClearLineOfSight: true,
        observations: {
          roomAObserved: true,
          roomBObserved: true,
          hasContinuousPassCPhoto: true,
        },
      };
      const savedDoorway = await createDoorwayApi({ ...doorway, projectId } as any);
      if (savedDoorway) newDoorways.push(savedDoorway as DoorwayAnchor);
    }

    // 4. Store each analysed photo against the room it belongs to.
    const passes: CapturePass[] = ['Pass A', 'Pass B', 'Pass C'];
    const newPhotos: CapturePhotoRecord[] = [];
    let done = 0;

    for (let index = 0; index < imageFiles.length; index++) {
      const file = imageFiles[index];
      const analysis = analyses[index];
      const inferredGroup = filenameGroups.findIndex(
        (group) => group.key === (groupPhotoFilenames([file.name])[0]?.key || 'captured')
      );
      const roomIndex =
        roomCount > 1
          ? Math.max(0, Math.min(roomCount - 1, inferredGroup))
          : 0;
      const room = newRooms[roomIndex] || newRooms[0];

      const record: CapturePhotoRecord = {
        id: `P_${projectId}_${index + 1}`,
        projectId,
        filename: file.name,
        roomId: room.id,
        pass: passes[index % passes.length],
        modality: 'Still Photograph',
        cameraPoseTag: `${room.name.replace(/\s+/g, '_')}_Upload_${index + 1}`,
        focalLengthMm: 24,
        sharpnessScore: analysis.sharpness,
        exposureReview: analysis.exposure,
        overlapReview: 'Sufficient (>70%)',
        occlusionFlag: false,
        timestamp: stamp,
        isAutomatedMetric: true,
        reviewerNotes: `Uploaded photo: ${analysis.width}x${analysis.height}px, sharpness ${analysis.sharpness}/100`,
        imageUrl: analysis.imageUrl,
        dominantColor: analysis.dominantColor,
      };

      const savedPhoto = await createPhotoApi({ ...record, projectId } as any);
      if (!savedPhoto) {
        throw new Error(`Could not save "${file.name}". Try a smaller photo set.`);
      }
      newPhotos.push(savedPhoto as CapturePhotoRecord);
      done++;
      onProgress?.(done, imageFiles.length);
    }

    // Seed the per-project cache so the viewer opens instantly with the new twin.
    try {
      localStorage.setItem(`nammatwin_rooms_${projectId}`, JSON.stringify(newRooms));
      localStorage.setItem(`nammatwin_doorways_${projectId}`, JSON.stringify(newDoorways));
    } catch {
      /* ignore quota errors */
    }
    try {
      localStorage.setItem(`nammatwin_photos_${projectId}`, JSON.stringify(newPhotos));
    } catch {
      /* photo data may exceed the localStorage quota; the API still has it */
    }

    await updateProjectApi(projectId, {
      status: 'Completed',
      reconstructionProgress: imageFiles.length >= 3 ? 10 : 100,
      roomCount,
      photoCount: imageFiles.length,
      reconstructionEngine:
        imageFiles.length >= 3
          ? 'COLMAP SfM + Brush Gaussian Splatting'
          : 'Calibrated Geometric Twin',
      updatedAt: stamp,
    } as any);

    setCurrentProjectId(projectId);
    setActiveTab('viewer');

    // Start the expensive, genuinely photo-derived pass in the background.
    // The user can walk the geometric twin while COLMAP/Brush run; the
    // Photoreal Scan tab shows live progress and the resulting splat.
    if (imageFiles.length >= 3) {
      void handleStartPhotorealReconstruction(imageFiles, projectId).catch(() => {
        /* the failure is persisted on the project and shown in Photoreal Scan */
      });
    }
  };

  const handleUpdateProjectStatus = (status: NammaProject['status'], progress: number) => {
    updateProjectApi(currentProjectId, {
      status,
      reconstructionProgress: progress,
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    } as any);
  };

  const [localModelUrl, setLocalModelUrl] = useState<string | undefined>(undefined);

  const handleUpdateCurrentProject = (updated: Partial<NammaProject>) => {
    updateProjectApi(currentProjectId, {
      ...updated,
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    } as any);
  };

  // The bundled B-804 sample dataset is never shown in the product UI — users
  // only ever see spaces they created from their own photos.
  const visibleProjects = useMemo(
    () => projects.filter((p) => p.id !== 'proj_b804'),
    [projects]
  );

  const currentProject = visibleProjects.find((p) => p.id === currentProjectId);

  // Verify the locally-produced COLMAP mesh asset actually exists before handing
  // it to the viewer. A 404 would otherwise break the walkthrough for projects
  // that haven't run the CUDA pipeline yet.
  useEffect(() => {
    const shouldProbe =
      currentProject?.status === 'Completed' &&
      currentProject?.reconstructionEngine === 'COLMAP Photogrammetry';
    if (!shouldProbe) {
      setLocalModelUrl(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/models/dart_twin_reconstruction.ply', {
          method: 'HEAD',
          cache: 'no-store',
        });
        if (!cancelled && response.ok) {
          setLocalModelUrl('/models/dart_twin_reconstruction.ply');
        } else {
          setLocalModelUrl(undefined);
        }
      } catch {
        if (!cancelled) setLocalModelUrl(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentProject?.status, currentProject?.reconstructionEngine]);

  // Clear transient scan state when the active space changes. Completed
  // results live in the project record, not in this local state.
  useEffect(() => {
    setReconstructionJob(null);
    setReconstructionServiceError(null);
  }, [currentProjectId]);

  // Poll the local reconstruction service while the active project has a job.
  // This runs regardless of the visible tab, so a scan that finishes while the
  // user is walking the twin is persisted as soon as it completes.
  useEffect(() => {
    const projectId = currentProject?.id;
    const jobId = currentProject?.reconstructionModelStats?.jobId;
    const jobStatus = currentProject?.reconstructionModelStats?.jobStatus;
    if (
      !projectId ||
      !jobId ||
      (jobStatus && jobStatus !== 'queued' && jobStatus !== 'running')
    ) {
      return;
    }

    let cancelled = false;
    let timer = 0;

    const timestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

    const poll = async () => {
      const result = await reconstructionApi.getJob(jobId);
      if (cancelled) return;

      if (!result.ok || !result.data) {
        setReconstructionServiceError(
          result.error || 'Could not read the reconstruction job status.'
        );
        timer = window.setTimeout(poll, 4000);
        return;
      }

      setReconstructionServiceError(null);
      setReconstructionJob(result.data);

      if (
        (result.data.status === 'completed' || result.data.status === 'succeeded') &&
        result.data.stats
      ) {
        const saved = await updateProjectApi(projectId, {
          status: 'Completed',
          reconstructionProgress: 100,
          reconstructionEngine: 'COLMAP Photogrammetry',
          reconstructionModelStats: {
            ...result.data.stats,
            jobId: result.data.id,
            jobStatus: result.data.status,
          },
          updatedAt: timestamp(),
        } as any);
        if (!saved) timer = window.setTimeout(poll, 4000);
        return;
      }

      if (result.data.status === 'failed') {
        const saved = await updateProjectApi(projectId, {
          status: 'Failed',
          reconstructionModelStats: {
            ...(result.data.stats || {}),
            jobId: result.data.id,
            jobStatus: 'failed',
            error: result.data.error || result.data.message,
            lastGeneratedAt: timestamp(),
          },
          updatedAt: timestamp(),
        } as any);
        if (!saved) timer = window.setTimeout(poll, 4000);
        return;
      }

      await updateProjectApi(projectId, {
        status: 'Processing',
        reconstructionProgress: Math.max(1, Math.min(99, result.data.progress || 1)),
        updatedAt: timestamp(),
      } as any);
      timer = window.setTimeout(poll, 2500);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [
    currentProject?.id,
    currentProject?.reconstructionModelStats?.jobId,
    currentProject?.reconstructionModelStats?.jobStatus,
    updateProjectApi,
  ]);

  // Remember the active project so a page reload re-opens the same twin, and
  // fall back to the newest user space (or no space at all) when it is gone.
  useEffect(() => {
    if (projectsLoading) return;
    const exists = visibleProjects.some((p) => p.id === currentProjectId);
    const next = exists ? currentProjectId : visibleProjects[0]?.id || '';
    if (next !== currentProjectId) setCurrentProjectId(next);
    try {
      if (next) localStorage.setItem('nammatwin_current_project', next);
      else localStorage.removeItem('nammatwin_current_project');
    } catch {
      /* ignore quota errors */
    }
  }, [visibleProjects, currentProjectId, projectsLoading]);

  // Loading state while backend data is being fetched
  if (projectsLoading && projects.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-mono text-slate-400">Loading NammaTwin workspace…</p>
          {projectsError && <p className="text-xs text-red-400 mt-2">{projectsError}</p>}
        </div>
      </div>
    );
  }

  // Tools that need a real captured space. Without one we show a friendly empty
  // state instead of silently falling back to the bundled sample apartment.
  const requiresProject =
    activeTab === 'viewer' ||
    activeTab === 'photoreal' ||
    activeTab === 'sop' ||
    activeTab === 'reconstruction' ||
    activeTab === 'rooms' ||
    activeTab === 'manifest' ||
    activeTab === 'inspector';

  if (requiresProject && !currentProject) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
        <Navbar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          validationSummary={validationSummary}
          projects={visibleProjects}
          currentProjectId={currentProjectId}
          onSelectProject={setCurrentProjectId}
          onExportJSON={handleExportJSON}
          onOpenHowToUse={() => setIsHowToUseOpen(true)}
        />

        <main className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="max-w-lg text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400">
              <Box className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-white">No 3D space yet</h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                Upload a few photos of your room and we will build your own walkable 3D model.
                Every space in this workspace comes from your own photos.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => setActiveTab('landing')}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-cyan-950/50"
              >
                <UploadCloud className="w-4 h-4" />
                <span>Upload Photos</span>
              </button>
              <button
                onClick={() => setActiveTab('library')}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded-xl border border-slate-700 transition"
              >
                <span>Open Spaces</span>
              </button>
            </div>
          </div>
        </main>

        <footer className="bg-slate-900 border-t border-slate-800/80 py-3 px-4 text-xs font-mono text-slate-400">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-slate-200 font-bold">
                Namma Space • Spatial Computing Platform
              </span>
            </div>
            <div className="text-[11px] text-slate-500">
              Upload photos • Generate your own 3D walkthrough
            </div>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navigation Bar with Project Switcher */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        validationSummary={validationSummary}
        projects={visibleProjects}
        currentProjectId={currentProjectId}
        onSelectProject={setCurrentProjectId}
        onExportJSON={handleExportJSON}
        onOpenHowToUse={() => setIsHowToUseOpen(true)}
      />

      {/* Main Viewport Router */}
      <main className="flex-1">
        {activeTab === 'landing' && (
          <LandingPageView
            onNavigate={setActiveTab}
            onOpenHowToUse={() => setIsHowToUseOpen(true)}
            photos={photos}
            rooms={rooms}
            onUploadPhotos={handleUploadPhotos}
          />
        )}

        {activeTab === 'library' && (
          <SpacesLibraryView
            projects={visibleProjects}
            currentProjectId={currentProjectId}
            onSelectProject={setCurrentProjectId}
            onOpenCreateProjectModal={() => setIsCreateModalOpen(true)}
            onNavigate={setActiveTab}
          />
        )}

        {activeTab === 'viewer' && (
          <ErrorBoundary>
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">Loading 3D viewer…</div>}>
              <Viewer3DView
                reconstructionJob={reconstructionJob}
                modelUrl={localModelUrl}
                projectName={currentProject?.name}
                project={currentProject}
                rooms={rooms}
                doorways={doorways}
                photos={photos}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {activeTab === 'photoreal' && currentProject && (
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-slate-400 font-mono text-xs py-20">
                  Loading photoreal scan…
                </div>
              }
            >
              <PhotorealScanView
                project={currentProject}
                photos={photos}
                job={
                  reconstructionJob && reconstructionJob.projectId === currentProject.id
                    ? reconstructionJob
                    : null
                }
                serviceError={reconstructionServiceError}
                onStartReconstruction={(files) =>
                  handleStartPhotorealReconstruction(files, currentProject.id)
                }
                onDeleteReconstruction={() => handleDeletePhotorealScan(currentProject.id)}
                onOpenWalkthrough={() => setActiveTab('viewer')}
                onOpenCaptureStudio={() => setActiveTab('sop')}
              />
            </Suspense>
          </ErrorBoundary>
        )}

        {activeTab === 'sop' && currentProject && (
          <CaptureStudioView
            currentProject={currentProject}
            rooms={rooms}
            doorways={doorways}
            photos={photos}
            checklist={checklist}
            onAddPhoto={handleAddPhoto}
            onDeletePhoto={handleDeletePhoto}
            onToggleCheckItem={handleToggleCheckItem}
            onNavigateToReconstruction={() => setActiveTab('reconstruction')}
            onUpdateProject={handleUpdateCurrentProject}
          />
        )}

        {activeTab === 'reconstruction' && currentProject && (
          <ReconstructionWorkspaceView
            currentProject={currentProject}
            rooms={rooms}
            doorways={doorways}
            photos={photos}
            onNavigateToViewer={() => setActiveTab('viewer')}
            onNavigateToCapture={() => setActiveTab('sop')}
            onUpdateProjectStatus={handleUpdateProjectStatus}
          />
        )}

        {activeTab === 'guide' && (
          <CaptureSOPView
            checklist={checklist}
            onToggleCheckItem={handleToggleCheckItem}
            onResetChecklist={handleResetChecklist}
          />
        )}

        {activeTab === 'rooms' && (
          <RoomInventoryView
            rooms={rooms}
            doorways={doorways}
            onAddRoom={handleAddRoom}
            onUpdateRoom={handleUpdateRoom}
            onDeleteRoom={handleDeleteRoom}
            onAddDoorway={handleAddDoorway}
            onUpdateDoorway={handleUpdateDoorway}
            onDeleteDoorway={handleDeleteDoorway}
          />
        )}

        {activeTab === 'manifest' && (
          <ManifestView
            photos={photos}
            rooms={rooms}
            doorways={doorways}
            validationSummary={validationSummary}
            onAddPhoto={handleAddPhoto}
            onUpdatePhoto={handleUpdatePhoto}
            onDeletePhoto={handleDeletePhoto}
            onImportCSV={handleImportCSV}
            onExportCSV={handleExportCSV}
          />
        )}

        {activeTab === 'inspector' && (
          <QualityInspectorView
            rooms={rooms}
            scores={scores}
            doorways={doorways}
            photos={photos}
            thresholds={thresholds}
            onUpdateThresholds={setThresholds}
            onUpdateReviewerNotes={handleUpdateReviewerNotes}
          />
        )}

        {activeTab === 'pipeline' && <PipelineDocsView />}
      </main>

      {/* Modal for Project Creation */}
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateProject={handleCreateProject}
      />

      {/* Interactive How to Use Guide Modal */}
      <HowToUseModal
        isOpen={isHowToUseOpen}
        onClose={() => setIsHowToUseOpen(false)}
        onNavigateTab={(tab) => {
          setActiveTab(tab);
          setIsHowToUseOpen(false);
        }}
      />

      {/* Enterprise Platform Footer */}
      <footer className="bg-slate-900 border-t border-slate-800/80 py-3 px-4 text-xs font-mono text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-slate-200 font-bold">Namma Space • Spatial Computing Platform</span>
            <span className="text-slate-600">|</span>
            <span className="text-cyan-400">Scale-Calibrated Digital Twin</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Four-Stage LoopAnchor Protocol • Real Photo-to-3D Reconstruction • Browser Walkthrough
          </div>
        </div>
      </footer>
    </div>
  );
}
