import React, { useState } from 'react';
import {
  FolderOpen,
  Plus,
  Box,
  Camera,
  Clock,
  AlertTriangle,
  Search,
  Filter,
  Sparkles,
} from 'lucide-react';
import { NammaProject, SpaceType, ProjectStatus } from '../types/dart';
import { ActiveTab } from './Navbar';

interface SpacesLibraryViewProps {
  projects: NammaProject[];
  currentProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenCreateProjectModal: () => void;
  onNavigate: (tab: ActiveTab) => void;
  onDeleteProject?: (id: string) => void;
}

export const SpacesLibraryView: React.FC<SpacesLibraryViewProps> = ({
  projects,
  currentProjectId,
  onSelectProject,
  onOpenCreateProjectModal,
  onNavigate,
  onDeleteProject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');

  // Filter projects
  const filteredProjects = projects.filter((proj) => {
    const matchesSearch =
      proj.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proj.startingAnchor.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = selectedType === 'All' || proj.spaceType === selectedType;
    const matchesStatus = selectedStatus === 'All' || proj.status === selectedStatus;

    return matchesSearch && matchesType && matchesStatus;
  });

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-emerald-950/70 text-emerald-400 border border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Ready for Walkthrough</span>
          </span>
        );
      case 'Processing':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-cyan-950/70 text-cyan-400 border border-cyan-800">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>SfM Reconstruction</span>
          </span>
        );
      case 'Ready for Upload':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-950/70 text-amber-400 border border-amber-800">
            <Clock className="w-3 h-3" />
            <span>Awaiting Ingestion</span>
          </span>
        );
      case 'Failed':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-red-950/70 text-red-400 border border-red-800">
            <AlertTriangle className="w-3 h-3" />
            <span>Quality Gate Failed</span>
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-slate-800 text-slate-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider">
              Namma Space • Spatial Registry
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">Enterprise Spatial Computing</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            Indoor Spaces &amp; Digital Twin Library
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
            Browse, manage, and launch captured 3D spaces. All models feature calibrated SI metric scale, first-person navigation, and doorway loop closures.
          </p>
        </div>

        <button
          onClick={onOpenCreateProjectModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-orange-950/60 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Space Project</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search spaces by name, anchor, or details..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>Type:</span>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
            >
              <option value="All">All Types</option>
              <option value="Apartment">Apartment</option>
              <option value="Living Room">Living Room</option>
              <option value="Bedroom">Bedroom</option>
              <option value="Custom">Custom / Lab</option>
              <option value="Corridor">Corridor</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
            <span>Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
            >
              <option value="All">All Statuses</option>
              <option value="Completed">Ready (Completed)</option>
              <option value="Processing">Processing</option>
              <option value="Ready for Upload">Ready for Upload</option>
              <option value="Failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Spaces Catalog Grid */}
      {filteredProjects.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400">
            <FolderOpen className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">No spaces yet</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Upload a few photos of a room and Namma Space will build your own walkable 3D model.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => onNavigate('landing')}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition"
            >
              <Camera className="w-4 h-4" />
              <span>Upload Photos</span>
            </button>
            <button
              onClick={onOpenCreateProjectModal}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded-xl border border-slate-700 transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Empty Space</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {filteredProjects.map((proj) => {
          const isSelected = proj.id === currentProjectId;

          return (
            <div
              key={proj.id}
              className={`rounded-2xl border transition p-6 flex flex-col justify-between space-y-5 ${
                isSelected
                  ? 'bg-slate-900 border-orange-500/80 ring-1 ring-orange-500/30'
                  : 'bg-slate-900/70 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-950 text-cyan-300 border border-cyan-800">
                        {proj.spaceType}
                      </span>
                      <span className="text-slate-500 text-xs font-mono">ID: {proj.id}</span>
                    </div>
                    <h3 className="text-lg font-bold text-white mt-1.5 flex items-center gap-2">
                      <span>{proj.name}</span>
                      {isSelected && (
                        <span className="text-[10px] font-mono font-normal text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded">
                          Active Project
                        </span>
                      )}
                    </h3>
                  </div>

                  {getStatusBadge(proj.status)}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  {proj.description}
                </p>

                {/* Metric Specs Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-slate-950/80 p-3 rounded-xl border border-slate-800/80">
                  <div>
                    <span className="text-slate-500 text-[10px] block">Rooms</span>
                    <span className="text-white font-bold">{proj.roomCount} Connected</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">Floor Area</span>
                    <span className="text-white font-bold">{proj.floorArea || '--'} m²</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">Ceiling H</span>
                    <span className="text-white font-bold">{proj.ceilingHeight || 2.85} m</span>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px] block">Photos</span>
                    <span className="text-cyan-400 font-bold">{proj.photoCount} Ingested</span>
                  </div>
                </div>

                {/* Starting Datum & Reference */}
                <div className="text-xs font-mono space-y-1 text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/50">
                  <div className="flex items-center gap-1.5">
                    <span className="text-cyan-400 font-bold">Starting Anchor:</span>
                    <span className="text-slate-200 truncate">{proj.startingAnchor}</span>
                  </div>
                  {proj.referenceMeasurement && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-orange-400 font-bold">Laser Datum:</span>
                      <span className="text-slate-200 truncate">{proj.referenceMeasurement}</span>
                    </div>
                  )}
                </div>

                {/* Model stats if completed. Older metric-twin projects only
                    have triangle metrics; photoreal scans have splat/camera data. */}
                {proj.reconstructionModelStats &&
                  (proj.reconstructionModelStats.jobStatus === 'queued' ||
                    proj.reconstructionModelStats.jobStatus === 'running') && (
                    <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-300 pt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      <span>Photoreal scan running…</span>
                    </div>
                  )}
                {proj.reconstructionModelStats &&
                  proj.reconstructionModelStats.jobStatus !== 'queued' &&
                  proj.reconstructionModelStats.jobStatus !== 'running' && (
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-mono text-slate-400 pt-1">
                      <span>
                        {Number(proj.reconstructionModelStats.splatCount || 0) > 0 ? (
                          <>
                            Splats:{' '}
                            <strong className="text-cyan-300">
                              {Number(proj.reconstructionModelStats.splatCount).toLocaleString()}
                            </strong>
                          </>
                        ) : (
                          <>
                            Points:{' '}
                            <strong className="text-slate-200">
                              {Number(
                                proj.reconstructionModelStats.pointCloudCount ||
                                  proj.reconstructionModelStats.sparsePoints ||
                                  proj.reconstructionModelStats.vertexCount ||
                                  0
                              ).toLocaleString()}
                            </strong>
                          </>
                        )}
                      </span>
                      {typeof proj.reconstructionModelStats.registeredImages === 'number' && (
                        <span>
                          Cameras:{' '}
                          <strong className="text-slate-200">
                            {proj.reconstructionModelStats.registeredImages}/
                            {proj.reconstructionModelStats.inputImages || '?'}
                          </strong>
                        </span>
                      )}
                      {typeof proj.reconstructionModelStats.reprojectionErrorPx === 'number' && (
                        <span>
                          Reprojection:{' '}
                          <strong className="text-cyan-400">
                            {proj.reconstructionModelStats.reprojectionErrorPx.toFixed(2)}px
                          </strong>
                        </span>
                      )}
                      {typeof proj.reconstructionModelStats.scaleDisparityPercent === 'number' && (
                        <span>
                          Scale Disparity:{' '}
                          <strong className="text-emerald-400">
                            {proj.reconstructionModelStats.scaleDisparityPercent}%
                          </strong>
                        </span>
                      )}
                      {proj.reconstructionModelStats.jobStatus === 'failed' && (
                        <span className="text-red-400 font-semibold">Scan failed</span>
                      )}
                    </div>
                  )}

                {/* Error message if failed */}
                {proj.lastErrorMessage && (
                  <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-200 font-mono flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{proj.lastErrorMessage}</span>
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
                <div className="text-[10px] font-mono text-slate-500">
                  Updated: {proj.updatedAt}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      onSelectProject(proj.id);
                      onNavigate('sop');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-xs transition"
                  >
                    Inspect Captures
                  </button>

                  {proj.status === 'Completed' ? (
                    <button
                      onClick={() => {
                        onSelectProject(proj.id);
                        onNavigate('viewer');
                      }}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold font-mono text-xs uppercase tracking-wider transition shadow-md shadow-cyan-950/60"
                    >
                      <Box className="w-3.5 h-3.5" />
                      <span>Launch 3D</span>
                    </button>
                  ) : proj.status === 'Processing' ? (
                    <button
                      onClick={() => {
                        onSelectProject(proj.id);
                        onNavigate('reconstruction');
                      }}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-600/80 text-white font-mono text-xs transition"
                    >
                      <Sparkles className="w-3.5 h-3.5 animate-spin" />
                      <span>View Progress</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        onSelectProject(proj.id);
                        onNavigate('reconstruction');
                      }}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 font-bold font-mono text-xs transition"
                    >
                      <span>Start Pipeline</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
