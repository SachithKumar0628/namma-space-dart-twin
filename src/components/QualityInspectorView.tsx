import React, { useState } from 'react';
import { DartRoomScore, RoomMetadata, CapturePhotoRecord, DoorwayAnchor } from '../types/dart';
import { ScoreThresholds } from '../utils/dartScoring';
import { TechfestQualityAuditCard } from './TechfestQualityAuditCard';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Download,
  DoorOpen,
  Camera,
  Layers,
  Ruler,
  Sliders,
  ChevronRight,
  UserCheck,
  FileText,
  Award,
  Check,
  ExternalLink,
  ClipboardCheck,
  BookOpen,
  Terminal,
} from 'lucide-react';

interface QualityInspectorViewProps {
  rooms: RoomMetadata[];
  scores: Record<string, DartRoomScore>;
  doorways: DoorwayAnchor[];
  photos: CapturePhotoRecord[];
  thresholds: ScoreThresholds;
  onUpdateThresholds: (thresholds: ScoreThresholds) => void;
  onUpdateReviewerNotes: (roomId: string, reviewer: string, notes: string) => void;
}

export const QualityInspectorView: React.FC<QualityInspectorViewProps> = ({
  rooms,
  scores,
  doorways,
  photos,
  thresholds,
  onUpdateThresholds,
  onUpdateReviewerNotes,
}) => {
  const [viewMode, setViewMode] = useState<'system_audit' | 'room_dart'>('system_audit');
  const [activeRoomId, setActiveRoomId] = useState<string>(rooms[0]?.id || 'R01');
  const [reviewerName, setReviewerName] = useState<string>('Lead Photogrammetry Engineer');
  const [reviewerNotes, setReviewerNotes] = useState<string>(
    'Doorway D01 frame geometry and Pass C transit verified with sub-5mm threshold alignment.'
  );

  const activeRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0];
  const activeScore = scores[activeRoomId] || scores['R01'];

  const roomPhotos = photos.filter((p) => p.roomId === activeRoomId);

  // Status Styling
  const getStatusColor = (status: DartRoomScore['status']) => {
    switch (status) {
      case 'Accepted for Reconstruction':
        return {
          bg: 'bg-emerald-950/80',
          border: 'border-emerald-600/80',
          text: 'text-emerald-300',
          badge: 'bg-emerald-500 text-slate-950',
        };
      case 'Targeted Recapture Required':
        return {
          bg: 'bg-amber-950/80',
          border: 'border-amber-600/80',
          text: 'text-amber-300',
          badge: 'bg-amber-500 text-slate-950',
        };
      default:
        return {
          bg: 'bg-red-950/80',
          border: 'border-red-600/80',
          text: 'text-red-300',
          badge: 'bg-red-500 text-white',
        };
    }
  };

  const statusStyle = activeScore ? getStatusColor(activeScore.status) : getStatusColor('Recapture Recommended');

  // Export Quality Audit Report
  const handleExportAuditReport = () => {
    if (!activeScore || !activeRoom) return;

    const reportContent = `
========================================================================
  DART-TWIN CAPTURE QUALITY INSPECTION AUDIT REPORT
  Namma Space — Enterprise Spatial Computing Platform
========================================================================

ROOM SPECIFICATION:
  - Room Identifier: ${activeRoom.id}
  - Room Title: ${activeRoom.name}
  - Room Category: ${activeRoom.category}
  - Physical Dimensions: L=${activeRoom.lengthMeters.toFixed(2)}m, W=${activeRoom.widthMeters.toFixed(2)}m, H=${activeRoom.heightMeters.toFixed(2)}m
  - Floor Area: ${(activeRoom.lengthMeters * activeRoom.widthMeters).toFixed(1)} m²
  - Coordinate Origin Datum: ${activeRoom.originDescription}

DART QUALITY GATE VERDICT:
  - Overall DART Score: ${activeScore.totalScore} / 100 Points
  - Acceptance Status: ${activeScore.status.toUpperCase()}
  - Configurable Thresholds: Accepted >= ${thresholds.accepted}, Targeted Recapture >= ${thresholds.targetedRecapture}

CATEGORY BREAKDOWN & EVIDENCE LEDGER:
------------------------------------------------------------------------
1. Coverage & Occlusion Review (${activeScore.categories.coverage.earnedPoints} / 40 Points):
   ${activeScore.categories.coverage.evidence.map((e) => `[PASS] ${e}`).join('\n   ')}
   ${activeScore.categories.coverage.deductions.map((d) => `[DEDUCTION] ${d}`).join('\n   ')}
   ${activeScore.categories.coverage.missingChecks.map((m) => `[MISSING] ${m}`).join('\n   ')}

2. Doorway Continuity (${activeScore.categories.doorway.earnedPoints} / 25 Points):
   ${activeScore.categories.doorway.evidence.map((e) => `[PASS] ${e}`).join('\n   ')}
   ${activeScore.categories.doorway.deductions.map((d) => `[DEDUCTION] ${d}`).join('\n   ')}
   ${activeScore.categories.doorway.missingChecks.map((m) => `[MISSING] ${m}`).join('\n   ')}

3. Measured-Dimension Agreement (${activeScore.categories.dimension.earnedPoints} / 20 Points):
   ${activeScore.categories.dimension.evidence.map((e) => `[PASS] ${e}`).join('\n   ')}
   ${activeScore.categories.dimension.deductions.map((d) => `[DEDUCTION] ${d}`).join('\n   ')}
   ${activeScore.categories.dimension.missingChecks.map((m) => `[MISSING] ${m}`).join('\n   ')}

4. Image Sharpness, Exposure & Overlap (${activeScore.categories.imageQuality.earnedPoints} / 15 Points):
   ${activeScore.categories.imageQuality.evidence.map((e) => `[PASS] ${e}`).join('\n   ')}
   ${activeScore.categories.imageQuality.deductions.map((d) => `[DEDUCTION] ${d}`).join('\n   ')}
   ${activeScore.categories.imageQuality.missingChecks.map((m) => `[MISSING] ${m}`).join('\n   ')}

RECOMMENDATIONS FOR FIELD OPERATOR:
${activeScore.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}

REVIEWER METADATA:
  - Reviewed By: ${reviewerName}
  - Audit Date: ${new Date().toISOString().substring(0, 10)}
  - Reviewer Notes: ${reviewerNotes}

DISCLAIMER:
  DART (Doorway-Anchored Repeatable Twin) is an evidence-based engineering
  metric developed for indoor spatial photogrammetry and scale verification.
========================================================================
`;

    const blob = new Blob([reportContent.trim()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DART_Quality_Audit_${activeRoom.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              Quality Assurance Gate
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">100-Point DART Evidence Engine</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            DART Capture Quality Inspector
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            A transparent four-pillar quality gate that determines whether an indoor space has sufficient coverage, scale calibration, and doorway continuity to proceed to 3D reconstruction.
          </p>
        </div>

        <button
          onClick={handleExportAuditReport}
          className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono text-xs rounded-lg transition shadow"
        >
          <FileText className="w-4 h-4 text-cyan-400" />
          <span>Export Audit Certificate</span>
        </button>
      </div>

      {/* View Switcher: System Audit vs Room-by-room DART scores */}
      <div className="flex flex-wrap items-center gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl w-fit font-mono text-xs">
        <button
          onClick={() => setViewMode('system_audit')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
            viewMode === 'system_audit'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Award className="w-4 h-4 text-emerald-400" />
          <span>System Quality Gate: 10-Point Verification Audit</span>
        </button>
        <button
          onClick={() => setViewMode('room_dart')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
            viewMode === 'room_dart'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span>Room-by-Room DART Quality Score</span>
        </button>
      </div>

      {viewMode === 'system_audit' && (
        <TechfestQualityAuditCard />
      )}

      {viewMode === 'room_dart' && (
        <div className="space-y-8">
      {/* Room Tabs & Metric Definition Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-xl p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400 mr-1">Inspect Room:</span>
          {rooms.map((room) => {
            const rScore = scores[room.id];
            const isSelected = room.id === activeRoomId;
            return (
              <button
                key={room.id}
                onClick={() => setActiveRoomId(room.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                  isSelected
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <span>{room.id}</span>
                <span className="text-[10px] text-slate-500 truncate max-w-[120px]">{room.name}</span>
                <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-300 font-bold">
                  {rScore?.totalScore ?? '--'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
          <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
          <span>DART is a project-defined metric rather than an industry-standard benchmark.</span>
        </div>
      </div>

      {/* Verdict & Score Banner */}
      {activeScore && (
        <div className={`${statusStyle.bg} border ${statusStyle.border} rounded-2xl p-6 shadow-xl relative overflow-hidden`}>
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
            {/* Left: Score Gauge */}
            <div className="flex items-center gap-6">
              <div className="relative flex items-center justify-center">
                <div className="w-24 h-24 rounded-full border-4 border-slate-800 flex flex-col items-center justify-center bg-slate-950/80 shadow-inner">
                  <span className="text-3xl font-black font-mono text-white tracking-tight">
                    {activeScore.totalScore}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">/ 100 PTS</span>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold tracking-wider uppercase ${statusStyle.badge}`}>
                    {activeScore.status}
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Room: <strong className="text-white">{activeRoom.id} — {activeRoom.name}</strong>
                  </span>
                </div>
                <h2 className="text-xl font-bold text-white mt-1.5">
                  {activeScore.totalScore >= thresholds.accepted
                    ? 'Photogrammetric Criteria Satisfied for Dense 3D Reconstruction'
                    : activeScore.totalScore >= thresholds.targetedRecapture
                    ? 'Targeted Supplemental Frames Required Prior to Reconstruction'
                    : 'Insufficient Capture Density: Reshoot Recommended'}
                </h2>
                <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
                  Calculated across 4 engineering pillars: 40 pts Coverage, 25 pts Doorways, 20 pts Metric Scale, and 15 pts Image Fidelity.
                </p>
              </div>
            </div>

            {/* Right: Quick Stats */}
            <div className="grid grid-cols-2 gap-3 text-xs font-mono w-full md:w-auto">
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="text-slate-500 text-[10px] block">PHOTOS REGISTERED</span>
                <span className="text-white font-bold">{roomPhotos.length} Frames</span>
              </div>
              <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                <span className="text-slate-500 text-[10px] block">DOORWAY CONTINUITY</span>
                <span className="text-emerald-400 font-bold">
                  {activeScore.categories.doorway.earnedPoints} / 25 Pts
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4 Pillars Evidence Ledgers Grid */}
      {activeScore && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pillar 1: Coverage and Occlusion (40 pts) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm font-mono text-white">
                    1. Coverage & Occlusion Review
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400">Pass A Perimeter • Pass B Diagonals • Pass C Close-ups</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-black font-mono text-cyan-300">
                  {activeScore.categories.coverage.earnedPoints}
                </span>
                <span className="text-xs font-mono text-slate-500"> / 40 PTS</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all"
                style={{ width: `${(activeScore.categories.coverage.earnedPoints / 40) * 100}%` }}
              />
            </div>

            {/* Evidence & Deductions */}
            <div className="space-y-2 text-xs">
              <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">Documented Evidence:</div>
              <div className="space-y-1.5">
                {activeScore.categories.coverage.evidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-slate-300 bg-slate-950/50 p-2 rounded border border-slate-800/80">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{ev}</span>
                  </div>
                ))}
              </div>

              {activeScore.categories.coverage.deductions.length > 0 && (
                <>
                  <div className="font-mono text-[11px] text-red-400 uppercase tracking-wider pt-1">Identified Deductions:</div>
                  <div className="space-y-1">
                    {activeScore.categories.coverage.deductions.map((ded, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-300 bg-red-950/30 p-2 rounded border border-red-900/40">
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{ded}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Pillar 2: Doorway Continuity (25 pts) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-950 text-amber-400 border border-amber-800">
                  <DoorOpen className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm font-mono text-white">
                    2. Doorway Continuity
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400">Aperture Geometry • Reciprocal Observations • Pass C Transit</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-black font-mono text-amber-300">
                  {activeScore.categories.doorway.earnedPoints}
                </span>
                <span className="text-xs font-mono text-slate-500"> / 25 PTS</span>
              </div>
            </div>

            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-amber-500 h-full rounded-full transition-all"
                style={{ width: `${(activeScore.categories.doorway.earnedPoints / 25) * 100}%` }}
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">Documented Evidence:</div>
              <div className="space-y-1.5">
                {activeScore.categories.doorway.evidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-slate-300 bg-slate-950/50 p-2 rounded border border-slate-800/80">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{ev}</span>
                  </div>
                ))}
              </div>

              {activeScore.categories.doorway.deductions.length > 0 && (
                <>
                  <div className="font-mono text-[11px] text-red-400 uppercase tracking-wider pt-1">Identified Deductions:</div>
                  <div className="space-y-1">
                    {activeScore.categories.doorway.deductions.map((ded, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-300 bg-red-950/30 p-2 rounded border border-red-900/40">
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{ded}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Pillar 3: Measured-Dimension Agreement (20 pts) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-950 text-blue-400 border border-blue-800">
                  <Ruler className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm font-mono text-white">
                    3. Measured-Dimension Agreement
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400">Ground Truth Tape vs Photogrammetric Scale Disparity</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-black font-mono text-blue-300">
                  {activeScore.categories.dimension.earnedPoints}
                </span>
                <span className="text-xs font-mono text-slate-500"> / 20 PTS</span>
              </div>
            </div>

            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-blue-500 h-full rounded-full transition-all"
                style={{ width: `${(activeScore.categories.dimension.earnedPoints / 20) * 100}%` }}
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">Documented Evidence:</div>
              <div className="space-y-1.5">
                {activeScore.categories.dimension.evidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-slate-300 bg-slate-950/50 p-2 rounded border border-slate-800/80">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{ev}</span>
                  </div>
                ))}
              </div>

              {activeScore.categories.dimension.deductions.length > 0 && (
                <>
                  <div className="font-mono text-[11px] text-red-400 uppercase tracking-wider pt-1">Identified Deductions:</div>
                  <div className="space-y-1">
                    {activeScore.categories.dimension.deductions.map((ded, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-300 bg-red-950/30 p-2 rounded border border-red-900/40">
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{ded}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Pillar 4: Image Sharpness, Exposure & Overlap (15 pts) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm font-mono text-white">
                    4. Image Sharpness, Exposure & Overlap
                  </h3>
                  <span className="text-[10px] font-mono text-slate-400">SIFT Feature Sharpness • Histogram Balance • &gt;=70% Overlap</span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-base font-black font-mono text-emerald-300">
                  {activeScore.categories.imageQuality.earnedPoints}
                </span>
                <span className="text-xs font-mono text-slate-500"> / 15 PTS</span>
              </div>
            </div>

            <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all"
                style={{ width: `${(activeScore.categories.imageQuality.earnedPoints / 15) * 100}%` }}
              />
            </div>

            <div className="space-y-2 text-xs">
              <div className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">Documented Evidence:</div>
              <div className="space-y-1.5">
                {activeScore.categories.imageQuality.evidence.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-slate-300 bg-slate-950/50 p-2 rounded border border-slate-800/80">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{ev}</span>
                  </div>
                ))}
              </div>

              {activeScore.categories.imageQuality.deductions.length > 0 && (
                <>
                  <div className="font-mono text-[11px] text-red-400 uppercase tracking-wider pt-1">Identified Deductions:</div>
                  <div className="space-y-1">
                    {activeScore.categories.imageQuality.deductions.map((ded, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-300 bg-red-950/30 p-2 rounded border border-red-900/40">
                        <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                        <span>{ded}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recommendations & Human Reviewer Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recommendations */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400" />
            <span>OPERATIONAL RECONSTRUCTION RECOMMENDATIONS</span>
          </h3>
          <p className="text-xs text-slate-400">
            Actionable guidance generated directly from category deductions and missing checks:
          </p>

          <div className="space-y-2 text-xs font-mono">
            {activeScore?.recommendations.map((rec, idx) => (
              <div key={idx} className="p-2.5 rounded bg-slate-950/60 border border-slate-800 text-slate-200 flex items-start gap-2">
                <span className="text-cyan-400 font-bold">{idx + 1}.</span>
                <span>{rec}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Human Reviewer Sign-Off Box */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-cyan-400" />
            <span>HUMAN REVIEWER AUDIT & NOTES</span>
          </h3>
          <p className="text-xs text-slate-400">
            Record manual inspections, visual feature checks, or physical tape measurements that supplement automated metrics.
          </p>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Lead Reviewer</label>
              <input
                type="text"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white"
              />
            </div>
            <div>
              <label className="text-slate-400 block mb-1">Reviewer Field Evaluation Notes</label>
              <textarea
                rows={2}
                value={reviewerNotes}
                onChange={(e) => setReviewerNotes(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-1.5 text-white font-sans text-xs"
              />
            </div>
            <button
              onClick={() => onUpdateReviewerNotes(activeRoomId, reviewerName, reviewerNotes)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded text-xs transition"
            >
              Save Reviewer Audit Note
            </button>
          </div>
        </div>
      </div>
        </div>
      )}
    </div>
  );
};
