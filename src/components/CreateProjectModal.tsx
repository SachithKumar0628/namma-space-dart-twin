import React, { useState } from 'react';
import { NammaProject, SpaceType, MeasurementUnit, CaptureMethod } from '../types/dart';
import {
  X,
  Plus,
  Compass,
  Ruler,
  Camera,
  Video,
  Layers,
  Sparkles,
  CheckCircle2,
  DoorOpen,
  Info,
} from 'lucide-react';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (project: NammaProject) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onCreateProject,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [spaceType, setSpaceType] = useState<SpaceType>('Bedroom');
  const [roomCount, setRoomCount] = useState<number>(2);
  const [units, setUnits] = useState<MeasurementUnit>('metres');
  const [floorArea, setFloorArea] = useState<string>('24.5');
  const [ceilingHeight, setCeilingHeight] = useState<string>('2.85');
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('Still Photos Loop');
  const [startingAnchor, setStartingAnchor] = useState('Main Doorway D01 (South wall)');
  const [referenceMeasurement, setReferenceMeasurement] = useState('North wall: 4.85m ± 2mm');
  const [hasFloorPlan, setHasFloorPlan] = useState(false);
  const [floorPlanName, setFloorPlanName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newProject: NammaProject = {
      id: `proj_${Date.now()}`,
      name: name.trim(),
      description: description.trim() || `Captured ${spaceType} space with ${roomCount} room(s).`,
      spaceType,
      roomCount,
      units,
      floorArea: floorArea ? parseFloat(floorArea) : undefined,
      ceilingHeight: ceilingHeight ? parseFloat(ceilingHeight) : 2.85,
      captureMethod,
      status: 'Ready for Upload',
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      photoCount: 0,
      videoCount: captureMethod === 'Walkthrough Video Frames' ? 1 : 0,
      hasFloorPlan,
      floorPlanName: hasFloorPlan ? (floorPlanName || 'floor_plan.pdf') : undefined,
      startingAnchor: startingAnchor.trim() || 'Entrance Doorway D01',
      referenceMeasurement: referenceMeasurement.trim() || undefined,
      reconstructionEngine: 'Calibrated Geometric Twin',
      reconstructionProgress: 0,
    };

    onCreateProject(newProject);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-orange-400 font-bold">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <span>CREATE NEW SPACE PROJECT</span>
                <span className="text-[10px] font-sans font-semibold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                  LoopAnchor Protocol
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Register space boundaries, units, and starting anchors before capturing evidence.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs text-slate-200">
          {/* Project Name & Description */}
          <div className="space-y-3">
            <div>
              <label className="block text-slate-300 font-mono font-medium mb-1">
                Project / Space Name <span className="text-orange-400">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Master Bedroom &amp; Study, 2BHK Apartment, Robotics Lab"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-mono font-medium mb-1">
                Description / Location Notes
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the environment, lighting conditions, and known physical constraints..."
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>
          </div>

          {/* Space Type & Number of Rooms */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-mono font-medium mb-1">
                Space Category
              </label>
              <select
                value={spaceType}
                onChange={(e) => setSpaceType(e.target.value as SpaceType)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 text-xs font-mono"
              >
                <option value="Bedroom">Bedroom / Private Room</option>
                <option value="Living Room">Living Room / Hall</option>
                <option value="Apartment">Full Apartment / Floor</option>
                <option value="Office">Office / Study Room</option>
                <option value="Corridor">Corridor / Hallway</option>
                <option value="Custom">Custom / Lab Facility</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-mono font-medium mb-1">
                Approximate Connected Rooms
              </label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setRoomCount(count)}
                    className={`flex-1 py-2 rounded-lg font-mono text-xs font-bold border transition ${
                      roomCount === count
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {count} {count === 4 ? '4+' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Units, Area, Ceiling Height */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl">
            <div>
              <label className="block text-slate-400 font-mono text-[11px] mb-1">
                Measurement Units
              </label>
              <div className="flex rounded-lg overflow-hidden border border-slate-800">
                <button
                  type="button"
                  onClick={() => setUnits('metres')}
                  className={`flex-1 py-1.5 font-mono text-xs font-bold transition ${
                    units === 'metres'
                      ? 'bg-cyan-600 text-slate-950'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Metres (m)
                </button>
                <button
                  type="button"
                  onClick={() => setUnits('feet')}
                  className={`flex-1 py-1.5 font-mono text-xs font-bold transition ${
                    units === 'feet'
                      ? 'bg-cyan-600 text-slate-950'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  Feet (ft)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 font-mono text-[11px] mb-1">
                Total Floor Area ({units === 'metres' ? 'm²' : 'sq ft'})
              </label>
              <input
                type="number"
                step="0.1"
                value={floorArea}
                onChange={(e) => setFloorArea(e.target.value)}
                placeholder="e.g. 28.5"
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-cyan-500 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-mono text-[11px] mb-1">
                Ceiling Height ({units === 'metres' ? 'm' : 'ft'})
              </label>
              <input
                type="number"
                step="0.05"
                value={ceilingHeight}
                onChange={(e) => setCeilingHeight(e.target.value)}
                placeholder="e.g. 2.85"
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-slate-100 focus:outline-none focus:border-cyan-500 text-xs font-mono"
              />
            </div>
          </div>

          {/* Capture Method Selection */}
          <div>
            <label className="block text-slate-300 font-mono font-medium mb-1.5">
              Capture Method Selection
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Option 1 */}
              <div
                onClick={() => setCaptureMethod('Still Photos Loop')}
                className={`p-3 rounded-xl border cursor-pointer transition select-none ${
                  captureMethod === 'Still Photos Loop'
                    ? 'bg-orange-500/15 border-orange-500 text-white shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Camera className={`w-4 h-4 ${captureMethod === 'Still Photos Loop' ? 'text-orange-400' : 'text-slate-400'}`} />
                  <span className="font-mono font-bold text-xs">Still Photos Loop</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Recommended, time-bounded path. High resolution, crisp corner boundaries.
                </p>
                <span className="inline-block mt-2 text-[10px] font-mono text-orange-400">
                  (Recommended Primary)
                </span>
              </div>

              {/* Option 2 */}
              <div
                onClick={() => setCaptureMethod('Walkthrough Video Frames')}
                className={`p-3 rounded-xl border cursor-pointer transition select-none ${
                  captureMethod === 'Walkthrough Video Frames'
                    ? 'bg-cyan-500/15 border-cyan-500 text-white shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Video className={`w-4 h-4 ${captureMethod === 'Walkthrough Video Frames' ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span className="font-mono font-bold text-xs">Video Walkthrough</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Automatic frame extraction at configurable intervals with blur filtering.
                </p>
                <span className="inline-block mt-2 text-[10px] font-mono text-cyan-400">
                  (Automated Ingestion)
                </span>
              </div>

              {/* Option 3 */}
              <div
                onClick={() => setCaptureMethod('Hybrid Multi-Modal')}
                className={`p-3 rounded-xl border cursor-pointer transition select-none ${
                  captureMethod === 'Hybrid Multi-Modal'
                    ? 'bg-emerald-500/15 border-emerald-500 text-white shadow-sm'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Layers className={`w-4 h-4 ${captureMethod === 'Hybrid Multi-Modal' ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span className="font-mono font-bold text-xs">Hybrid Multi-Modal</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Photos + video extraction + laser reference scale datum + floor plan CAD.
                </p>
                <span className="inline-block mt-2 text-[10px] font-mono text-emerald-400">
                  (Maximum Fidelity)
                </span>
              </div>
            </div>
          </div>

          {/* Metric Anchoring Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-slate-300 font-mono text-xs mb-1 flex items-center gap-1.5">
                <DoorOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Starting Doorway / Anchor</span>
              </label>
              <input
                type="text"
                value={startingAnchor}
                onChange={(e) => setStartingAnchor(e.target.value)}
                placeholder="e.g. Entrance Doorway D01 (South wall)"
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-mono text-xs mb-1 flex items-center gap-1.5">
                <Ruler className="w-3.5 h-3.5 text-orange-400" />
                <span>Known Reference Measurement</span>
              </label>
              <input
                type="text"
                value={referenceMeasurement}
                onChange={(e) => setReferenceMeasurement(e.target.value)}
                placeholder="e.g. North wall length: 4.85m ± 2mm"
                className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500 text-xs font-mono"
              />
            </div>
          </div>

          {/* Floor Plan Attachment checkbox */}
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="hasFloorPlan"
                checked={hasFloorPlan}
                onChange={(e) => setHasFloorPlan(e.target.checked)}
                className="w-4 h-4 rounded text-orange-500 focus:ring-0 bg-slate-900 border-slate-700 cursor-pointer"
              />
              <label htmlFor="hasFloorPlan" className="cursor-pointer">
                <span className="font-mono text-xs text-slate-200 block font-bold">
                  Attach Floor Plan Reference (Image / PDF / CAD)
                </span>
                <span className="text-[11px] text-slate-400">
                  Assists 3D scale verification and provides visual top-down orientation.
                </span>
              </label>
            </div>
            {hasFloorPlan && (
              <input
                type="text"
                value={floorPlanName}
                onChange={(e) => setFloorPlanName(e.target.value)}
                placeholder="floor_plan.pdf"
                className="w-44 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-slate-200 text-xs font-mono"
              />
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-mono transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition shadow-lg shadow-orange-950/60"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Initialize Project &amp; Begin Capture</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
