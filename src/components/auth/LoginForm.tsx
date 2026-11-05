import { useState, useCallback, type KeyboardEvent, type FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

interface LoginFormProps {
  onAuthenticated: () => void;
  visible: boolean;
}

export function LoginForm({ onAuthenticated, visible }: LoginFormProps) {
  const { signIn, signUp } = useAuth();

  const [email, setEmail] = useState("demo");
  const [password, setPassword] = useState("demo1234");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (loading) return;
      if (!email.trim() || !password.trim()) {
        setError("Please fill in all fields.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = isSignUp
          ? await signUp(email.trim(), password)
          : await signIn(email.trim(), password);

        if (result.ok) {
          onAuthenticated();
        } else {
          setError(result.error ?? "Authentication failed. Please try again.");
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [email, password, isSignUp, loading, signIn, signUp, onAuthenticated],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleForgotPassword = useCallback(() => {
    alert(
      "Password reset is not yet implemented. Please contact mission control.",
    );
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-md w-full pointer-events-auto"
        >
          <form
            onSubmit={handleSubmit}
            className="bg-slate-900/60 backdrop-blur-xl border border-cyan-500/20 rounded-2xl p-8 shadow-2xl shadow-cyan-500/5"
          >
            {/* ── Logo & Branding ── */}
            <div className="flex flex-col items-center mb-8">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.4 }}
                className="w-16 h-16 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/25"
              >
                <span className="font-mono text-2xl font-bold text-slate-950 tracking-tighter select-none">
                  NS
                </span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
                className="font-mono text-xl font-semibold text-slate-100 tracking-widest"
              >
                NAMMA SPACE
              </motion.h1>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35, duration: 0.4 }}
                className="text-slate-400 text-sm mt-1 font-sans"
              >
                {isSignUp ? "Create Your Account" : "Welcome Back"}
              </motion.p>
            </div>

            {/* ── Error Message ── */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── User ID (Username / Email) ── */}
            <div className="mb-4">
              <label
                htmlFor="login-email"
                className="block text-slate-400 text-xs font-sans uppercase tracking-wider mb-1.5"
              >
                User ID
              </label>
              <input
                id="login-email"
                type="text"
                autoComplete="username"
                placeholder="demo"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full bg-slate-800/80 border border-slate-600/50 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 text-sm font-sans outline-none transition-all duration-200 focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]"
              />
            </div>

            {/* ── Password ── */}
            <div className="mb-4">
              <label
                htmlFor="login-password"
                className="block text-slate-400 text-xs font-sans uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  placeholder="demo1234"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-slate-800/80 border border-slate-600/50 rounded-lg px-4 py-2.5 pr-11 text-slate-100 placeholder-slate-500 text-sm font-sans outline-none transition-all duration-200 focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/30 focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-cyan-400 transition-colors duration-150"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* ── Remember Me / Forgot Password ── */}
            <div className="flex items-center justify-between mb-4">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-600 bg-slate-800/80 text-cyan-500 focus:ring-cyan-500/40 focus:ring-offset-0 cursor-pointer accent-cyan-500"
                />
                <span className="text-slate-400 text-xs font-sans group-hover:text-slate-300 transition-colors">
                  Remember Me
                </span>
              </label>

              {!isSignUp && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-cyan-400/80 hover:text-cyan-300 text-xs font-sans transition-colors duration-150"
                >
                  Forgot Password?
                </button>
              )}
            </div>

            {/* Quick-access demo hint */}
            {!isSignUp && (
              <div className="mb-5 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-between text-[11px] font-mono text-cyan-400/90">
                <span>Default Access</span>
                <span className="text-slate-200 font-semibold tracking-wider">demo / demo1234</span>
              </div>
            )}

            {/* ── Submit Button ── */}
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={loading ? undefined : { scale: 1.015 }}
              whileTap={loading ? undefined : { scale: 0.985 }}
              className="w-full py-2.5 rounded-lg font-sans text-sm font-semibold text-slate-950 bg-gradient-to-r from-cyan-500 to-teal-500 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:brightness-110 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-slate-950"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Initializing…
                </>
              ) : isSignUp ? (
                "Create Account"
              ) : (
                "Initialize Access"
              )}
            </motion.button>

            {/* ── Mode Toggle ── */}
            <div className="mt-6 text-center">
              <span className="text-slate-500 text-xs font-sans">
                {isSignUp
                  ? "Already have an account?"
                  : "Don't have an account?"}
              </span>{" "}
              <button
                type="button"
                onClick={() => {
                  setIsSignUp((prev) => !prev);
                  setError(null);
                }}
                className="text-cyan-400 hover:text-cyan-300 text-xs font-sans font-medium transition-colors duration-150"
              >
                {isSignUp ? "Sign In" : "Sign Up"}
              </button>
            </div>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
