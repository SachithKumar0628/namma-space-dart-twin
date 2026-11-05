# Namma Space — Windows environment verification script.
# Checks: Node.js, npm, Git, Three.js, React Three Fiber, Frontend build.

$ErrorActionPreference = "Continue"
$failures = 0

function Pass($msg) { Write-Host ("PASS : " + $msg) -ForegroundColor Green }
function Fail($msg) { Write-Host ("FAIL : " + $msg) -ForegroundColor Red; $script:failures++ }

$root = Resolve-Path "."
$pkg = Join-Path $root "package.json"

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Pass ("Node.js " + (node --version 2>$null)) } else { Fail "Node.js (not on PATH)" }

# npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) { Pass ("npm v" + (npm --version 2>$null)) } else { Fail "npm (not on PATH)" }

# Git
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Pass ("Git " + (git --version 2>$null)) } else { Fail "Git (not on PATH)" }

# package.json
if (Test-Path $pkg) {
  Pass "package.json present"
  $txt = Get-Content $pkg -Raw

  function Dep($name) { $script:txt.IndexOf('"' + $name + '":') -ge 0 }

  if (Dep "three") { Pass "Three.js installed" } else { Fail "Three.js missing" }
  if (Dep "@react-three/fiber") { Pass "React Three Fiber installed" } else { Fail "React Three Fiber missing" }
  if (Dep "@react-three/drei") { Pass "drei installed" } else { Fail "drei missing" }
  if (Dep "react") { Pass "React installed" } else { Fail "React missing" }
} else {
  Fail "package.json not found"
}

# Frontend build
Write-Host "Running frontend build..." -ForegroundColor Cyan
$out = npx vite build 2>&1
if ($LASTEXITCODE -eq 0) { Pass "Vite production build" } else {
  Fail "Vite production build"
  $out | Select-Object -Last 5
}

Write-Host ("=" * 60)
if ($failures -eq 0) {
  Write-Host "RESULT: ALL WINDOWS CHECKS PASSED" -ForegroundColor Green
  exit 0
} else {
  Write-Host "RESULT: SOME CHECKS FAILED" -ForegroundColor Red
  exit 1
}
