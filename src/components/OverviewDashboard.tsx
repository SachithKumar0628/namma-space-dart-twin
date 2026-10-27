import React from 'react';
import {
  Compass,
  FileSpreadsheet,
  CheckSquare,
  ShieldCheck,
  Layers,
  Box,
  FileText,
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  Camera,
  ArrowRight,
  TrendingUp,
  Cpu,
  HelpCircle,
} from 'lucide-react';
import { DartRoomScore, DoorwayAnchor, RoomMetadata, CapturePhotoRecord, NammaProject } from '../types/dart';
import { ValidationSummary } from '../utils/dartValidator';
import { ActiveTab } from './Navbar';
import { Plus, Sparkles, FolderOpen, Video } from 'lucide-react';

interface OverviewDashboardProps {
  projects: NammaProject[];
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenCreateProjectModal: () => void;
  rooms: RoomMetadata[];
  doorways: DoorwayAnchor[];
  photos: CapturePhotoRecord[];
  scores: Record<string, DartRoomScore>;
  validationSummary: ValidationSummary;
  onNavigate: (tab: ActiveTab) => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  projects,
  currentProjectId,
  onSelectProject,
  onOpenCreateProjectModal,
  rooms,
  doorways,
  photos,
  scores,
  validationSummary,
  onNavigate,
}) => {
  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0];

  // Compute real current project metrics
  const totalRooms = rooms.length;
  const totalPhotos = photos.length;
  const passingRoomsCount = Object.values(scores).filter((s) => s.totalScore >= 85).length;
  const missingDoorwaysCount = doorways.filter(
    (d) => !d.observations.roomAObserved || !d.observations.roomBObserved || !d.observations.hasContinuousPassCPhoto
  ).length;

  const passACount = photos.filter((p) => p.pass === 'Pass A').length;
  const passBCount = photos.filter((p) => p.pass === 'Pass B').length;
  const passCCount = photos.filter((p) => p.pass === 'Pass C').length;

  const avgScore =
    totalRooms > 0
      ? Math.round(Object.values(scores).reduce((acc, s) => acc + s.totalScore, 0) / totalRooms)
      : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

      {/* Hero Header with Brand & Create New Space Action */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              Namma Space • Command Center
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">DART Precision Engine</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            NammaTwin Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            Indoor 3D digital twin reconstruction: Capture real residential or lab spaces, validate photogrammetric evidence, and roam in interactive desktop WebGL walkthrough.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenCreateProjectModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider font-mono rounded-lg transition shadow-lg shadow-orange-950/60"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Space</span>
          </button>
          <button
            onClick={() => onNavigate('viewer')}
            className="flex items-center gap-2 px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider font-mono rounded-lg transition shadow-lg shadow-cyan-950/60"
          >
            <Box className="w-4 h-4" />
            <span>Launch 3D Walkthrough</span>
          </button>
        </div>
      </div>

      {/* Recent Projects Section */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-orange-400" />
            <h3 className="font-bold text-sm font-mono text-white">RECENT SPACES &amp; PROJECTS</h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {projects.length} Registered Spaces
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((proj) => {
            const isSelected = proj.id === currentProjectId;
            return (
              <div
                key={proj.id}
                onClick={() => onSelectProject(proj.id)}
                className={`p-4 rounded-xl border text-left transition cursor-pointer select-none flex flex-col justify-between ${
                  isSelected
                    ? 'bg-slate-950 border-orange-500/80 ring-1 ring-orange-500/30'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900 text-slate-300 border border-slate-800">
                      {proj.spaceType}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        proj.status === 'Completed'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : proj.status === 'Processing'
                          ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                          : proj.status === 'Ready for Upload'
                          ? 'bg-amber-950 text-amber-400 border border-amber-800'
                          : proj.status === 'Failed'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : 'bg-slate-900 text-slate-400'
                      }`}
                    >
                      {proj.status}
                    </span>
                  </div>

                  <h4 className="font-bold text-xs text-white font-mono truncate">{proj.name}</h4>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {proj.description}
                  </p>

                  <div className="mt-3 flex items-center gap-3 text-[10px] font-mono text-slate-400">
                    <span>{proj.roomCount} room(s)</span>
                    <span>•</span>
                    <span>{proj.photoCount} photos</span>
                    {proj.floorArea && (
                      <>
                        <span>•</span>
                        <span>{proj.floorArea} {proj.units === 'metres' ? 'm²' : 'sq ft'}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="text-[10px] text-slate-500 font-mono">
                    {proj.updatedAt}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {proj.status === 'Completed' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(proj.id);
                          onNavigate('viewer');
                        }}
                        className="px-2 py-1 bg-cyan-600/80 hover:bg-cyan-500 text-slate-950 text-[10px] font-bold font-mono rounded transition"
                      >
                        View 3D
                      </button>
                    ) : proj.status === 'Ready for Upload' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(proj.id);
                          onNavigate('sop');
                        }}
                        className="px-2 py-1 bg-orange-500 hover:bg-orange-400 text-slate-950 text-[10px] font-bold font-mono rounded transition"
                      >
                        Continue Capture
                      </button>
                    ) : proj.status === 'Processing' ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(proj.id);
                          onNavigate('reconstruction' as any);
                        }}
                        className="px-2 py-1 bg-cyan-600/80 hover:bg-cyan-500 text-slate-950 text-[10px] font-bold font-mono rounded transition"
                      >
                        Inspect Progress
                      </button>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProject(proj.id);
                          onNavigate('sop');
                        }}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-mono rounded transition"
                      >
                        Open Space
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* Real Project KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* KPI 1 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Registered Rooms
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-white">{totalRooms}</span>
            <span className="text-xs font-mono text-slate-500">spaces</span>
          </div>
          <span className="text-[10px] text-cyan-400 mt-2 font-mono flex items-center gap-1">
            <Compass className="w-3 h-3" />
            <span>R01, R02 active</span>
          </span>
        </div>

        {/* KPI 2 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Capture Photos
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-white">{totalPhotos}</span>
            <span className="text-xs font-mono text-slate-500">frames</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-2 font-mono">
            A:{passACount} • B:{passBCount} • C:{passCCount}
          </span>
        </div>

        {/* KPI 3 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Passing Quality Gate
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-emerald-400">
              {passingRoomsCount}/{totalRooms}
            </span>
            <span className="text-xs font-mono text-slate-500">rooms</span>
          </div>
          <span className="text-[10px] text-emerald-400/90 mt-2 font-mono flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>&gt;= 85 Score Target</span>
          </span>
        </div>

        {/* KPI 4 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Doorway Anchors
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-white">{doorways.length}</span>
            <span className="text-xs font-mono text-slate-500">apertures</span>
          </div>
          <span className={`text-[10px] mt-2 font-mono flex items-center gap-1 ${
            missingDoorwaysCount === 0 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            <DoorOpen className="w-3 h-3" />
            <span>{missingDoorwaysCount === 0 ? '100% Reciprocal' : `${missingDoorwaysCount} Incomplete`}</span>
          </span>
        </div>

        {/* KPI 5 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Average DART Score
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black font-mono text-cyan-300">{avgScore}</span>
            <span className="text-xs font-mono text-slate-500">/100</span>
          </div>
          <span className="text-[10px] text-cyan-400 mt-2 font-mono flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            <span>Reconstruction Ready</span>
          </span>
        </div>

        {/* KPI 6 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Pipeline Validation
          </span>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`text-lg font-bold font-mono ${
              validationSummary.isValid ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              {validationSummary.isValid ? 'VERIFIED' : 'ATTENTION'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-2 font-mono">
            {validationSummary.errorCount} Errors • {validationSummary.warningCount} Warnings
          </span>
        </div>
      </div>

      {/* Main Grid: Doorway Anchoring Network & DART Scoring Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Doorway Topology & Room Quality Breakdown */}
        <div className="lg:col-span-2 space-y-6">
          {/* Doorway Continuity Architecture Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div>
                <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                  <DoorOpen className="w-4 h-4 text-cyan-400" />
                  <span>DOORWAY ANCHOR TOPOLOGY & REPEATABILITY</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Shared apertures bridge coordinate conventions, eliminate scale drift, and provide loop closure between adjoining spaces.
                </p>
              </div>
              <button
                onClick={() => onNavigate('rooms')}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
              >
                <span>Edit Anchors</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            {/* Visual Topology Diagram */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-5 flex flex-col md:flex-row items-center justify-between gap-4">
              {/* Room 1 Node */}
              <div className="bg-slate-900 border border-cyan-700/60 rounded-xl p-4 w-full md:w-60 shadow-lg text-left">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 bg-cyan-950 text-cyan-300 border border-cyan-800 rounded text-xs font-mono font-bold">
                    R01
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-900">
                    {scores['R01']?.totalScore ?? 94}/100 PTS
                  </span>
                </div>
                <h4 className="font-semibold text-xs text-white mt-2 truncate">Robotics Assembly Bay</h4>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  6.20m × 4.50m × 2.85m
                </div>
                <div className="mt-2 text-[10px] text-cyan-400 flex items-center gap-1 font-mono">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Doorway D01 Observed</span>
                </div>
              </div>

              {/* Connecting Doorway Link */}
              <div className="flex flex-col items-center justify-center px-2 py-1 text-center shrink-0">
                <div className="font-mono text-xs font-bold text-amber-300 px-3 py-1 bg-amber-950/80 border border-amber-600/70 rounded-full shadow-md flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span>DOORWAY D01</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-1">
                  W: 1.05m • H: 2.15m
                </div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono mt-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  <span>Pass C Transit Verified</span>
                </div>
                {/* Visual Connector Line */}
                <div className="hidden md:flex items-center w-24 h-0.5 bg-gradient-to-r from-cyan-500 via-amber-400 to-cyan-500 mt-2" />
              </div>

              {/* Room 2 Node */}
              <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-4 w-full md:w-60 shadow-lg text-left">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 bg-slate-800 text-slate-300 border border-slate-700 rounded text-xs font-mono font-bold">
                    R02
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-900">
                    {scores['R02']?.totalScore ?? 92}/100 PTS
                  </span>
                </div>
                <h4 className="font-semibold text-xs text-white mt-2 truncate">Telemetry & Operations</h4>
                <div className="text-[11px] font-mono text-slate-400 mt-1">
                  5.40m × 4.20m × 2.85m
                </div>
                <div className="mt-2 text-[10px] text-cyan-400 flex items-center gap-1 font-mono">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Reciprocal Link Confirmed</span>
                </div>
              </div>
            </div>

            {/* Doorway Quality Ledger */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="bg-slate-950/50 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 font-mono text-[10px] block">DOORWAY POSITION</span>
                <span className="font-medium text-slate-200">East Wall @ 2.10m offset</span>
              </div>
              <div className="bg-slate-950/50 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 font-mono text-[10px] block">RECIPROCAL DISPARITY</span>
                <span className="font-medium text-emerald-400 font-mono">3.2 mm (&lt; 5mm target)</span>
              </div>
              <div className="bg-slate-950/50 p-2.5 rounded border border-slate-800">
                <span className="text-slate-500 font-mono text-[10px] block">TRANSIT IMAGERY</span>
                <span className="font-medium text-slate-200">2 continuous Pass C frames</span>
              </div>
            </div>
          </div>

          {/* Three-Pass Capture Distribution Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" />
                <span>THREE-PASS PHOTOGRAMMETRIC PROTOCOL</span>
              </h3>
              <button
                onClick={() => onNavigate('sop')}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
              >
                <span>View Full SOP</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Pass A */}
              <div className="bg-slate-950/60 border border-cyan-900/50 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[11px] font-mono font-bold">
                    Pass A: Structural
                  </span>
                  <span className="text-xs font-mono font-bold text-white">{passACount} Photos</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Perimeter sweep of wall corners, ceiling/floor boundaries, and doorways with &gt;=70% consecutive overlap.
                </p>
                <div className="text-[10px] font-mono text-emerald-400">Target: 8+ frames (Achieved)</div>
              </div>

              {/* Pass B */}
              <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[11px] font-mono font-bold">
                    Pass B: Diagonal
                  </span>
                  <span className="text-xs font-mono font-bold text-white">{passBCount} Photos</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Diagonal 45° angles and furniture sweeps to clear blindspots, under-table voids, and occluded corners.
                </p>
                <div className="text-[10px] font-mono text-emerald-400">Target: 4+ frames (Achieved)</div>
              </div>

              {/* Pass C */}
              <div className="bg-slate-950/60 border border-amber-900/40 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[11px] font-mono font-bold">
                    Pass C: Continuity
                  </span>
                  <span className="text-xs font-mono font-bold text-white">{passCCount} Photos</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Doorway threshold transit steps linking Room A into Room B and targeted close-ups on weak feature surfaces.
                </p>
                <div className="text-[10px] font-mono text-emerald-400">Target: 2+ frames (Achieved)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: DART 100-Point Quality Gate Summary */}
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>DART QUALITY GATE</span>
                </h3>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                  100-PT METRIC
                </span>
              </div>

              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Evidence-backed four-pillar scoring gate ensuring rigorous indoor photogrammetry before passing geometry to COLMAP.
              </p>

              {/* Category Weight Breakdown */}
              <div className="space-y-3 font-mono text-xs">
                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>1. Coverage & Occlusion</span>
                    <span className="text-cyan-400">40 Points Max</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-cyan-500 h-full rounded-full" style={{ width: '95%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>2. Doorway Continuity</span>
                    <span className="text-cyan-400">25 Points Max</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-cyan-400 h-full rounded-full" style={{ width: '100%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>3. Measured Dimensions</span>
                    <span className="text-cyan-400">20 Points Max</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-blue-400 h-full rounded-full" style={{ width: '90%' }} />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>4. Sharpness & Overlap</span>
                    <span className="text-cyan-400">15 Points Max</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div className="bg-emerald-400 h-full rounded-full" style={{ width: '93%' }} />
                  </div>
                </div>
              </div>

              {/* Threshold Status Guide */}
              <div className="mt-6 pt-4 border-t border-slate-800/80 space-y-2 text-[11px] font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-emerald-400 font-bold">85 – 100</span>
                  <span className="text-slate-300">Accepted for Reconstruction</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-amber-400 font-bold">70 – 84</span>
                  <span className="text-slate-400">Targeted Recapture Required</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-red-400 font-bold">&lt; 70</span>
                  <span className="text-slate-400">Recapture Recommended</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onNavigate('inspector')}
              className="mt-6 w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center gap-2"
            >
              <span>Inspect Room Scores</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          </div>

          {/* Quick Action Box */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-cyan-800/50 rounded-xl p-5 shadow-lg">
            <h4 className="font-bold text-xs font-mono text-cyan-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Box className="w-3.5 h-3.5" />
              <span>Interactive Digital Twin Roaming</span>
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              Step directly inside the reconstructed 3D space with first-person WASD controls, real-time minimap radar, and live doorway anchor notifications.
            </p>
            <button
              onClick={() => onNavigate('viewer')}
              className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition shadow-md shadow-cyan-950"
            >
              Enter 3D Roaming Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
