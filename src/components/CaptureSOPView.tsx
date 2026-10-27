import React, { useState } from 'react';
import { SOPCheckItem, CapturePass } from '../types/dart';
import {
  CheckSquare,
  Square,
  Camera,
  DoorOpen,
  Ruler,
  Layers,
  Info,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

interface CaptureSOPViewProps {
  checklist: SOPCheckItem[];
  onToggleCheckItem: (id: string) => void;
  onResetChecklist: () => void;
}

export const CaptureSOPView: React.FC<CaptureSOPViewProps> = ({
  checklist,
  onToggleCheckItem,
  onResetChecklist,
}) => {
  const [selectedPass, setSelectedPass] = useState<'All' | 'General' | CapturePass>('All');

  const filteredChecklist = checklist.filter((item) =>
    selectedPass === 'All' ? true : item.pass === selectedPass
  );

  const completedCount = checklist.filter((i) => i.completed).length;
  const totalCount = checklist.length;
  const progressPercent = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              Field Capture Protocol
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">DART Standard Operating Procedure</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            Three-Pass Doorway-Anchored Capture SOP
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">
            A defensible, reproducible field capture protocol designed to maximize photogrammetric feature tracking, resolve occlusions, and establish scale-calibrated coordinate continuity across rooms.
          </p>
        </div>

        {/* Progress Pill */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-4">
          <div>
            <div className="text-[11px] font-mono text-slate-400 uppercase">SOP Protocol Progress</div>
            <div className="text-lg font-black font-mono text-cyan-300">
              {completedCount}/{totalCount} <span className="text-xs font-normal text-slate-500">checks ({progressPercent}%)</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-full border-2 border-slate-800 flex items-center justify-center font-mono text-xs font-bold text-cyan-400 bg-slate-950">
            {progressPercent}%
          </div>
        </div>
      </div>

      {/* Protocol Visual Overview (Cards for 3 Passes + Doorway Datum) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Pass A */}
        <div className="bg-slate-900/90 border border-cyan-800/60 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[11px] font-mono font-bold">
              Pass A: Perimeter
            </span>
            <span className="text-[10px] font-mono text-slate-400">&gt;= 70% Overlap</span>
          </div>
          <h4 className="font-bold text-sm text-white">Structural Boundary Sweep</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Clockwise walk capturing all wall corners, floor-to-ceiling boundaries, windows, and door frames at normal standing height.
          </p>
          <div className="text-[11px] font-mono text-cyan-400/90 pt-1">
            Focus: Macro geometry & corners
          </div>
        </div>

        {/* Pass B */}
        <div className="bg-slate-900/90 border border-blue-800/60 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[11px] font-mono font-bold">
              Pass B: Diagonal
            </span>
            <span className="text-[10px] font-mono text-slate-400">45° Trajectory</span>
          </div>
          <h4 className="font-bold text-sm text-white">Occlusion & Interior Sweep</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Cross-room diagonal views capturing furniture faces, under-bench voids, equipment shadows, and blindspots.
          </p>
          <div className="text-[11px] font-mono text-blue-300/90 pt-1">
            Focus: Parallax & shadow mitigation
          </div>
        </div>

        {/* Pass C */}
        <div className="bg-slate-900/90 border border-amber-800/60 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[11px] font-mono font-bold">
              Pass C: Continuity
            </span>
            <span className="text-[10px] font-mono text-slate-400">Step-Through</span>
          </div>
          <h4 className="font-bold text-sm text-white">Doorway Anchor Transit</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Continuous sequence stepping across the door threshold to bridge visual feature graphs between Room A and Room B.
          </p>
          <div className="text-[11px] font-mono text-amber-300/90 pt-1">
            Focus: Inter-room loop closure
          </div>
        </div>

        {/* Metric Datum */}
        <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-mono font-bold">
              Physical Datum
            </span>
            <span className="text-[10px] font-mono text-emerald-400">Tape / Laser</span>
          </div>
          <h4 className="font-bold text-sm text-white">Ground Truth Scale</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Record physical tape measurements of room L, W, H, plus doorway aperture width and height with millimeter precision.
          </p>
          <div className="text-[11px] font-mono text-slate-300 pt-1">
            Focus: Absolute SI meter calibration
          </div>
        </div>
      </div>

      {/* Field Best Practices Checklist & Technical Requirements */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Interactive SOP Checklist */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-cyan-400" />
                <span>FIELD OPERATOR VERIFICATION CHECKLIST</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Check off tasks as completed during on-site environment capture.
              </p>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs font-mono">
              {(['All', 'General', 'Pass A', 'Pass B', 'Pass C'] as const).map((pass) => (
                <button
                  key={pass}
                  onClick={() => setSelectedPass(pass)}
                  className={`px-2 py-1 rounded transition ${
                    selectedPass === pass
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {pass}
                </button>
              ))}
            </div>
          </div>

          {/* Checklist Items */}
          <div className="space-y-3">
            {filteredChecklist.map((item) => (
              <div
                key={item.id}
                onClick={() => onToggleCheckItem(item.id)}
                className={`p-3.5 rounded-lg border transition cursor-pointer flex items-start gap-3 select-none ${
                  item.completed
                    ? 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700'
                    : 'bg-slate-900 border-cyan-900/40 hover:border-cyan-700/60'
                }`}
              >
                <button
                  type="button"
                  aria-label={`Toggle ${item.title}`}
                  className="mt-0.5 text-cyan-400 shrink-0"
                >
                  {item.completed ? (
                    <CheckSquare className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-500" />
                  )}
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-xs ${item.completed ? 'text-slate-300 line-through' : 'text-white'}`}>
                      {item.title}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                      {item.ruleReference}
                    </span>
                    {item.critical && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                        CRITICAL
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800/80">
            <button
              onClick={onResetChecklist}
              className="text-xs font-mono text-slate-400 hover:text-slate-200 transition"
            >
              Reset Checklist to Initial Benchmark
            </button>
          </div>
        </div>

        {/* Right Col: Optical & Rig Requirements */}
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2 border-b border-slate-800 pb-2">
              <Camera className="w-4 h-4 text-cyan-400" />
              <span>OPTICAL SETTINGS RULES</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                <strong className="text-cyan-300 block mb-0.5 font-mono">1. Fixed Exposure & White Balance</strong>
                <p className="text-slate-400 leading-relaxed">
                  Lock ISO (ISO 100 or 200) and White Balance (5000K or match interior fluorescent). Disable auto-exposure to prevent photometric inconsistency during SIFT descriptor computation.
                </p>
              </div>

              <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                <strong className="text-cyan-300 block mb-0.5 font-mono">2. Depth of Field (f/5.6 - f/8)</strong>
                <p className="text-slate-400 leading-relaxed">
                  Maintain moderate aperture to guarantee both foreground door frames and background wall features remain sharp and in focus.
                </p>
              </div>

              <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                <strong className="text-cyan-300 block mb-0.5 font-mono">3. Strict Consecutive Overlap (&gt;= 70%)</strong>
                <p className="text-slate-400 leading-relaxed">
                  Every adjacent frame must share at least 70% common visual area. Do not pivot camera in place like a panorama; step laterally (sidestep) along the perimeter to maintain translation baseline.
                </p>
              </div>

              <div className="bg-slate-950/60 p-2.5 rounded border border-slate-800">
                <strong className="text-cyan-300 block mb-0.5 font-mono">4. Anti-Reflection Mitigation</strong>
                <p className="text-slate-400 leading-relaxed">
                  Avoid capturing direct specular highlights from mirrors or glossy monitor screens. When capturing reflective surfaces, angle camera at 30° or place removable low-tack calibration tape marks.
                </p>
              </div>
            </div>
          </div>

          {/* Doorway Continuity Rule Card */}
          <div className="bg-slate-900/90 border border-amber-900/50 rounded-xl p-5 space-y-2">
            <h4 className="font-bold text-xs font-mono text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <DoorOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Doorway Reciprocity Rule</span>
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              A doorway anchor is only valid when observed from <strong>both adjoining rooms</strong>. In Room A, capture frame P_A facing the door. In Room B, capture reciprocal frame P_B facing back through the door. This creates rigid geometric constraints preventing separate room models from floating detached.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
