import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Box,
  Sparkles,
  Camera,
  ShieldCheck,
  ArrowRight,
  TrendingUp,
  Cpu,
  FileText,
  Play,
  ChevronDown,
  HelpCircle,
  UploadCloud,
  ImagePlus,
  Loader2,
  X,
  CheckCircle2,
} from 'lucide-react';
import { ActiveTab } from './Navbar';
import { CapturePhotoRecord, RoomMetadata } from '../types/dart';

interface LandingPageViewProps {
  onNavigate: (tab: ActiveTab) => void;
  onOpenHowToUse?: () => void;
  photos: CapturePhotoRecord[];
  rooms: RoomMetadata[];
  onUploadPhotos: (
    files: File[],
    onProgress?: (done: number, total: number) => void
  ) => Promise<void>;
}

export const LandingPageView: React.FC<LandingPageViewProps> = ({
  onNavigate,
  onOpenHowToUse,
  photos,
  rooms,
  onUploadPhotos,
}) => {
  const hasUserModel = photos.length > 0;

  const uploadRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Object-URL previews for the picked (not yet uploaded) photos.
  const previews = useMemo(
    () =>
      pendingFiles.slice(0, 8).map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    [pendingFiles]
  );

  useEffect(() => {
    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [previews]);

  const scrollToUpload = () => {
    uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const acceptFiles = (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    setUploadError(null);
    if (images.length === 0) {
      setUploadError('Please choose JPG, PNG or WebP photos.');
      return;
    }
    setPendingFiles(images);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    acceptFiles(event.dataTransfer.files);
  };

  const handleBuildModel = async () => {
    if (pendingFiles.length === 0 || isUploading) return;
    setIsUploading(true);
    setUploadError(null);
    setProgress({ done: 0, total: pendingFiles.length });
    try {
      await onUploadPhotos(pendingFiles, (done, total) => setProgress({ done, total }));
      setPendingFiles([]);
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-12">
      {/* Hero Section with Spatial Computing Aesthetics */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 p-8 md:p-12 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-semibold">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>Upload your photos · Get your own 3D walkthrough</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Turn your photos into a{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400">
              walkable 3D model
            </span>
          </h1>

          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Upload a few photos of your space and explore the generated digital twin right
            in your browser. No app install, no special camera and no 3D software needed.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={scrollToUpload}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-xl shadow-cyan-950/60"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Upload Photos</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {onOpenHowToUse && (
              <button
                onClick={onOpenHowToUse}
                className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 text-amber-300 font-mono font-bold text-xs rounded-xl border border-amber-500/50 transition shadow-lg shadow-amber-950/40"
              >
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>Quick Start Guide</span>
              </button>
            )}

            <button
              onClick={() => onNavigate('sop')}
              className="flex items-center gap-2 px-5 py-3 bg-slate-800 hover:bg-slate-700 text-white font-mono font-semibold text-xs rounded-xl border border-slate-700 transition"
            >
              <Camera className="w-4 h-4 text-orange-400" />
              <span>Open Capture Studio</span>
            </button>
          </div>
        </div>

        {/* Live Architecture Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-10 pt-8 border-t border-slate-800/80">
          <div>
            <div className="text-2xl font-black font-mono text-cyan-400">Real Artifact</div>
            <div className="text-xs text-slate-400 mt-0.5">Photo-derived PLY scene</div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-emerald-400">Browser Viewer</div>
            <div className="text-xs text-slate-400 mt-0.5">Orbit • Zoom • Pan</div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-orange-400">Your Photos</div>
            <div className="text-xs text-slate-400 mt-0.5">Photo → 3D Twin in One Upload</div>
          </div>
          <div>
            <div className="text-2xl font-black font-mono text-purple-400">Quality Gate</div>
            <div className="text-xs text-slate-400 mt-0.5">Capture readiness check</div>
          </div>
        </div>
      </div>

      {/* Upload-first workspace */}
      <div
        ref={uploadRef}
        className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 scroll-mt-24"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider">
              {hasUserModel ? 'Your 3D Model' : 'Start Here'}
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
              {hasUserModel
                ? 'Your uploaded space is ready to explore'
                : 'Upload your photos to create a 3D model'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5 max-w-2xl">
              {hasUserModel
                ? `${photos.length} photo${photos.length === 1 ? '' : 's'} across ${
                    rooms.length
                  } room${rooms.length === 1 ? '' : 's'} — generated from your own capture, not a demo.`
                : 'Pick 6 or more photos of a room from different corners. We analyse each photo, build the rooms, and open a first-person walkthrough.'}
            </p>
          </div>

          {hasUserModel && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onNavigate('sop')}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded-lg border border-slate-700 transition"
              >
                <ImagePlus className="w-3.5 h-3.5 text-orange-400" />
                <span>Add more photos</span>
              </button>
              <button
                onClick={() => onNavigate('viewer')}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold font-mono text-xs uppercase tracking-wider rounded-lg transition"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Open Walkthrough</span>
              </button>
            </div>
          )}
        </div>

        {hasUserModel ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {photos.slice(0, 6).map((photo) => (
                <div
                  key={photo.id}
                  onClick={() => onNavigate('viewer')}
                  className="group bg-slate-950 rounded-xl border border-slate-800 hover:border-cyan-500/60 p-2 transition cursor-pointer"
                >
                  <div className="relative overflow-hidden rounded-lg aspect-video bg-slate-900 border border-slate-800/80">
                    {photo.imageUrl ? (
                  <img
                    src={photo.imageUrl}
                    alt={photo.filename}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                  />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <ImagePlus className="w-5 h-5" />
                      </div>
                    )}
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-950/80 backdrop-blur-sm text-[9px] font-mono font-bold text-cyan-300 border border-cyan-500/30">
                      {(() => {
                        const roomIndex = rooms.findIndex((room) => room.id === photo.roomId);
                        return roomIndex >= 0 ? `R${String(roomIndex + 1).padStart(2, '0')}` : 'Photo';
                      })()}
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                    {photo.filename}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Model generated from your photos. Use the walkthrough controls to move with
                WASD and look around with the mouse.
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr,1fr] gap-5">
            {/* Dropzone */}
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!isUploading) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => !isUploading && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!isUploading) fileInputRef.current?.click();
                }
              }}
              className={`relative rounded-xl border-2 border-dashed p-6 sm:p-8 flex flex-col items-center justify-center text-center transition cursor-pointer min-h-[240px] ${
                isDragging
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-slate-700 bg-slate-950/60 hover:border-cyan-500/60 hover:bg-slate-900/60'
              } ${isUploading ? 'opacity-60 cursor-progress' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                aria-label="Upload photos for your 3D model"
                className="sr-only"
                onChange={(event) => {
                  if (event.target.files) acceptFiles(event.target.files);
                  event.target.value = '';
                }}
              />

              {pendingFiles.length === 0 ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-4">
                    <UploadCloud className="w-7 h-7" />
                  </div>
                  <div className="text-sm sm:text-base font-bold text-white">
                    Drop your photos here
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    or <span className="text-cyan-400 font-semibold">click to choose</span> from
                    your device
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-3">
                    JPG · PNG · WebP — no upload limit
                  </div>
                </>
              ) : (
                <div className="w-full space-y-3 text-left" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-mono font-bold text-cyan-300 uppercase">
                      {pendingFiles.length} photo{pendingFiles.length === 1 ? '' : 's'} selected
                    </div>
                    <button
                      onClick={() => setPendingFiles([])}
                      disabled={isUploading}
                      className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-red-400 transition disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {previews.map((preview) => (
                      <div
                        key={preview.url}
                        className="relative overflow-hidden rounded-lg aspect-square bg-slate-900 border border-slate-800"
                        title={preview.name}
                      >
                        <img
                          src={preview.url}
                          alt={preview.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition disabled:opacity-50"
                  >
                    + Choose different photos
                  </button>
                </div>
              )}
            </div>

            {/* Build panel */}
            <div className="flex flex-col justify-between gap-4 bg-slate-950/60 border border-slate-800 rounded-xl p-5">
              <div className="space-y-3">
                <div className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
                  What happens next
                </div>
                <ol className="space-y-2.5 text-xs text-slate-400">
                  <li className="flex gap-2.5">
                    <span className="w-5 h-5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <span>Photos are analysed for sharpness, exposure and colour.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="w-5 h-5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <span>Rooms are generated and connected for a continuous walk.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="w-5 h-5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                      3
                    </span>
                    <span>Your photos are mounted in the 3D scene and the walkthrough opens.</span>
                  </li>
                </ol>

                {uploadError && (
                  <div className="px-3 py-2 rounded-lg bg-red-950/60 border border-red-800 text-[11px] text-red-300">
                    {uploadError}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                {isUploading && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>Building your 3D model…</span>
                      <span>
                        {progress.done}/{progress.total}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-300"
                        style={{
                          width: `${
                            progress.total > 0
                              ? Math.round((progress.done / progress.total) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleBuildModel}
                  disabled={pendingFiles.length === 0 || isUploading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-cyan-950/50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Building 3D model…</span>
                    </>
                  ) : (
                    <>
                      <Box className="w-4 h-4" />
                      <span>Build 3D model</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
                <p className="text-[10px] font-mono text-slate-500 text-center">
                  Photos are stored in your workspace and can be extended later.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Technical deep dive — collapsed by default so it never competes with the hero */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-widest">
              Technical Deep Dive
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">Under the hood</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Optional reading for reviewers: how the engine works and how it compares with
              manual CAD, NeRF and 3D Gaussian Splatting.
            </p>
          </div>
          <button
            onClick={() => onNavigate('pipeline')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white font-mono text-xs rounded-lg border border-slate-800 transition self-start sm:self-auto shrink-0"
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>Architecture Docs</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <details className="group bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden">
          <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none hover:bg-slate-800/40 transition [&::-webkit-details-marker]:hidden">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Cpu className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white">
                System architecture — four engineering pillars
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                LoopAnchor SOP · DART quality gate · SfM/MVS · POI pathfinding
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180 shrink-0" />
          </summary>

          <div className="px-4 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-orange-400">
                  <Camera className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm text-white font-mono">1. LoopAnchor SOP</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Standardized 4-stage capture protocol (Pass A: Perimeter, Pass B: Diagonal Occlusion, Pass C: Reciprocal Door Transit) with guaranteed &gt;=70% visual overlap.
                </p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm text-white font-mono">2. DART Quality Gate</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Automated image Laplacian sharpness checking, exposure analysis, and 100-point audit gate before executing heavy photogrammetry.
                </p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm text-white font-mono">3. Dual Engine SfM/MVS</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  COLMAP-compatible Structure-from-Motion pipeline paired with scale-calibrated architectural geometric twin generator for instant zero-install browser exploration.
                </p>
              </div>

              <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Compass className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm text-white font-mono">4. Spatial POI &amp; Pathfinding</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Interactive 3D points of interest, indoor search, distance telemetry, and obstacle-aware path calculation designed for Round 2 and Round 3 extension.
                </p>
              </div>
            </div>
          </div>
        </details>

        <details className="group bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden">
          <summary className="flex items-center gap-3 p-4 cursor-pointer select-none list-none hover:bg-slate-800/40 transition [&::-webkit-details-marker]:hidden">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white">
                Trade-off evaluation — Namma Space vs alternatives
              </div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                Metric comparison across manual CAD, NeRF and 3D Gaussian Splatting
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180 shrink-0" />
          </summary>

          <div className="px-4 pb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3">Metric / Criterion</th>
                    <th className="py-2.5 px-3 text-cyan-300 font-bold bg-cyan-950/20">Namma Space (Our Platform)</th>
                    <th className="py-2.5 px-3">Traditional Manual CAD</th>
                    <th className="py-2.5 px-3">Raw Neural Radiance Fields (NeRF)</th>
                    <th className="py-2.5 px-3">3D Gaussian Splatting (3DGS)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-white">Browser First-Person Walkthrough</td>
                    <td className="py-2.5 px-3 text-cyan-300 bg-cyan-950/20 font-bold">Real reconstruction → browser walkthrough</td>
                    <td className="py-2.5 px-3">Manual navigation of CAD model</td>
                    <td className="py-2.5 px-3 text-amber-400">Low FPS (&lt;15 FPS in WebGL)</td>
                    <td className="py-2.5 px-3 text-cyan-300">GPU-dependent (WebGPU typical)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-white">Physical Scale Verification</td>
                    <td className="py-2.5 px-3 text-cyan-300 bg-cyan-950/20 font-bold">Scale error only vs. measured ground truth</td>
                    <td className="py-2.5 px-3">Accurate but manual</td>
                    <td className="py-2.5 px-3 text-amber-400">Scale ambiguous without reference</td>
                    <td className="py-2.5 px-3 text-amber-400">Scale ambiguous without reference</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-white">Hardware Requirements</td>
                    <td className="py-2.5 px-3 text-cyan-300 bg-cyan-950/20 font-bold">CPU SfM + GPU splat training (configurable)</td>
                    <td className="py-2.5 px-3">Standard GPU</td>
                    <td className="py-2.5 px-3 text-amber-400">High-end NVIDIA GPU (CUDA)</td>
                    <td className="py-2.5 px-3 text-amber-400">Dedicated GPU</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-white">Automated Pipeline</td>
                    <td className="py-2.5 px-3 text-cyan-300 bg-cyan-950/20 font-bold">COLMAP SfM + splat training (worker queue)</td>
                    <td className="py-2.5 px-3 text-red-400">Manual (hours of 3D modeling)</td>
                    <td className="py-2.5 px-3 text-cyan-300">Automated training</td>
                    <td className="py-2.5 px-3 text-cyan-300">Automated training</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-white">Collision &amp; Pathfinding</td>
                    <td className="py-2.5 px-3 text-amber-400 bg-cyan-950/20 font-bold">Planned (architectural phase 2)</td>
                    <td className="py-2.5 px-3">Supported</td>
                    <td className="py-2.5 px-3 text-red-400">No explicit surface geometry</td>
                    <td className="py-2.5 px-3 text-red-400">No explicit mesh surface</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
};
