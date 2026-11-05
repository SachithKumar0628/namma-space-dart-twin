#!/bin/bash
# Namma Space — WSL environment verification script.
# Checks: Python, PyTorch, CUDA, GPU, COLMAP, gsplat, Open3D, trimesh, FFmpeg, Blender, FastAPI.
# Run:  wsl -d Ubuntu bash scripts/verify_wsl.sh
# Exit 0 = all critical checks passed.

set -u
PY=/home/mrrobot/miniforge3/envs/namma-core/bin/python
NAMMA_BIN=/home/mrrobot/miniforge3/envs/namma-core/bin
failures=0

ok()  { echo "PASS : $*"; }
fail() { echo "FAIL : $*"; failures=$((failures+1)); }
info() { echo "INFO : $*"; }

echo "============================================================"
echo "  Namma Space — WSL Environment Verification (namma-core)"
echo "============================================================"

# --- Python ---
if $PY --version >/dev/null 2>&1; then
  ok "Python ($($PY --version 2>&1))"
else
  fail "Python"
fi

# --- PyTorch + CUDA + GPU ---
torch_out=$($PY -c 'import torch
print(torch.__version__)
print(torch.cuda.is_available())
if torch.cuda.is_available():
    print(torch.cuda.get_device_name(0))
    f,t=torch.cuda.mem_get_info(0)
    print(str(f//1024//1024))
    print(str(t//1024//1024))' 2>&1)
if echo "$torch_out" | grep -q "True"; then
  ok "PyTorch CUDA (GPU detected)"
  info "  $torch_out"
else
  info "PyTorch CPU (WSL namma-core — GPU training runs on Windows env)"
  info "  $torch_out"
fi

# --- COLMAP ---
if command -v colmap >/dev/null 2>&1; then
  colmap_ver=$(colmap help 2>&1 | head -1)
  ok "COLMAP ($colmap_ver)"
else
  fail "COLMAP (not found)"
fi

# --- gsplat ---
if $PY -c 'import gsplat; print(gsplat.__version__)' >/dev/null 2>&1; then
  ok "gsplat ($($PY -c 'import gsplat; print(gsplat.__version__)'))"
else
  fail "gsplat (not importable)"
fi

# --- Open3D ---
if $PY -c 'import open3d; print(open3d.__version__)' >/dev/null 2>&1; then
  ok "Open3D ($($PY -c 'import open3d; print(open3d.__version__)'))"
else
  fail "Open3D (not importable)"
fi

# --- trimesh ---
if $PY -c 'import trimesh; print(trimesh.__version__)' >/dev/null 2>&1; then
  ok "trimesh ($($PY -c 'import trimesh; print(trimesh.__version__)'))"
else
  fail "trimesh (not importable)"
fi

# --- FFmpeg ---
if command -v ffmpeg >/dev/null 2>&1; then
  ok "FFmpeg ($(ffmpeg -version 2>&1 | head -1))"
elif $NAMMA_BIN/ffmpeg -version >/dev/null 2>&1; then
  ok "FFmpeg (in namma-core env: $($NAMMA_BIN/ffmpeg -version 2>&1 | head -1))"
else
  fail "FFmpeg (not found)"
fi

# --- Blender ---
if command -v blender >/dev/null 2>&1; then
  ok "Blender ($(blender --version 2>&1 | head -1))"
else
  info "Blender not in WSL (Windows: C:\Program Files\Blender Foundation\Blender 5.2\blender.exe)"
fi

# --- FastAPI ---
if $PY -c 'import fastapi; print(fastapi.__version__)' >/dev/null 2>&1; then
  ok "FastAPI ($($PY -c 'import fastapi; print(fastapi.__version__)'))"
else
  fail "FastAPI (not importable)"
fi

# --- pycolmap ---
if $PY -c 'import pycolmap; print(pycolmap.__version__)' >/dev/null 2>&1; then
  ok "pycolmap ($($PY -c 'import pycolmap; print(pycolmap.__version__)'))"
else
  fail "pycolmap (not importable)"
fi

echo "------------------------------------------------------------"
if [ "$failures" -eq 0 ]; then
  echo "RESULT: ALL WSL CHECKS PASSED"
  exit 0
else
  echo "RESULT: $failures CHECK(S) FAILED"
  exit 1
fi
