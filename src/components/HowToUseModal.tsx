import React, { useEffect } from 'react';
import {
  X,
  Camera,
  Box,
  FolderOpen,
  Sparkles,
  ArrowRight,
  Lightbulb,
  MousePointer2,
  Keyboard,
} from 'lucide-react';

interface HowToUseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab: (tab: any) => void;
}

/**
 * Quick start guide.
 *
 * Deliberately simple: four plain-language steps, all visible at once,
 * each with a single action button. No tabs or wizard to click through.
 */
export const HowToUseModal: React.FC<HowToUseModalProps> = ({
  isOpen,
  onClose,
  onNavigateTab,
}) => {
  // Close on Escape for a familiar, low-friction exit.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const steps = [
    {
      number: 1,
      title: 'Pick a space',
      description:
        'Create a space for your home or office, or open one you already made. Add a room for each area you want to capture.',
      icon: FolderOpen,
      actionLabel: 'Spaces',
      targetTab: 'library',
    },
    {
      number: 2,
      title: 'Add your photos',
      description:
        'Open Capture Studio and drag in 20–40 phone photos, or a short walkthrough video. Walk slowly and keep each shot overlapping the last.',
      icon: Camera,
      actionLabel: 'Capture Studio',
      targetTab: 'sop',
    },
    {
      number: 3,
      title: 'Build the 3D twin',
      description:
        'Go to Reconstruction and press run. Your rooms are joined at the doorways and scaled automatically — no measurements or 3D skills needed.',
      icon: Sparkles,
      actionLabel: 'Reconstruction',
      targetTab: 'reconstruction',
    },
    {
      number: 4,
      title: 'Walk through it',
      description:
        'Open 3D Walkthrough to explore your space in first person, right in the browser. Jump between rooms using the buttons at the top.',
      icon: Box,
      actionLabel: '3D Walkthrough',
      targetTab: 'viewer',
    },
  ];

  return (
    <div
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-to-use-title"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-start justify-between gap-3 bg-slate-950/60">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <Lightbulb className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="how-to-use-title"
                className="text-lg font-bold text-white flex items-center gap-2 flex-wrap"
              >
                <span>How to use Namma Space</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 uppercase">
                  4 steps
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                From phone photos to a walkable 3D twin. You'll need 20–40 photos per
                room (or one short video).
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close guide"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: every step visible at once */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1">
          <ol className="space-y-2.5">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.number}
                  className="group flex items-start gap-3 p-2.5 rounded-xl bg-slate-950/50 border border-slate-800 hover:border-cyan-600/60 transition"
                >
                  <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold font-mono flex items-center justify-center">
                      {step.number}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-cyan-400 shrink-0" />
                      <h3 className="text-sm font-bold text-white">{step.title}</h3>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed mt-1">
                      {step.description}
                    </p>

                    {step.number === 4 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 text-[10px] font-mono">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                          <Keyboard className="w-3 h-3 text-cyan-400" /> WASD to move
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                          <MousePointer2 className="w-3 h-3 text-cyan-400" /> Mouse to look
                        </span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                          Shift to sprint · R to reset · Esc to release
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      onClose();
                      onNavigateTab(step.targetTab);
                    }}
                    className="shrink-0 self-center flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-cyan-300 border border-slate-700 hover:border-cyan-400 text-[11px] font-mono font-bold transition"
                    title={`Open ${step.actionLabel}`}
                    aria-label={`Open ${step.actionLabel}`}
                  >
                    <span className="hidden sm:inline">{step.actionLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-2.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            Your work saves automatically at every step.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold font-mono transition"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
