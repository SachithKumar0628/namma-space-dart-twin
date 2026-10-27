import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  Cloud,
  Cpu,
  ExternalLink,
  Gauge,
  Info,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { CapturePhotoRecord, NammaProject } from '../types/dart';
import {
  reconstructionApi,
  reconstructionAssetUrl,
  reconstructionServiceHint,
  type ReconstructionHealth,
  type ReconstructionJob,
} from '../services/reconstructionApi';

interface PhotorealScanViewProps {
  project: NammaProject;
  photos: CapturePhotoRecord[];
  job: ReconstructionJob | null;
  serviceError?: string | null;
  onStartReconstruction: (files: File[]) => Promise<ReconstructionJob>;
  onDeleteReconstruction: () => Promise<void>;
  onOpenWalkthrough: () => void;
  onOpenCaptureStudio: () => void;
}

type ViewerMode = 'splat' | 'cloud';

const STAGES = [
  { id: 'prepare', label: 'Photos' },
  { id: 'features', label: 'Features' },
  { id: 'matching', label: 'Match' },
  { id: 'mapping', label: 'SfM' },
  { id: 'export', label: 'Geometry' },
  { id: 'splatting', label: 'Splats' },
  { id: 'finalizing', label: 'Finish' },
];

function formatCount(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
}

function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component))
  );
}

async function photoRecordsToFiles(photos: CapturePhotoRecord[]): Promise<File[]> {
  const files: File[] = [];
  for (const [index, photo] of photos.slice(0, 30).entries()) {
    if (!photo.imageUrl) continue;
    try {
      const response = await fetch(photo.imageUrl);
      const blob = await response.blob();
      if (!blob.size) continue;
      const baseName =
        (photo.filename || `photo_${index + 1}`).replace(/\.[^.]+$/, '') || `photo_${index + 1}`;
      const extension =
        blob.type === 'image/png'
          ? 'png'
          : blob.type === 'image/webp'
            ? 'webp'
            : blob.type === 'image/bmp'
              ? 'bmp'
              : 'jpg';
      files.push(new File([blob], `${baseName}.${extension}`, { type: blob.type || 'image/jpeg' }));
    } catch {
      /* Skip a single unreadable stored thumbnail; other photos can still scan. */
    }
  }
  return files;
}

function Metric({
  label,
  value,
  tone = 'text-slate-100',
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{label}</div>
      <div className={`text-sm font-bold font-mono mt-0.5 ${tone}`}>{value}</div>
    </div>
  );
}

