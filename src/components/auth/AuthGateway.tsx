/**
 * AuthGateway.tsx
 * Full-screen immersive authentication experience for NAMMA SPACE.
 *
 * Features:
 * - Direct "ENTER PLATFORM" button: one click triggers a cinematic 3D camera zoom.
 * - Small scroll sensitivity: a gentle flick of the trackpad/wheel triggers the transition.
 * - Smooth cubic ease-in-out animation into the 3D digital twin building.
 * - Real-time spatial telemetry & scanning HUD.
 * - Elegant dark glassmorphism login interface.
 * - "Return to Overview" option to zoom back out.
 * - Preserves existing application 100% untouched upon successful authentication.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { HolographicBuilding } from './HolographicBuilding';
import { LoginForm } from './LoginForm';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, Compass, ArrowRight, ArrowLeft, Shield, Sparkles } from 'lucide-react';

interface AuthGatewayProps {
  children: React.ReactNode;
}

export function AuthGateway({ children }: AuthGatewayProps) {
  const { loading, authenticated } = useAuth();
  const [progress, setProgress] = useState(0); // 0 = Welcome, 1 = Login
  const progressRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [exitAnimation, setExitAnimation] = useState(false);

  // Detect reduced-motion accessibility preference
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  );

  // Sync auth state if session exists
  useEffect(() => {
    if (!loading && authenticated) {
      setIsAuthenticated(true);
    }
  }, [loading, authenticated]);

  // Smooth animation driver
  const animateTo = useCallback((target: number, duration: number = 1100) => {
    if (reducedMotion) {
      progressRef.current = target;
      setProgress(target);
      return;
    }

    const start = progressRef.current;
    const diff = target - start;
    if (Math.abs(diff) < 0.002) return;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const linear = Math.min(1, elapsed / duration);
      // Smooth cubic ease-in-out curve
      const eased =
        linear < 0.5
          ? 4 * linear * linear * linear
          : 1 - Math.pow(-2 * linear + 2, 3) / 2;

      const nextVal = start + diff * eased;
      progressRef.current = nextVal;
      setProgress(nextVal);

      if (linear < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(step);
  }, [reducedMotion]);

  // Small scroll trigger: a single gentle flick smoothly initiates the animation
  useEffect(() => {
    if (isAuthenticated) return;
    let wheelAccum = 0;
    let wheelTimeout: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      wheelAccum += e.deltaY;
      if (wheelTimeout) clearTimeout(wheelTimeout);

      wheelTimeout = setTimeout(() => {
        if (wheelAccum > 30) {
          animateTo(1, 1000);
        } else if (wheelAccum < -30) {
          animateTo(0, 1000);
        }
        wheelAccum = 0;
      }, 50);
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', onWheel);
      if (wheelTimeout) clearTimeout(wheelTimeout);
    };
  }, [animateTo, isAuthenticated]);

  // Touch drag trigger for mobile / tablet
  useEffect(() => {
    if (isAuthenticated) return;
    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const endY = e.changedTouches[0].clientY;
      const diffY = startY - endY;
      if (diffY > 40) {
        animateTo(1, 1000);
      } else if (diffY < -40) {
        animateTo(0, 1000);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [animateTo, isAuthenticated]);

  // Keyboard navigation: Enter, Down Arrow, Space trigger forward animation
  useEffect(() => {
    if (isAuthenticated) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        animateTo(1, 1000);
      } else if (e.key === 'ArrowUp' || e.key === 'Escape' || e.key === 'PageUp') {
        e.preventDefault();
        animateTo(0, 1000);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [animateTo, isAuthenticated]);

  // Handle successful login with seamless cinematic exit
  const handleAuthenticated = useCallback(() => {
    setExitAnimation(true);
    setTimeout(() => {
      setIsAuthenticated(true);
    }, 700);
  }, []);

  // Branded initial loading spinner
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e27] flex items-center justify-center font-mono">
        <div className="text-center space-y-4">
          <div className="w-14 h-14 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mx-auto shadow-[0_0_20px_rgba(6,182,212,0.3)]" />
          <div className="space-y-1">
            <p className="text-xs tracking-[0.3em] text-cyan-400 font-semibold uppercase">
              NAMMA SPACE
            </p>
            <p className="text-[11px] text-slate-400 tracking-wider">
              INITIALIZING PLATFORM ACCESS
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render untouched existing app when authenticated
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // Visibility and opacity curves
  const welcomeOpacity = Math.max(0, 1 - progress * 2.2);
  const hudOpacity = Math.sin(progress * Math.PI) * 1.1; // Peaks at midpoint of transition
  const loginOpacity = Math.min(1, Math.max(0, (progress - 0.3) * 1.45));
  const isLoginVisible = progress > 0.25;

  return (
    <AnimatePresence>
      {!exitAnimation && (
        <motion.div
          key="namma-auth-gateway"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[9999] bg-[#0a0e27] text-slate-100 overflow-hidden font-sans select-none"
        >
          {/* Top Spatial Scanning Progress Bar */}
          <div className="fixed top-0 left-0 right-0 h-[2px] bg-cyan-950/60 z-50 pointer-events-none">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-400 transition-all duration-100 shadow-[0_0_12px_rgba(6,182,212,0.8)]"
              style={{ width: `${Math.max(3, progress * 100)}%` }}
            />
          </div>

          {/* 3D Holographic Building Scene */}
          <HolographicBuilding
            scrollProgress={progress}
            reducedMotion={reducedMotion}
          />

          {/* Viewport UI Overlay */}
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none z-10">

            {/* ─── 1. Welcome Screen (Visible at progress ~ 0.0 - 0.45) ─── */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-between py-10 px-4 transition-all duration-500 pointer-events-none"
              style={{
                opacity: welcomeOpacity,
                transform: `scale(${1 - progress * 0.1}) translateY(${-progress * 50}px)`,
                pointerEvents: progress < 0.25 ? 'auto' : 'none',
              }}
            >
              {/* Top Bar Branding */}
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                  <span className="font-mono text-xs font-bold text-cyan-400">NS</span>
                </div>
                <span className="font-mono text-xs tracking-[0.25em] text-slate-300 uppercase font-semibold">
                  NAMMA SPACE
                </span>
                <span className="text-slate-600 font-mono">|</span>
                <span className="font-mono text-[10px] tracking-[0.2em] text-cyan-400/80 uppercase">
                  DIGITAL TWIN
                </span>
              </motion.div>

              {/* Center Hero Branding */}
              <div className="text-center max-w-2xl px-4 space-y-4">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 1, delay: 0.3 }}
                  className="w-20 h-20 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-teal-500/10 to-transparent border border-cyan-500/30 flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(6,182,212,0.15)] backdrop-blur-sm"
                >
                  <span className="font-mono text-3xl font-bold bg-gradient-to-r from-cyan-400 to-teal-300 bg-clip-text text-transparent">
                    NS
                  </span>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.5 }}
                  className="text-4xl sm:text-6xl md:text-7xl font-bold font-mono tracking-[0.18em] text-white drop-shadow-[0_4px_24px_rgba(6,182,212,0.25)]"
                >
                  NAMMA SPACE
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.7 }}
                  className="text-xs sm:text-sm md:text-base font-mono tracking-[0.4em] text-cyan-400 uppercase font-medium"
                >
                  SPATIAL INTELLIGENCE PLATFORM
                </motion.p>

                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 1.2, delay: 0.9 }}
                  className="w-40 h-px bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent mx-auto"
                />

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 1, delay: 1.1 }}
                  className="text-xs sm:text-sm font-mono tracking-[0.25em] text-slate-400 uppercase"
                >
                  WELCOME TO NAMMA SPACE
                </motion.p>
              </div>

              {/* Bottom Enter Button & Small Scroll Prompt */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 1.3 }}
                className="flex flex-col items-center gap-3 pointer-events-auto"
              >
                {/* Primary Enter Button */}
                <button
                  onClick={() => animateTo(1, 1100)}
                  className="group relative px-8 py-3.5 rounded-xl font-mono text-xs uppercase tracking-[0.25em] font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-400 shadow-[0_0_25px_rgba(6,182,212,0.4)] hover:shadow-[0_0_35px_rgba(6,182,212,0.7)] hover:scale-105 active:scale-95 transition-all duration-300 flex items-center gap-3 cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 text-slate-900 group-hover:rotate-12 transition-transform" />
                  <span>ENTER PLATFORM</span>
                  <ArrowRight className="w-4 h-4 text-slate-900 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Subtext indicator */}
                <span className="font-mono text-[10px] tracking-[0.3em] text-slate-500 uppercase">
                  Click Enter or gentle scroll
                </span>
              </motion.div>
            </div>

            {/* ─── 2. Spatial Telemetry & Scanning Overlay (Mid-transition HUD) ─── */}
            <div
              className="absolute inset-0 pointer-events-none p-6 sm:p-10 flex flex-col justify-between transition-opacity duration-300"
              style={{ opacity: Math.max(0, hudOpacity) }}
            >
              {/* Top Left Telemetry */}
              <div className="font-mono text-[10px] text-cyan-400/80 space-y-1">
                <div className="flex items-center gap-2 text-cyan-300 font-semibold tracking-wider">
                  <Activity className="w-3.5 h-3.5 animate-pulse text-cyan-400" />
                  <span>SPATIAL COMPUTING ENGINE</span>
                </div>
                <div className="text-slate-400">X_DATUM: {(progress * 214.8).toFixed(2)}m</div>
                <div className="text-slate-400">Y_ALTITUDE: {(6.4 + progress * 12.8).toFixed(2)}m</div>
                <div className="text-slate-400">Z_RADIUS: {(18.0 - progress * 11.5).toFixed(2)}m</div>
                <div className="text-teal-400">
                  RECONSTRUCTION_PROGRESS: {Math.min(100, Math.round(progress * 100))}%
                </div>
              </div>

              {/* Top Right Telemetry */}
              <div className="font-mono text-[10px] text-cyan-400/80 space-y-1 text-right self-end">
                <div className="flex items-center justify-end gap-2 text-teal-300 font-semibold tracking-wider">
                  <span>DART LOOP PROTOCOL</span>
                  <Compass className="w-3.5 h-3.5 text-teal-400" />
                </div>
                <div className="text-slate-400">CAMERA_FIELD: 48° PERSPECTIVE</div>
                <div className="text-slate-400">WIREFRAME_DENSITY: HIGH</div>
                <div className="text-slate-400">
                  STATUS: {progress < 0.6 ? 'ACQUIRING TARGET' : 'ANCHOR LOCKED'}
                </div>
                <div className="text-cyan-400 font-medium">FIDELITY_SCORE: 98.4 / 100</div>
              </div>

              {/* Center Scanning Reticle */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="relative w-72 h-72 sm:w-96 sm:h-96">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400/50" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400/50" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400/50" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400/50" />
                  <div className="absolute inset-x-0 top-1/2 h-px bg-cyan-500/20" />
                  <div className="absolute inset-y-0 left-1/2 w-px bg-cyan-500/20" />
                </div>
              </div>

              {/* Bottom Center Mode Banner */}
              <div className="text-center font-mono text-[10px] tracking-[0.3em] text-cyan-400/70 uppercase">
                [ DIGITAL TWIN ENCLOSURE • INITIALIZING SECURITY GATEWAY ]
              </div>
            </div>

            {/* ─── 3. Authentication Interface (Visible at progress ~ 0.3 - 1.0) ─── */}
            <div
              className="absolute inset-0 flex items-center justify-center px-4 transition-all duration-300"
              style={{
                opacity: loginOpacity,
                transform: `scale(${0.92 + progress * 0.08}) translateY(${(1 - progress) * 30}px)`,
                pointerEvents: progress > 0.65 ? 'auto' : 'none',
              }}
            >
              {/* Back to Overview button when on login screen */}
              {progress > 0.65 && (
                <button
                  onClick={() => animateTo(0, 1000)}
                  className="absolute top-6 left-6 flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700/60 hover:border-cyan-500/40 text-slate-400 hover:text-cyan-300 font-mono text-xs transition-all duration-200 backdrop-blur-md cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Overview</span>
                </button>
              )}

              <LoginForm
                onAuthenticated={handleAuthenticated}
                visible={isLoginVisible}
              />
            </div>

          </div>

          {/* Vignette Atmosphere Gradient */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 45%, rgba(10, 14, 39, 0.65) 100%)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
