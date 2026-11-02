import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Terminal,
  Cpu,
  Layers,
  Box,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Download,
  ArrowRight,
  FileText,
  Play,
  Pause,
  ExternalLink,
  Info,
  Sliders,
  Check,
  Copy,
} from 'lucide-react';
import { NammaProject, CapturePhotoRecord, RoomMetadata, DoorwayAnchor } from '../types/dart';
import { reconstructionApi } from '../services/reconstructionApi';

interface ReconstructionWorkspaceViewProps {
  currentProject: NammaProject;
  rooms: RoomMetadata[];
  doorways: DoorwayAnchor[];
  photos: CapturePhotoRecord[];
  onNavigateToViewer: () => void;
  onNavigateToCapture: () => void;
  onUpdateProjectStatus: (status: NammaProject['status'], progress: number) => void;
}

export const ReconstructionWorkspaceView: React.FC<ReconstructionWorkspaceViewProps> = ({
  currentProject,
  rooms,
  doorways,
  photos,
  onNavigateToViewer,
  onNavigateToCapture,
  onUpdateProjectStatus,
}) => {
  const [engineType, setEngineType] = useState<'geometric' | 'colmap'>('colmap');
  const [pipelineState, setPipelineState] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    `[INIT] Workspace initialized for project: ${currentProject.name}`,
    `[INFO] ${photos.length} photo(s) across ${rooms.length} room(s) and ${doorways.length} doorway anchor(s).`,
    `[STATUS] Reconstruction runs through the local FastAPI service. Start "npm run reconstruction" on port 8000.`,
  ]);
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLogLen = useRef<number>(0);

  // Real pipeline stages
  const pipelineStages = [
    {
      id: 'ingest',
      name: '1. Ingestion & Validation',
      desc: 'Manifest integrity, EXIF validation, and frame deduplication.',
    },
    {
      id: 'features',
      name: '2. Feature Extraction',
      desc: 'SIFT keypoint extraction and mutual nearest-neighbor descriptor matching.',
    },
    {
      id: 'sfm',
      name: '3. Sparse SfM & Poses',
      desc: 'Incremental bundle adjustment and inter-room doorway camera pose estimation.',
    },
    {
      id: 'dense',
      name: '4. Dense Stereo / Geometry',
      desc: 'PatchMatch stereo depth maps or calibrated wall boundary geometry fitting.',
    },
    {
      id: 'meshing',
      name: '5. Surface Meshing & Texturing',
      desc: 'Screened Poisson surface reconstruction and UV parameterization.',
    },
    {
      id: 'export',
      name: '6. Scale Calibration & GLB',
      desc: 'Metric calibration against laser ground truth and webgl asset validation.',
    },
  ];

  // Start Reconstruction Handler — drives the REAL FastAPI job, no simulated numbers.
  const stageOrder: Record<string, number> = {
    ingest: 0, sfm: 1, dense: 2, mesh: 3, splat: 4, validation: 5, manifest: 5,
  };

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const photoRecordsToFiles = useCallback(async (): Promise<File[]> => {
    const files: File[] = [];
    for (const [index, photo] of photos.entries()) {
      if (!photo.imageUrl) continue;
      try {
        const response = await fetch(photo.imageUrl);
        const blob = await response.blob();
        if (!blob.size) continue;
        const baseName = (photo.filename || `photo_${index + 1}`).replace(/\.[^.]+$/, '') || `photo_${index + 1}`;
        const extension = blob.type === 'image/png'
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
  }, [photos]);

  const appendLog = useCallback((line: string) => {
    setTerminalLogs((prev) => [...prev, line]);
  }, []);

  const startRealJob = async (files: File[]) => {
    if (!files.length) {
      appendLog('[ERROR] No readable photo data to reconstruct. Upload images first.');
      setPipelineState('failed');
      onUpdateProjectStatus('Failed', 0);
      return;
    }
    appendLog(`[STEP 1/6] Ingesting ${files.length} photo(s) for project ${currentProject.name}...`);
    setPipelineState('running');
    setCurrentStepIndex(0);
    setProgressPercent(5);
    onUpdateProjectStatus('Processing', 5);

    const result = await reconstructionApi.createJob(files, currentProject.id);
    if (!result.ok || !result.data) {
      appendLog(`[ERROR] Failed to start reconstruction: ${result.error}`);
      setPipelineState('failed');
      onUpdateProjectStatus('Failed', 0);
      return;
    }
    const job = result.data;
    setJobId(job.id);
    appendLog(`[JOB] Created ${job.id} — ${job.inputCount} photo(s) queued.`);

    pollRef.current = setInterval(async () => {
      const current = await reconstructionApi.getJob(job.id);
      if (!current.ok || !current.data) {
        appendLog(`[ERROR] Lost contact with reconstruction service: ${current.error}`);
        stopPolling();
        setPipelineState('failed');
        onUpdateProjectStatus('Failed', 0);
        return;
      }
      const j = current.data;
      const pct = j.progress ?? 0;
      setProgressPercent(pct);
      setPipelineState((j.status === 'completed' ? 'completed' : j.status === 'failed' ? 'failed' : 'running') as 'idle' | 'running' | 'completed' | 'failed');
      setCurrentStepIndex(Math.min(5, stageOrder[j.stage ?? 'ingest'] ?? 0));
      onUpdateProjectStatus(j.status === 'completed' ? 'Completed' : j.status === 'failed' ? 'Failed' : 'Processing', pct);

      if (j.message) appendLog(`[${j.stage}] ${j.message}`);

      // Stream new lines from the real job log.
      try {
        const logResp = await fetch(`${reconstructionApi.baseUrl}/v1/jobs/${encodeURIComponent(j.id)}/log`);
        if (logResp.ok) {
          const text = await logResp.text();
          const lines = text.split('\n').filter(Boolean);
          const newLines = lines.slice(lastLogLen.current);
          lastLogLen.current = lines.length;
          for (const line of newLines) appendLog(line);
        }
      } catch {
        /* Log streaming is best-effort. */
      }

      if (j.status === 'completed' || j.status === 'failed') {
        stopPolling();
        if (j.status === 'completed') {
          const stats = j.stats ?? {};
          appendLog(`[SUCCESS] Reconstruction complete — ${stats.splatCount ?? stats.sparsePoints ?? 0} point(s)/splat(s) from ${stats.registeredImages ?? 0} camera(s).`);
          setProgressPercent(100);
          onUpdateProjectStatus('Completed', 100);
        } else {
          appendLog(`[FAILED] ${j.error ?? 'Reconstruction failed.'}`);
          onUpdateProjectStatus('Failed', pct);
        }
      }
    }, 1500);
  };

  const handleStartReconstruction = () => {
    stopPolling();
    setJobId('');
    lastLogLen.current = 0;
    setTerminalLogs([
      `[INIT] Workspace initialized for project: ${currentProject.name}`,
      `[INFO] ${photos.length} photo(s) across ${rooms.length} room(s) and ${doorways.length} doorway anchor(s).`,
      `[STATUS] Starting real reconstruction via the FastAPI service...`,
    ]);
    setPipelineState('running');
    setProgressPercent(0);
    onUpdateProjectStatus('Processing', 0);
    void photoRecordsToFiles().then(startRealJob);
  };

  const handleRetry = () => {
    stopPolling();
    setJobId('');
    lastLogLen.current = 0;
    setPipelineState('idle');
    setCurrentStepIndex(0);
    setProgressPercent(0);
    setTerminalLogs([
      `[RESET] Pipeline reset for project: ${currentProject.name}`,
      `[STATUS] Ready to run reconstruction.`,
    ]);
    onUpdateProjectStatus(currentProject.status, 0);
  };


  const copyCliCommand = () => {
    const script = `# ==========================================
# NAMMATWIN: COLMAP GPU RECONSTRUCTION CLI (CUDA + Anaconda)
# Run in PowerShell / VS Code terminal
# ==========================================

# 1. Create & activate the Anaconda environment (one time)
conda env create -f environment.yml
conda activate dart-twin

# 2. Install the FastAPI reconstruction service deps
pip install -r reconstruction_service/requirements.txt

# 3. Validate the capture manifest (DART 100-point quality gate)
python pipeline/dart_validator.py

# 4. Run the full CUDA photogrammetry pipeline:
#    real photos -> CUDA SIFT -> exhaustive matching -> incremental SfM ->
#    CUDA dense stereo -> fusion -> Poisson mesh -> viewer-ready PLY
python pipeline/reconstruct_full.py \\
  --images colmap_images \\
  --workspace data/colmap_workspace \\
  --out public/models/dart_twin_reconstruction.ply \\
  --doorway-width 1.05 \\
  --gpu-index 0

# 5. (Optional) GPU Gaussian splats via the FastAPI service on :8000
# npm run reconstruction
`;
    navigator.clipboard.writeText(script);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-orange-400">
              Reconstruction Workspace
            </span>
            <span className="text-xs text-slate-600">•</span>
            <span className="text-xs text-slate-400 font-mono">
              Status: {pipelineState.toUpperCase()}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
            3D Geometric &amp; Photogrammetric Reconstruction
          </h1>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            Convert 2D capture evidence and scale calibration into a watertight 3D digital twin. Choose between the instant Calibrated Geometric Twin Engine or the Native COLMAP CLI pipeline.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {pipelineState === 'completed' && (
            <button
              onClick={onNavigateToViewer}
              className="flex items-center gap-2 px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition shadow-lg shadow-cyan-950/60"
            >
              <Box className="w-4 h-4" />
              <span>Launch 3D Walkthrough</span>
            </button>
          )}

          <button
            onClick={onNavigateToCapture}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs rounded-lg transition"
          >
            Return to Capture
          </button>
        </div>
      </div>

      {/* Engine Selection & Honesty Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Engine 1: Calibrated Geometric Twin */}
        <div
          onClick={() => setEngineType('geometric')}
          className={`p-5 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
            engineType === 'geometric'
              ? 'bg-slate-900 border-cyan-500 ring-1 ring-cyan-500/40 shadow-lg'
              : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                BROWSER CLIENT ENGINE
              </span>
              <span className="text-[10px] font-mono text-slate-400">Metric scale not guaranteed</span>
            </div>
            <h3 className="font-bold text-sm font-mono text-white">
              Scale-Calibrated Geometric Twin Engine
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Generates dimensioned 3D geometry from ground truth measurements, doorway anchors, and room boundary footprints. 100% self-contained in browser, zero native dependencies.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-300">
            <span>Status: Ready to Run</span>
            <span className="text-cyan-400">Recommended for WebGL Walkthrough</span>
          </div>
        </div>

        {/* Engine 2: Native COLMAP CLI */}
        <div
          onClick={() => setEngineType('colmap')}
          className={`p-5 rounded-xl border cursor-pointer transition select-none flex flex-col justify-between ${
            engineType === 'colmap'
              ? 'bg-slate-900 border-orange-500 ring-1 ring-orange-500/40 shadow-lg'
              : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-orange-950 text-orange-300 border border-orange-800">
                NATIVE OFFLINE PIPELINE
              </span>
              <span className="text-[10px] font-mono text-orange-400">External GPU / CLI</span>
            </div>
            <h3 className="font-bold text-sm font-mono text-white">
              COLMAP + OpenMVS / Blender CLI Pipeline
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Full dense multi-view stereo pipeline executed natively via Python and COLMAP. Decoupled from browser sandbox to handle heavy computation without freezing.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-300">
            <span>Status: Native Script Ready</span>
            <span className="text-orange-400">Windows / Linux CLI</span>
          </div>
        </div>
      </div>

      {/* Honest Distinction Banner */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-start gap-3 text-xs text-slate-300">
        <Info className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong className="text-white block font-mono text-xs">
            Model Provenance &amp; Pipeline Transparency Notice
          </strong>
          When viewing the resulting 3D environment, the viewer clearly displays whether you are roaming inside the{' '}
          <strong className="text-cyan-300">"Floor-Plan Assisted 3D Model"</strong> or an imported{' '}
          <strong className="text-orange-300">"Photogrammetry Mesh Twin"</strong>.
          We never claim a generic room is photogrammetry, nor do we present simulated progress as real GPU execution.
        </div>
      </div>

      {/* Pipeline Progress Stages */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h3 className="font-bold text-sm font-mono text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>PIPELINE EXECUTION STAGES</span>
            </h3>
            <span className="text-xs text-slate-400">
              {pipelineState === 'running'
                ? `Executing Stage ${currentStepIndex + 1} of 6...`
                : pipelineState === 'completed'
                ? 'All 6 stages completed successfully.'
                : 'Click "Start Reconstruction" to begin.'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {pipelineState === 'running' ? (
              <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                <span>Processing ({progressPercent}%)</span>
              </div>
            ) : pipelineState === 'completed' ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={onNavigateToViewer}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition shadow-lg shadow-emerald-950/60 animate-pulse"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>Launch 3D Walkthrough</span>
                </button>
                <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded text-[11px] font-mono font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Ready</span>
                </span>
              </div>
            ) : (
              <button
                onClick={handleStartReconstruction}
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-slate-950 font-mono font-bold text-xs uppercase tracking-wider rounded-lg transition shadow-lg shadow-orange-950/60"
              >
                <Play className="w-4 h-4" />
                <span>Start Reconstruction</span>
              </button>
            )}

            {pipelineState !== 'idle' && (
              <button
                onClick={handleRetry}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
                title="Reset / Retry"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Stage Steps Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {pipelineStages.map((stage, idx) => {
            const isDone = currentStepIndex > idx || pipelineState === 'completed';
            const isCurrent = currentStepIndex === idx && pipelineState === 'running';
            return (
              <div
                key={stage.id}
                className={`p-3 rounded-lg border text-left transition ${
                  isDone
                    ? 'bg-slate-950 border-emerald-800/80'
                    : isCurrent
                    ? 'bg-slate-950 border-cyan-500 ring-1 ring-cyan-500/30'
                    : 'bg-slate-950/50 border-slate-800 text-slate-500'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-mono font-bold ${
                    isDone ? 'text-emerald-400' : isCurrent ? 'text-cyan-400' : 'text-slate-500'
                  }`}>
                    STAGE {idx + 1}
                  </span>
                  {isDone ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : isCurrent ? (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  ) : null}
                </div>
                <div className={`font-mono text-xs font-bold truncate ${
                  isDone || isCurrent ? 'text-white' : 'text-slate-400'
                }`}>
                  {stage.name.replace(/^\d+\.\s*/, '')}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 leading-relaxed line-clamp-2">
                  {stage.desc}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs font-mono text-slate-400">
            <span>Overall Pipeline Progress</span>
            <span className="text-cyan-300 font-bold">{progressPercent}%</span>
          </div>
          <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-orange-500 via-amber-400 to-cyan-400 h-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Reconstruction Log Terminal & CLI Commands */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Terminal Output */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-80">
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>pipeline_execution.log</span>
            </div>
            <span className="text-[10px] text-slate-500">Live Stream</span>
          </div>
          <div className="p-4 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-300 flex-1 leading-relaxed">
            {terminalLogs
              .filter((l): l is string => Boolean(l))
              .map((log, idx) => (
                <div
                  key={idx}
                  className={
                    log.includes('[SUCCESS]')
                      ? 'text-emerald-400 font-bold'
                      : log.includes('[STEP')
                      ? 'text-cyan-300'
                      : 'text-slate-400'
                  }
                >
                  {log}
                </div>
              ))}
          </div>

        </div>

        {/* Right: Windows Reproduction Script */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <h3 className="font-bold text-xs font-mono text-orange-400 uppercase flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                <span>LOCAL WINDOWS / VS CODE EXECUTION COMMANDS</span>
              </h3>
              <button
                onClick={copyCliCommand}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-mono transition"
              >
                {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedScript ? 'Copied' : 'Copy Script'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-3">
              To reproduce photogrammetry on your personal PC with an NVIDIA GPU, install pre-built COLMAP Windows binaries and execute our modular runner:
            </p>
            <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto">
              <code>{`# Run full automated CUDA photogrammetry pipeline:
python pipeline/reconstruct_full.py \\
  --images colmap_images \\
  --workspace data/colmap_workspace \\
  --out public/models/dart_twin_reconstruction.ply \\
  --doorway-width "${currentProject.referenceMeasurement || '1.05'}" \\
  --gpu-index 0`}</code>
            </pre>
          </div>

          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
            <span>Dependencies: Python 3.10+, COLMAP 3.9+, FFmpeg</span>
            <span className="text-emerald-400 font-mono">Validated for R1</span>
          </div>
        </div>
      </div>
    </div>
  );
};