export const PhotorealScanView: React.FC<PhotorealScanViewProps> = ({
  project,
  photos,
  job,
  serviceError,
  onStartReconstruction,
  onDeleteReconstruction,
  onOpenWalkthrough,
  onOpenCaptureStudio,
}) => {
  const savedStats = project.reconstructionModelStats || null;
  const stats = job?.stats || savedStats;
  const jobId = job?.id || savedStats?.jobId || '';
  const status = job?.status || savedStats?.jobStatus || (stats?.splatUrl || stats?.pointCloudUrl ? 'succeeded' : '');
  const isRunning = status === 'queued' || status === 'running';
  const isFailed = status === 'failed';
  const hasAssets = Boolean(stats?.splatUrl || stats?.pointCloudUrl);

  const [health, setHealth] = useState<ReconstructionHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [mode, setMode] = useState<ViewerMode>(stats?.splatUrl ? 'splat' : 'cloud');
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewerNonce, setViewerNonce] = useState(0);

  const splatContainerRef = useRef<HTMLDivElement>(null);
  const cloudContainerRef = useRef<HTMLDivElement>(null);
  const resetViewRef = useRef<() => void>(() => {});

  const splatSource = reconstructionAssetUrl(
    stats?.splatUrl,
    stats?.lastGeneratedAt || job?.finishedAt
  );
  const cloudSource = reconstructionAssetUrl(
    stats?.pointCloudUrl,
    stats?.lastGeneratedAt || job?.finishedAt
  );

  const splatCenter = useMemo<[number, number, number]>(
    () => (stats?.splatCenter || stats?.sceneCenter || [0, 0, 0]) as [number, number, number],
    [stats?.splatCenter, stats?.sceneCenter]
  );
  const cloudCenter = useMemo<[number, number, number]>(
    () => (stats?.sceneCenter || [0, 0, 0]) as [number, number, number],
    [stats?.sceneCenter]
  );
  const splatRadius = Math.max(0.5, Number(stats?.splatRadius || stats?.sceneRadius || 2));
  const cloudRadius = Math.max(0.5, Number(stats?.sceneRadius || 2));

  // COLMAP recovered a real camera pose for this scan. Starting the viewer
  // inside the capture path frames the reconstructed surfaces the way the
  // photos saw them, instead of approximating an orbit from the bounding box.
  const recoveredView = useMemo(() => {
    const camera = stats?.viewerCamera;
    if (!camera || !isVec3(camera.position) || !isVec3(camera.lookAt)) return null;
    return {
      position: camera.position,
      lookAt: camera.lookAt,
      up: isVec3(camera.up) ? camera.up : ([0, 1, 0] as [number, number, number]),
      image: camera.image,
    };
  }, [stats?.viewerCamera]);

  const checkHealth = useCallback(async () => {
    setHealthLoading(true);
    const result = await reconstructionApi.health();
    if (result.ok && result.data) {
      setHealth(result.data);
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(result.error || 'Reconstruction service is offline.');
    }
    setHealthLoading(false);
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    if (isRunning) return;
    if (stats?.splatUrl) setMode('splat');
    else if (stats?.pointCloudUrl) setMode('cloud');
  }, [isRunning, stats?.splatUrl, stats?.pointCloudUrl]);

  // Gaussian-splat viewer. The library is loaded on demand because it is large
  // and only needed when a succeeded job has a .ply splat asset.
  useEffect(() => {
    if (mode !== 'splat' || !splatSource || !splatContainerRef.current) return;
    let disposed = false;
    let viewer: any = null;
    const container = splatContainerRef.current;
    setViewerReady(false);
    setViewerError(null);

    const initialPosition: [number, number, number] = recoveredView?.position ?? [
      splatCenter[0] + splatRadius * 0.75,
      splatCenter[1] + splatRadius * 0.5,
      splatCenter[2] + splatRadius * 0.95,
    ];
    const initialLookAt: [number, number, number] = recoveredView?.lookAt ?? splatCenter;
    const initialUp: [number, number, number] = recoveredView?.up ?? [0, 1, 0];

    void (async () => {
      try {
        const module: any = await import('@mkkellogg/gaussian-splats-3d');
        if (disposed) return;
        viewer = new module.Viewer({
          rootElement: container,
          cameraUp: initialUp,
          initialCameraPosition: initialPosition,
          initialCameraLookAt: initialLookAt,
          selfDrivenMode: true,
          useBuiltInControls: true,
          sharedMemoryForWorkers: false,
          gpuAcceleratedSort: false,
          ignoreDevicePixelRatio: true,
          antialiased: true,
          maxScreenSpaceSplatSize: 256,
          sphericalHarmonicsDegree: 0,
          logLevel: 0,
        });
        await viewer.addSplatScene(splatSource, {
          format: module.SceneFormat.Ply,
          showLoadingUI: false,
          progressiveLoad: false,
          splatAlphaRemovalThreshold: 16,
        });
        if (disposed) {
          try {
            await viewer.dispose();
          } catch {
            /* ignore teardown races */
          }
          return;
        }
        // Brush can leave some Gaussians larger than the surface detail they
        // represent. Rendering them slightly smaller removes most of the
        // foreground haze without harming walls or furniture.
        try {
          viewer.splatMesh?.setSplatScale?.(0.5);
        } catch {
          /* older viewer builds expose the scale through options only */
        }
        viewer.start();
        resetViewRef.current = () => {
          if (!viewer?.camera) return;
          viewer.camera.position.set(...initialPosition);
          viewer.camera.up.set(...initialUp);
          viewer.camera.lookAt(...initialLookAt);
          if (viewer.controls) {
            viewer.controls.target.set(...initialLookAt);
            viewer.controls.update();
          }
          viewer.forceRenderNextFrame?.();
        };
        setViewerReady(true);
      } catch (error: any) {
        if (disposed) return;
        setViewerError(error?.message || 'The Gaussian splat could not be loaded.');
        if (cloudSource) {
          setMode('cloud');
        }
      }
    })();

    return () => {
      disposed = true;
      setViewerReady(false);
      const activeViewer = viewer;
      viewer = null;
      if (!activeViewer) {
        container.replaceChildren();
        return;
      }
      // dispose() is asynchronous and this viewer removes its own root node.
      // React may unmount the container in the same tick, which makes that
      // removal throw; finish by clearing whatever is left.
      Promise.resolve()
        .then(() => activeViewer.dispose())
        .catch(() => {
          /* ignore teardown races */
        })
        .finally(() => {
          try {
            container.replaceChildren();
          } catch {
            /* container already detached */
          }
        });
    };
  }, [mode, splatSource, splatCenter, splatRadius, cloudSource, recoveredView, viewerNonce]);

  // Sparse COLMAP point-cloud fallback viewer (raw Three.js).
  useEffect(() => {
    if (mode !== 'cloud' || !cloudSource || !cloudContainerRef.current) return;
    let disposed = false;
    let renderer: any = null;
    let controls: any = null;
    let geometry: any = null;
    let material: any = null;
    let resizeObserver: ResizeObserver | null = null;
    let frame = 0;
    const container = cloudContainerRef.current;
    setViewerReady(false);
    setViewerError(null);

    void (async () => {
      try {
        const THREE: any = await import('three');
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        if (disposed) return;

        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020617);
        const camera = new THREE.PerspectiveCamera(
          55,
          width / height,
          cloudRadius / 2000,
          cloudRadius * 100
        );
        const center = new THREE.Vector3(...cloudCenter);
        const initialPosition = new THREE.Vector3(
          ...(recoveredView?.position ?? [
            center.x + cloudRadius * 0.8,
            center.y + cloudRadius * 0.45,
            center.z + cloudRadius * 0.95,
          ])
        );
        const initialLookAt = new THREE.Vector3(...(recoveredView?.lookAt ?? cloudCenter));
        const initialUp = new THREE.Vector3(...(recoveredView?.up ?? [0, 1, 0]));
        camera.position.copy(initialPosition);
        camera.up.copy(initialUp);
        camera.lookAt(initialLookAt);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(renderer.domElement);

        const controlsModule: any = await import(
          'three/examples/jsm/controls/OrbitControls.js'
        );
        controls = new controlsModule.OrbitControls(camera, renderer.domElement);
        controls.target.copy(initialLookAt);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = cloudRadius * 0.03;
        controls.maxDistance = cloudRadius * 12;
        controls.update();

        resetViewRef.current = () => {
          camera.position.copy(initialPosition);
          camera.up.copy(initialUp);
          camera.lookAt(initialLookAt);
          controls.target.copy(initialLookAt);
          controls.update();
        };

        const loader = new PLYLoader();
        loader.load(
          cloudSource,
          (loadedGeometry: any) => {
            if (disposed) {
              loadedGeometry.dispose();
              return;
            }
            geometry = loadedGeometry;
            geometry.computeBoundingSphere();
            const colorAttribute = geometry.getAttribute('color');
            let usesVertexColors = Boolean(colorAttribute && colorAttribute.count > 0);
            if (colorAttribute && colorAttribute.count > 0) {
              const array = colorAttribute.array;
              let max = 0;
              let finite = true;
              for (let i = 0; i < array.length; i += 1) {
                const value = Number(array[i]);
                if (!Number.isFinite(value)) {
                  finite = false;
                  break;
                }
                max = Math.max(max, Math.abs(value));
              }
              if (!finite) {
                geometry.deleteAttribute('color');
                usesVertexColors = false;
              } else if (max > 1.5) {
                const scale = max <= 255 ? 1 / 255 : 1 / max;
                for (let i = 0; i < array.length; i += 1) array[i] = Number(array[i]) * scale;
                colorAttribute.needsUpdate = true;
              }
            }
            material = new THREE.PointsMaterial({
              size: Math.max(cloudRadius / 420, 0.008),
              sizeAttenuation: true,
              vertexColors: usesVertexColors,
              color: usesVertexColors ? 0xffffff : 0x67e8f9,
              transparent: false,
            });
            const points = new THREE.Points(geometry, material);
            scene.add(points);
            setViewerReady(true);
          },
          undefined,
          (error: any) => {
            if (disposed) return;
            setViewerError(error?.message || 'The COLMAP point cloud could not be loaded.');
          }
        );

        resizeObserver = new ResizeObserver(() => {
          if (disposed) return;
          const nextWidth = Math.max(1, container.clientWidth);
          const nextHeight = Math.max(1, container.clientHeight);
          camera.aspect = nextWidth / nextHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(nextWidth, nextHeight);
        });
        resizeObserver.observe(container);

        const render = () => {
          if (disposed) return;
          frame = requestAnimationFrame(render);
          controls.update();
          renderer.render(scene, camera);
        };
        render();
      } catch (error: any) {
        if (disposed) return;
        setViewerError(error?.message || 'The COLMAP point cloud could not be loaded.');
      }
    })();

    return () => {
      disposed = true;
      setViewerReady(false);
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      try {
        controls?.dispose();
        geometry?.dispose();
        material?.dispose();
        renderer?.dispose();
      } catch {
        /* ignore dispose races */
      }
      container.innerHTML = '';
    };
  }, [mode, cloudSource, cloudCenter, cloudRadius, recoveredView, viewerNonce]);

  const handleStart = async () => {
    setStartError(null);
    setStarting(true);
    try {
      const files = await photoRecordsToFiles(photos);
      if (files.length < 3) {
        throw new Error(
          'At least 3 stored photos are needed for photogrammetry. Add more photos of the room first.'
        );
      }
      await onStartReconstruction(files);
    } catch (error: any) {
      setStartError(error?.message || 'Could not start the photoreal scan.');
      void checkHealth();
    } finally {
      setStarting(false);
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        'Remove this photoreal scan and its downloaded PLY files? The walkable 3D twin is not affected.'
      )
    ) {
      return;
    }
    setDeleting(true);
    setStartError(null);
    try {
      await onDeleteReconstruction();
    } catch (error: any) {
      setStartError(error?.message || 'Could not remove the scan files.');
    } finally {
      setDeleting(false);
    }
  };

  const stageIndex = Math.max(
    0,
    STAGES.findIndex((stage) => stage.id === (job?.stage || (isRunning ? 'prepare' : '')))
  );
  const canStartScan = photos.filter((photo) => photo.imageUrl).length >= 3;
  const serviceOnline = health?.ok === true;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500/20 to-teal-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
            <ScanLine className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold text-white tracking-tight">Photoreal Scan</h1>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                COLMAP + Brush
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              Camera poses and geometry are recovered from your uploaded photos with COLMAP, then
              rendered as Gaussian splats. This is the photo-derived surface scan; use the walkable
              twin for room-to-room directions.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onOpenWalkthrough}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded-lg border border-slate-700 transition"
          >
            <Play className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open Walkthrough</span>
          </button>
          {(jobId || hasAssets) && (
            <button
              onClick={handleDelete}
              disabled={deleting || isRunning}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-red-950/50 text-slate-400 hover:text-red-300 font-mono text-xs rounded-lg border border-slate-800 hover:border-red-800 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="Delete the reconstruction assets from this machine"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Remove scan</span>
            </button>
          )}
        </div>
      </div>

      {(serviceError || (healthError && (jobId || isRunning))) && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Reconstruction service unreachable</div>
            <div className="text-amber-200/80 mt-0.5">
              {serviceError || healthError} Start it with{' '}
              <code className="px-1 py-0.5 rounded bg-slate-950/70 text-amber-300">
                {reconstructionServiceHint()}
              </code>
              . The walkthrough and saved metrics stay available.
            </div>
          </div>
        </div>
      )}

      {isRunning && (
        <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center">
                <Loader2 className="w-4 h-4 text-cyan-300 animate-spin" />
              </div>
              <div>
                <div className="text-sm font-bold text-white">
                  {status === 'queued' ? 'Waiting for the reconstruction worker' : 'Reconstructing your space'}
                </div>
                <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                  {job?.message || 'Photos uploaded. Preparing the COLMAP job…'}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black font-mono text-cyan-300">{job?.progress ?? 0}%</div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
                {job?.inputCount || stats?.inputImages || photos.length} photos
              </div>
            </div>
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-500"
                style={{ width: `${Math.max(2, job?.progress ?? 0)}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {STAGES.map((stage, index) => {
                const complete = isRunning && index < stageIndex;
                const active = isRunning && index === stageIndex;
                return (
                  <div
                    key={stage.id}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono uppercase tracking-wide ${
                      complete
                        ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                        : active
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                          : 'border-slate-800 bg-slate-950/50 text-slate-500'
                    }`}
                  >
                    {complete ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : active ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <span className="w-3 h-3 rounded-full border border-slate-700" />
                    )}
                    {stage.label}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              COLMAP runs on CPU, then Brush trains Gaussian splats on the GPU. You can keep using
              the walkthrough while this finishes — results are saved to this space automatically.
            </p>
          </div>
        </div>
      )}

      {(isFailed || startError) && !hasAssets && (
        <div className="rounded-2xl border border-red-900/60 bg-red-950/20 overflow-hidden">
          <div className="px-5 py-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-800/50 flex items-center justify-center shrink-0">
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold text-red-200">Photoreal scan did not complete</div>
              <div className="text-xs text-red-200/80 mt-1 leading-relaxed">
                {startError || job?.error || stats?.error || 'The reconstruction job failed.'}
              </div>
              <div className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                For solid results, capture 8–30 sharp photos while turning around the room, keeping
                about 70% overlap between neighbouring shots. Avoid blank walls only, motion blur and
                switching rooms without overlap.
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={handleStart}
                  disabled={starting || isRunning || !canStartScan}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-mono font-bold text-xs rounded-lg transition"
                >
                  {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Retry scan</span>
                </button>
                <button
                  onClick={onOpenCaptureStudio}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded-lg border border-slate-700 transition"
                >
                  <Camera className="w-3.5 h-3.5 text-orange-400" />
                  <span>Add / review photos</span>
                </button>
                {(jobId || hasAssets) && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting || isRunning}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 font-mono text-xs rounded-lg border border-slate-800 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear failed scan</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {hasAssets && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-950/60">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-mono font-bold text-white">Photo-derived surface</span>
                <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
                  {stats?.engine || 'COLMAP reconstruction'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {stats?.splatUrl && (
                  <button
                    onClick={() => setMode('splat')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition ${
                      mode === 'splat'
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    Gaussian splat
                  </button>
                )}
                {stats?.pointCloudUrl && (
                  <button
                    onClick={() => setMode('cloud')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition ${
                      mode === 'cloud'
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Cloud className="w-3 h-3" />
                    Sparse cloud
                  </button>
                )}
                <button
                  onClick={() => resetViewRef.current()}
                  className="p-1.5 rounded-md bg-slate-900 text-slate-400 hover:text-white border border-slate-800 transition"
                  title="Reset camera"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="relative h-[calc(100vh-330px)] min-h-[430px] max-h-[760px] bg-slate-950">
              {mode === 'splat' && splatSource ? (
                <div ref={splatContainerRef} className="absolute inset-0" />
              ) : (
                <div ref={cloudContainerRef} className="absolute inset-0" />
              )}

              {!viewerReady && !viewerError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80 pointer-events-none">
                  <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                  <div className="text-xs font-mono text-slate-400">
                    Loading {mode === 'splat' ? 'Gaussian splats' : 'COLMAP point cloud'}…
                  </div>
                </div>
              )}

              {viewerError && (
                <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-950/85">
                  <div className="max-w-md text-center space-y-3">
                    <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto" />
                    <div className="text-sm font-bold text-white">Could not load the scan</div>
                    <div className="text-xs text-slate-400 break-words">{viewerError}</div>
                    <div className="flex justify-center gap-2">
                      {mode === 'splat' && stats?.pointCloudUrl && (
                        <button
                          onClick={() => setMode('cloud')}
                          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono rounded-lg border border-slate-700"
                        >
                          Use sparse cloud
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setViewerError(null);
                          setViewerReady(false);
                          setViewerNonce((current) => current + 1);
                        }}
                        className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-mono font-bold rounded-lg"
                      >
                        Try again
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="absolute left-3 bottom-3 pointer-events-none rounded-lg bg-slate-950/75 border border-slate-800 px-2.5 py-1.5 text-[10px] font-mono text-slate-400">
                Drag to orbit · scroll to zoom
              </div>
              {stats?.brushWarning && mode === 'cloud' && (
                <div className="absolute right-3 bottom-3 max-w-xs rounded-lg bg-amber-950/80 border border-amber-800/70 px-2.5 py-1.5 text-[10px] text-amber-200">
                  {stats.brushWarning}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Gauge className="w-4 h-4 text-cyan-400" />
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  Scan metrics
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Metric
                  label="Gaussian splats"
                  value={formatCount(stats?.splatCount)}
                  tone="text-cyan-300"
                />
                <Metric label="Sparse points" value={formatCount(stats?.sparsePoints || stats?.pointCloudCount)} />
                <Metric
                  label="Cameras"
                  value={`${stats?.registeredImages ?? '—'}/${stats?.inputImages ?? '—'}`}
                />
                <Metric
                  label="Reprojection"
                  value={
                    typeof stats?.reprojectionErrorPx === 'number'
                      ? `${stats.reprojectionErrorPx.toFixed(2)} px`
                      : '—'
                  }
                  tone="text-emerald-300"
                />
                <Metric
                  label="Registered"
                  value={
                    typeof stats?.registrationRatePercent === 'number'
                      ? `${stats.registrationRatePercent.toFixed(0)}%`
                      : '—'
                  }
                />
                <Metric label="Scan time" value={formatDuration(stats?.durationSeconds)} />
              </div>
              <div className="mt-3 text-[10px] font-mono text-slate-500 space-y-1">
                <div>SFM: {stats?.sfmEngine || 'pycolmap'}</div>
                <div>SPLAT: {stats?.splatEngine || 'Not available (sparse cloud)'}</div>
                <div>VIEW: {recoveredView?.image ? `camera ${recoveredView.image}` : 'auto-framed'}</div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  What am I seeing?
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {mode === 'splat'
                  ? 'Brush fits millions of view-dependent Gaussians from the COLMAP camera poses. It is a photoreal surface, not a collision mesh.'
                  : 'This is the sparse set of 3D points COLMAP triangulated from matching photo features. It is lighter and always available as a fallback.'}
              </p>
              <button
                onClick={onOpenWalkthrough}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 text-xs font-mono font-bold rounded-lg border border-cyan-500/40 transition"
              >
                <Box className="w-3.5 h-3.5" />
                <span>Walk & get directions</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>

            <button
              onClick={handleStart}
              disabled={starting || isRunning || !canStartScan || (health !== null && !serviceOnline)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-mono rounded-lg border border-slate-800 transition"
              title={
                health && !serviceOnline
                  ? `Start the service with ${reconstructionServiceHint()}`
                  : 'Run a fresh reconstruction from the saved photos'
              }
            >
              {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>Re-run scan</span>
            </button>
          </aside>
        </div>
      )}

      {!isRunning && !isFailed && !hasAssets && !jobId && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-300 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Turn these photos into a photoreal scan</h2>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-2xl">
                  The walkthrough is already built from photo-derived room dimensions. This extra
                  pass reconstructs the actual surfaces: COLMAP aligns the cameras, then Brush trains
                  Gaussian splats on the GPU.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  icon: Camera,
                  title: '1 · Photos',
                  body: `${photos.filter((photo) => photo.imageUrl).length} stored image${
                    photos.filter((photo) => photo.imageUrl).length === 1 ? '' : 's'
                  } are ready. Use 8–30 overlapping shots for a good scan.`,
                },
                {
                  icon: Cpu,
                  title: '2 · COLMAP SfM',
                  body: 'SIFT features and exhaustive matching recover camera poses, then bundle adjustment triangulates sparse 3D points.',
                },
                {
                  icon: Sparkles,
                  title: '3 · Brush splats',
                  body: 'The recovered cameras and points seed Gaussian-splat training, exported as a .ply and loaded in this browser.',
                },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3.5">
                    <div className="flex items-center gap-2 text-cyan-300">
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] font-mono font-bold uppercase tracking-wide">{step.title}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">{step.body}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {healthLoading ? (
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                ) : serviceOnline ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <div>
                  <div className="text-xs font-mono font-bold text-slate-200">
                    {healthLoading
                      ? 'Checking reconstruction service…'
                      : serviceOnline
                        ? 'Reconstruction service ready'
                        : 'Reconstruction service offline'}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {serviceOnline
                      ? `pycolmap ${health?.pycolmap || '?'} · Brush ${
                          health?.splattingAvailable ? 'ready' : 'not installed (sparse fallback)'
                        }`
                      : healthError || `Start with ${reconstructionServiceHint()}`}
                  </div>
                </div>
              </div>
              <button
                onClick={() => void checkHealth()}
                disabled={healthLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-mono rounded-lg border border-slate-800 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${healthLoading ? 'animate-spin' : ''}`} />
                Check
              </button>
            </div>

            {startError && (
              <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2.5 text-[11px] text-red-200">
                {startError}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleStart}
                disabled={starting || !canStartScan || (health !== null && !serviceOnline)}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 disabled:from-slate-800 disabled:to-slate-800 text-slate-950 disabled:text-slate-500 font-mono font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-lg shadow-cyan-950/40"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                <span>{starting ? 'Starting reconstruction…' : 'Start photoreal scan'}</span>
              </button>
              <button
                onClick={onOpenCaptureStudio}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs rounded-xl border border-slate-700 transition"
              >
                <Camera className="w-4 h-4 text-orange-400" />
                <span>Add more photos</span>
              </button>
              {!canStartScan && (
                <span className="text-[11px] text-amber-300 font-mono">
                  At least 3 stored photos are required.
                </span>
              )}
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300">
                  Real pipeline
                </span>
              </div>
              <ul className="space-y-2 text-[11px] text-slate-400 leading-relaxed">
                <li>• Photos normalised to 1600 px, EXIF rotation applied.</li>
                <li>• pycolmap SIFT extraction, exhaustive matching, incremental mapping.</li>
                <li>• Brush Gaussian-splat training with a bounded splat budget.</li>
                <li>• PLY assets streamed from the local FastAPI service.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-2">
                This space
              </div>
              <div className="space-y-1.5 text-[11px] font-mono">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Project</span>
                  <span className="text-slate-200 truncate">{project.name}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Rooms</span>
                  <span className="text-slate-200">{project.roomCount}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Photos</span>
                  <span className="text-slate-200">{photos.length}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500">Scan mode</span>
                  <span className="text-cyan-300">COLMAP + Brush</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {!isRunning && status === 'succeeded' && !hasAssets && (
        <div className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-amber-200">Scan finished without a usable asset</div>
            <div className="text-xs text-amber-200/70 mt-1">
              The job report is available, but its PLY files are missing. Re-run the scan or check
              the job log.
            </div>
            <button
              onClick={handleStart}
              disabled={starting || !canStartScan}
              className="mt-3 flex items-center gap-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs rounded-lg transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-run scan
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
