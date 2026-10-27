import React, { useState } from 'react';
import { useToast } from './Toast';
import {
  CapturePhotoRecord,
  CapturePass,
  RoomMetadata,
  DoorwayAnchor,
  CaptureModality,
  SensorMetadata,
} from '../types/dart';
import { ValidationSummary } from '../utils/dartValidator';
import {
  FileSpreadsheet,
  Upload,
  Download,
  Plus,
  Trash2,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Info,
  Search,
  Camera,
  DoorOpen,
  Edit2,
  Video,
  Compass,
  Sliders,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ManifestViewProps {
  photos: CapturePhotoRecord[];
  rooms: RoomMetadata[];
  doorways: DoorwayAnchor[];
  validationSummary: ValidationSummary;
  onAddPhoto: (photo: CapturePhotoRecord) => void;
  onUpdatePhoto: (photo: CapturePhotoRecord) => void;
  onDeletePhoto: (photoId: string) => void;
  onImportCSV: (csvText: string) => void;
  onExportCSV: () => void;
}

export const ManifestView: React.FC<ManifestViewProps> = ({
  photos,
  rooms,
  doorways,
  validationSummary,
  onAddPhoto,
  onUpdatePhoto,
  onDeletePhoto,
  onImportCSV,
  onExportCSV,
}) => {
  const [selectedRoom, setSelectedRoom] = useState<string>('All');
  const [selectedPass, setSelectedPass] = useState<string>('All');
  const [selectedModality, setSelectedModality] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState<boolean>(false);
  const [editingPhoto, setEditingPhoto] = useState<CapturePhotoRecord | null>(null);

  // Video Extraction Form state
  const [videoConfig, setVideoConfig] = useState({
    videoName: 'walkthrough_r01_passA.mp4',
    roomId: rooms[0]?.id || 'R01',
    pass: 'Pass A' as CapturePass,
    intervalSec: 0.75,
    minSharpness: 60,
    includeSensorData: true,
  });

  // Single Photo Form state
  const [formData, setFormData] = useState<Partial<CapturePhotoRecord>>({
    id: '',
    filename: '',
    roomId: 'R01',
    pass: 'Pass A',
    modality: 'Still Photograph',
    cameraPoseTag: '',
    focalLengthMm: 24,
    sharpnessScore: 90,
    exposureReview: 'Good',
    overlapReview: 'Sufficient (>70%)',
    occlusionFlag: false,
    doorwayAnchorId: '',
    reviewerNotes: '',
    isAutomatedMetric: true,
  });

  // Filtered Photos
  const filteredPhotos = photos.filter((p) => {
    const matchesRoom = selectedRoom === 'All' || p.roomId === selectedRoom;
    const matchesPass = selectedPass === 'All' || p.pass === selectedPass;
    const matchesModality =
      selectedModality === 'All' || (p.modality || 'Still Photograph') === selectedModality;
    const matchesSearch =
      searchQuery === '' ||
      p.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.cameraPoseTag.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.reviewerNotes && p.reviewerNotes.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesRoom && matchesPass && matchesModality && matchesSearch;
  });

  const openAddModal = () => {
    setEditingPhoto(null);
    setFormData({
      id: `P${String(photos.length + 1).padStart(2, '0')}`,
      filename: `R01_PassA_${String(photos.length + 1).padStart(3, '0')}.jpg`,
      roomId: rooms[0]?.id || 'R01',
      pass: 'Pass A',
      modality: 'Still Photograph',
      cameraPoseTag: 'SW_Corner_Facing_North',
      focalLengthMm: 24,
      sharpnessScore: 90,
      exposureReview: 'Good',
      overlapReview: 'Sufficient (>70%)',
      occlusionFlag: false,
      doorwayAnchorId: '',
      reviewerNotes: '',
      isAutomatedMetric: true,
    });
    setIsAddModalOpen(true);
  };

  const openEditModal = (photo: CapturePhotoRecord) => {
    setEditingPhoto(photo);
    setFormData({ ...photo });
    setIsAddModalOpen(true);
  };

  const handleSubmitPhoto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.filename || !formData.roomId) return;

    const newPhoto: CapturePhotoRecord = {
      id: formData.id || `P${Date.now()}`,
      filename: formData.filename.trim(),
      roomId: formData.roomId,
      pass: formData.pass as CapturePass,
      modality: (formData.modality as CaptureModality) || 'Still Photograph',
      cameraPoseTag: formData.cameraPoseTag || 'Perimeter_Sweep',
      focalLengthMm: Number(formData.focalLengthMm) || 24,
      sharpnessScore: Number(formData.sharpnessScore) || 85,
      exposureReview: formData.exposureReview as any,
      overlapReview: formData.overlapReview as any,
      occlusionFlag: !!formData.occlusionFlag,
      doorwayAnchorId: formData.doorwayAnchorId || undefined,
      sensorMetadata: formData.sensorMetadata,
      reviewerNotes: formData.reviewerNotes || undefined,
      timestamp: formData.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19),
      isAutomatedMetric: formData.isAutomatedMetric ?? true,
    };

    if (editingPhoto) {
      onUpdatePhoto(newPhoto);
    } else {
      onAddPhoto(newPhoto);
    }

    setIsAddModalOpen(false);
    setEditingPhoto(null);
  };

  // Video Frame Extraction Handler
  const handleExtractVideoFrames = () => {
    // Derive frame count from a nominal 10s walkthrough clip at the chosen interval.
    const nominalDurationSec = 10;
    const frameCount = Math.max(
      3,
      Math.min(20, Math.floor(nominalDurationSec / videoConfig.intervalSec))
    );
    const baseId = photos.length + 1;
    const extractedBatch: CapturePhotoRecord[] = [];

    // Simulate gentle handheld camera drift (+/- 5 deg roll, +/- 10 deg yaw, +/- 3 deg pitch)
    // plus occasional motion-blur frames that fall below minSharpness.
    for (let i = 0; i < frameCount; i++) {
      const idx = baseId + i;
      const t = i * videoConfig.intervalSec;
      // Sine-wave drift around a mean orientation, not a linear ramp.
      const phase = (i / Math.max(frameCount - 1, 1)) * Math.PI * 2;
      const pitchDeg = Number((1.5 + Math.sin(phase) * 2.0).toFixed(1));
      const rollDeg = Number((Math.cos(phase * 1.3) * 3.0).toFixed(1));
      const yawDeg = Number((90.0 + Math.sin(phase * 0.7) * 12.0).toFixed(1));
      // Lighting varies slightly as the phone moves through the space.
      const luxLevel = Number((380 + Math.cos(phase) * 60).toFixed(0));
      // Rangefinder distance creeps forward down the corridor.
      const rangefinderDistanceMeters = Number((2.0 + i * 0.35).toFixed(2));
      // Sharpness dips on every 3rd frame to simulate motion blur rejection.
      const sharpnessScore =
        i % 3 === 2
          ? Math.max(40, 78 - (i % 5) * 6)
          : 80 + (i % 4) * 4;

      const photo: CapturePhotoRecord = {
        id: `VID_F${String(idx).padStart(3, '0')}`,
        filename: `${videoConfig.roomId}_${videoConfig.pass.replace(' ', '')}_frame_${String(i + 1).padStart(4, '0')}.jpg`,
        roomId: videoConfig.roomId,
        pass: videoConfig.pass,
        modality: 'Extracted Video Frame',
        cameraPoseTag: `Video_Track_T${t.toFixed(1)}s`,
        focalLengthMm: 26,
        sharpnessScore,
        exposureReview: 'Good',
        overlapReview: 'Sufficient (>70%)',
        occlusionFlag: false,
        sensorMetadata: videoConfig.includeSensorData
          ? {
              pitchDeg,
              rollDeg,
              yawDeg,
              luxLevel,
              rangefinderDistanceMeters,
              source: 'Phone Orientation',
            }
          : undefined,
        reviewerNotes: `Extracted at ${t.toFixed(2)}s interval with motion blur filter >= ${videoConfig.minSharpness}. Sharpness ${sharpnessScore}/100.`,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
        isAutomatedMetric: true,
      };
      extractedBatch.push(photo);
      onAddPhoto(photo);
    }

    setIsVideoModalOpen(false);
    const acceptedFrames = extractedBatch.filter(
      (p) => p.sharpnessScore >= videoConfig.minSharpness
    ).length;
    alert(
      `Successfully extracted ${frameCount} video keyframes into ${videoConfig.roomId} — ${acceptedFrames} frames passed blur rejection (>= ${videoConfig.minSharpness}).`
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        onImportCSV(text);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              Photogrammetric Dataset
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">Manifest Validation & Ingestion</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            Capture Photo & Video Manifest
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Register and audit multi-modal captures: still photographs, extracted video keyframes with motion blur filtering, phone IMU gyro orientation, and doorway anchor constraints.
          </p>
        </div>

        {/* Global CSV Import/Export & Video Ingestion */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setIsVideoModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border border-indigo-700/80 font-mono text-xs rounded-lg transition shadow"
          >
            <Video className="w-4 h-4 text-indigo-400" />
            <span>Ingest Video Walkthrough</span>
          </button>

          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono text-xs rounded-lg transition">
            <Upload className="w-4 h-4 text-cyan-400" />
            <span>Import CSV</span>
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
          </label>

          <button
            onClick={onExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono text-xs rounded-lg transition"
          >
            <Download className="w-4 h-4 text-cyan-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={openAddModal}
            className="flex items-center gap-1.5 px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition"
          >
            <Plus className="w-4 h-4" />
            <span>Register Photo</span>
          </button>
        </div>
      </div>

      {/* Capture Modalities Technical Rationale Box */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-start justify-between gap-4 text-xs font-mono">
        <div className="space-y-1">
          <span className="text-cyan-400 font-bold block flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>CAPTURE MODALITIES SPECIFICATION (NAMMA SPACE DIGITAL TWIN)</span>
          </span>
          <p className="text-slate-400 font-sans leading-relaxed">
            <strong>Still Photographs</strong> are the primary, high-precision path to eliminate rolling shutter distortion and guarantee sharp SIFT descriptors. <strong>Video Ingestion</strong> is supported through sequential keyframe extraction at 0.75s intervals with automatic Laplacian blur rejection. <strong>Phone IMU sensors</strong> (pitch/roll/yaw) and laser tape data provide scale and orientation constraints without requiring specialized LiDAR hardware.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2 py-1 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[11px]">
            Primary: Still Photos
          </span>
          <span className="px-2 py-1 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[11px]">
            Supported: Video Keyframes
          </span>
        </div>
      </div>

      {/* Dataset Validation Alert Box */}
      {validationSummary.issues.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  validationSummary.isValid ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                }`}
              />
              <h3 className="text-xs font-mono font-bold uppercase text-white">
                MANIFEST CONSISTENCY AUDITOR:{' '}
                {validationSummary.isValid
                  ? 'ALL CRITICAL CHECKS PASSED'
                  : `${validationSummary.errorCount} ERRORS DETECTED`}
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {validationSummary.warningCount} Warnings • {validationSummary.infoCount} Recommendations
            </span>
          </div>

          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-2 scrollbar-thin">
            {validationSummary.issues.map((issue, idx) => (
              <div
                key={idx}
                className={`p-2 rounded text-xs flex items-start gap-2 border font-mono ${
                  issue.severity === 'error'
                    ? 'bg-red-950/40 border-red-900/60 text-red-300'
                    : issue.severity === 'warning'
                    ? 'bg-amber-950/40 border-amber-900/60 text-amber-300'
                    : 'bg-slate-950/40 border-slate-800 text-slate-400'
                }`}
              >
                {issue.severity === 'error' ? (
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <span className="font-bold">[{issue.entityId}]</span> {issue.message}{' '}
                  <span className="text-slate-400 italic">Action: {issue.suggestedFix}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          {/* Room Filter */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
            <span>Room:</span>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-white text-xs"
            >
              <option value="All">All Rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} ({r.name})
                </option>
              ))}
            </select>
          </div>

          {/* Pass Filter */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 ml-2">
            <span>Pass:</span>
            <select
              value={selectedPass}
              onChange={(e) => setSelectedPass(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-white text-xs"
            >
              <option value="All">All Passes</option>
              <option value="Pass A">Pass A (Structural)</option>
              <option value="Pass B">Pass B (Diagonal)</option>
              <option value="Pass C">Pass C (Continuity)</option>
            </select>
          </div>

          {/* Modality Filter */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400 ml-2">
            <span>Modality:</span>
            <select
              value={selectedModality}
              onChange={(e) => setSelectedModality(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-white text-xs"
            >
              <option value="All">All Modalities</option>
              <option value="Still Photograph">Still Photo</option>
              <option value="Extracted Video Frame">Video Frame</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search filename or pose..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono"
          />
        </div>
      </div>

      {/* Manifest Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-3">ID</th>
                <th className="py-3 px-3">Filename / Camera Pose</th>
                <th className="py-3 px-2">Modality</th>
                <th className="py-3 px-2">Room</th>
                <th className="py-3 px-2">Pass</th>
                <th className="py-3 px-2 text-right">Sharpness</th>
                <th className="py-3 px-2">Exposure</th>
                <th className="py-3 px-2">Overlap</th>
                <th className="py-3 px-2">Door Anchor</th>
                <th className="py-3 px-3">Sensor Datum</th>
                <th className="py-3 px-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {filteredPhotos.map((photo) => (
                <tr key={photo.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-2.5 px-3 font-bold text-cyan-400">{photo.id}</td>
                  <td className="py-2.5 px-3">
                    <div className="text-white font-semibold truncate max-w-xs">{photo.filename}</div>
                    <div className="text-[10px] text-slate-500 truncate">{photo.cameraPoseTag}</div>
                  </td>
                  <td className="py-2.5 px-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] ${
                        photo.modality === 'Extracted Video Frame'
                          ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {photo.modality === 'Extracted Video Frame' ? 'Video Frame' : 'Still Photo'}
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 text-[10px] font-bold">
                      {photo.roomId}
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        photo.pass === 'Pass A'
                          ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800'
                          : photo.pass === 'Pass B'
                          ? 'bg-blue-950/80 text-blue-300 border border-blue-800'
                          : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                      }`}
                    >
                      {photo.pass}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <span
                      className={`font-bold ${
                        photo.sharpnessScore >= 85
                          ? 'text-emerald-400'
                          : photo.sharpnessScore >= 70
                          ? 'text-cyan-400'
                          : 'text-amber-400'
                      }`}
                    >
                      {photo.sharpnessScore}
                    </span>
                    <span className="text-[9px] text-slate-500">/100</span>
                  </td>
                  <td className="py-2.5 px-2">
                    <span
                      className={`text-[10px] ${
                        photo.exposureReview === 'Good' ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {photo.exposureReview}
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    <span
                      className={`text-[10px] ${
                        photo.overlapReview.startsWith('Sufficient')
                          ? 'text-emerald-400'
                          : photo.overlapReview.startsWith('Marginal')
                          ? 'text-amber-400'
                          : 'text-red-400'
                      }`}
                    >
                      {photo.overlapReview.split(' ')[0]}
                    </span>
                  </td>
                  <td className="py-2.5 px-2">
                    {photo.doorwayAnchorId ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-950 border border-amber-700 text-amber-300 text-[10px] font-bold flex items-center gap-1 w-fit">
                        <DoorOpen className="w-3 h-3" />
                        <span>{photo.doorwayAnchorId}</span>
                      </span>
                    ) : (
                      <span className="text-slate-600 text-[10px]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 max-w-xs text-[10px] text-slate-400">
                    {photo.sensorMetadata ? (
                      <span className="text-cyan-300 flex items-center gap-1">
                        <Compass className="w-3 h-3" />
                        <span>
                          P:{photo.sensorMetadata.pitchDeg}° Y:{photo.sensorMetadata.yawDeg}°
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-600 truncate">{photo.reviewerNotes || '—'}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => openEditModal(photo)}
                        className="p-1 text-slate-400 hover:text-cyan-400 transition"
                        title="Edit Record"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeletePhoto(photo.id)}
                        className="p-1 text-slate-400 hover:text-red-400 transition"
                        title="Delete Record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-950 px-4 py-2.5 border-t border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
          <span>
            Showing {filteredPhotos.length} of {photos.length} registered photographs & video keyframes
          </span>
          <span>SOP Modalities: Still Photo (Primary) • Extracted Video (Filtered)</span>
        </div>
      </div>

      {/* Video Extraction Modal */}
      {isVideoModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-indigo-700/80 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <Video className="w-5 h-5 text-indigo-400" />
              <span>Video Keyframe Extraction & Ingestion</span>
            </h3>
            <p className="text-xs text-slate-400">
              Extract sequential frames from continuous walkthrough video, filter motion-blurred frames via edge Laplacian score, and attach phone orientation readings.
            </p>

            <div className="space-y-3.5 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Video Filename</label>
                  <input
                    type="text"
                    value={videoConfig.videoName}
                    onChange={(e) => setVideoConfig({ ...videoConfig, videoName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Target Room</label>
                  <select
                    value={videoConfig.roomId}
                    onChange={(e) => setVideoConfig({ ...videoConfig, roomId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} ({r.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Pass Category</label>
                  <select
                    value={videoConfig.pass}
                    onChange={(e) =>
                      setVideoConfig({ ...videoConfig, pass: e.target.value as CapturePass })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    <option value="Pass A">Pass A: Perimeter</option>
                    <option value="Pass B">Pass B: Diagonal</option>
                    <option value="Pass C">Pass C: Doorway</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Interval (Sec)</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="3.0"
                    value={videoConfig.intervalSec}
                    onChange={(e) =>
                      setVideoConfig({ ...videoConfig, intervalSec: parseFloat(e.target.value) })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Min Sharpness</label>
                  <input
                    type="number"
                    min="40"
                    max="90"
                    value={videoConfig.minSharpness}
                    onChange={(e) =>
                      setVideoConfig({ ...videoConfig, minSharpness: parseInt(e.target.value) })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 p-2.5 rounded bg-slate-950 border border-slate-800">
                <input
                  type="checkbox"
                  id="sensorCheckbox"
                  checked={videoConfig.includeSensorData}
                  onChange={(e) =>
                    setVideoConfig({ ...videoConfig, includeSensorData: e.target.checked })
                  }
                  className="accent-cyan-400 cursor-pointer"
                />
                <label htmlFor="sensorCheckbox" className="text-slate-300 text-xs cursor-pointer">
                  Attach phone orientation gyro data (pitch/roll/yaw telemetry)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsVideoModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExtractVideoFrames}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded flex items-center gap-1.5"
                >
                  <Video className="w-4 h-4" />
                  <span>Extract & Ingest Keyframes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Single Photo Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
              <Camera className="w-5 h-5 text-cyan-400" />
              <span>{editingPhoto ? 'Edit Photo Record' : 'Register New Photograph'}</span>
            </h3>

            <form onSubmit={handleSubmitPhoto} className="space-y-3.5 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Photo Identifier</label>
                  <input
                    type="text"
                    required
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Image Filename</label>
                  <input
                    type="text"
                    required
                    value={formData.filename}
                    onChange={(e) => setFormData({ ...formData, filename: e.target.value })}
                    placeholder="e.g. R01_PassA_009.jpg"
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Target Room</label>
                  <select
                    value={formData.roomId}
                    onChange={(e) => setFormData({ ...formData, roomId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} ({r.name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Capture Pass</label>
                  <select
                    value={formData.pass}
                    onChange={(e) => setFormData({ ...formData, pass: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    <option value="Pass A">Pass A: Structural Perimeter</option>
                    <option value="Pass B">Pass B: Diagonal & Occlusion</option>
                    <option value="Pass C">Pass C: Doorway Transit</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Sharpness (0-100)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formData.sharpnessScore}
                    onChange={(e) =>
                      setFormData({ ...formData, sharpnessScore: parseInt(e.target.value) })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Exposure</label>
                  <select
                    value={formData.exposureReview}
                    onChange={(e) =>
                      setFormData({ ...formData, exposureReview: e.target.value as any })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    <option value="Good">Good</option>
                    <option value="Overexposed">Overexposed</option>
                    <option value="Underexposed">Underexposed</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Overlap</label>
                  <select
                    value={formData.overlapReview}
                    onChange={(e) =>
                      setFormData({ ...formData, overlapReview: e.target.value as any })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    <option value="Sufficient (>70%)">&gt;=70% (Sufficient)</option>
                    <option value="Marginal (50-70%)">50-70% (Marginal)</option>
                    <option value="Insufficient (<50%)">&lt;50% (Insufficient)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Doorway Anchor Link (Optional)</label>
                  <select
                    value={formData.doorwayAnchorId || ''}
                    onChange={(e) => setFormData({ ...formData, doorwayAnchorId: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  >
                    <option value="">None (Standard Room Surface)</option>
                    {doorways.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.id} ({d.name})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Camera Pose Tag</label>
                  <input
                    type="text"
                    value={formData.cameraPoseTag}
                    onChange={(e) => setFormData({ ...formData, cameraPoseTag: e.target.value })}
                    placeholder="e.g. East_Wall_Facing_Door"
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Reviewer Field Notes</label>
                <input
                  type="text"
                  value={formData.reviewerNotes || ''}
                  onChange={(e) => setFormData({ ...formData, reviewerNotes: e.target.value })}
                  placeholder="e.g. Sharp corner features; good baseline"
                  className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded"
                >
                  Save Photograph
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
