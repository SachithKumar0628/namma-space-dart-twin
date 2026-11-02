# DART-Twin / Namma Space: Setup Verification Script
# Verifies the reconstruction runtime (conda `pytorch` env) and all external
# tools. Reports the REAL state — no fabricated "CUDA GPU" claims.
#
# Run:  .\scripts\verify_setup.ps1
# Exit code 0 = all critical checks passed. Exit code 1 = one or more failed.

$ErrorActionPreference = "Continue"
$failures = 0
$warnings = 0
$root = (Resolve-Path ".").Path
$envName = "pytorch"
$condaExe = "C:\Users\SACHITH KUMAR\anaconda3\Scripts\conda.exe"
$tmpPy = Join-Path $env:TEMP "namma_verify_check.py"

function Write-Status($label, $ok, $detail = "", $kind = "critical") {
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $color = if ($ok) { "Green" } else { "Red" }
    if ($kind -eq "info") { $mark = "INFO"; $color = "Cyan" }
    Write-Host ("{0,-10} : {1}" -f $mark, $label) -ForegroundColor $color
    if ($detail) { Write-Host ("            {0}" -f $detail) -ForegroundColor DarkGray }
    if (-not $ok -and $kind -eq "critical") { $script:failures++ }
    if ($kind -eq "info" -and -not $ok) { $script:warnings++ }
}

function Run-PyCheck($scriptBody) {
    Set-Content -LiteralPath $tmpPy -Value $scriptBody -Encoding UTF8
    $prev = $env:PYTHONPATH
    $env:PYTHONPATH = $root
    $result = & $condaExe run -n $envName python $tmpPy 2>&1
    $code = $LASTEXITCODE
    $env:PYTHONPATH = $prev
    Remove-Item -LiteralPath $tmpPy -ErrorAction SilentlyContinue
    return @{ code = $code; output = $result }
}

Write-Host ("=" * 66)
Write-Host "  Namma Space — Reconstruction Environment Verification" -ForegroundColor Cyan
Write-Host ("=" * 66)
Write-Host ""

if (-not (Test-Path $condaExe)) {
    Write-Host "conda.exe not found at $condaExe" -ForegroundColor Red
    exit 1
}

# ------------------------------------------------------------------ 1. conda env
$condaEnvList = & $condaExe env list 2>$null
$envActive = $condaEnvList -match $envName
Write-Status "Conda env '$envName'" $envActive "Activate with: conda activate $envName"

# ------------------------------------------------------------------ 2. Python / torch / CUDA
$pyOk = $false; $pyDetail = ""
if ($envActive) {
    $r = Run-PyCheck @'
import torch, sys
print('PYTHON', sys.version.split()[0])
print('TORCH', torch.__version__)
print('CUDA_AVAILABLE', torch.cuda.is_available())
if torch.cuda.is_available():
    print('DEVICE', torch.cuda.get_device_name(0))
    free, total = torch.cuda.mem_get_info(0)
    print('VRAM_FREE_MB', str(free // 1024 // 1024))
    print('VRAM_TOTAL_MB', str(total // 1024 // 1024))
'@
    if ($r.code -eq 0) {
        $pyOk = $true
        $pyDetail = ($r.output -join " | ")
    } else {
        $pyDetail = "torch/CUDA check failed"
    }
} else {
    $pyDetail = "Activate conda env first: conda activate $envName"
}
Write-Status "Python + CUDA torch (pytorch env)" $pyOk $pyDetail

# ------------------------------------------------------------------ 3. Service dependencies
$svcOk = $false; $svcDetail = ""
if ($envActive) {
    $r = Run-PyCheck @'
import fastapi, uvicorn, PIL, numpy, multipart, cv2, open3d
print('FASTAPI', fastapi.__version__)
print('UVICORN', uvicorn.__version__)
print('PILLOW', PIL.__version__)
print('NUMPY', numpy.__version__)
print('PYTHON_MULTIPART', multipart.__version__)
print('OPENCV', cv2.__version__)
print('OPEN3D', open3d.__version__)
'@
    if ($r.code -eq 0) {
        $svcOk = $true
        $svcDetail = ($r.output -join " | ")
    } else {
        $svcDetail = "Run: pip install -r reconstruction_service/requirements.txt"
    }
} else {
    $svcDetail = "Activate conda env first"
}
Write-Status "Reconstruction service deps" $svcOk $svcDetail

# ------------------------------------------------------------------ 4. pycolmap (CPU-only on Windows)
$pycolmapOk = $false; $pycolmapDetail = ""
if ($envActive) {
    $r = Run-PyCheck @'
import pycolmap
print('PYCOLMAP', pycolmap.__version__)
print('HAS_CUDA', pycolmap.has_cuda)
'@
    if ($r.code -eq 0) {
        $pycolmapOk = $true
        $version = ($r.output[0] -replace '^PYCOLMAP\s+', '')
        $hasCuda = ($r.output -match "HAS_CUDA True")
        $pycolmapDetail = "pycolmap $version — SfM runs on CPU (Windows wheels are CPU-only)."
        if ($hasCuda) { $pycolmapDetail += " CUDA build detected." }
    } else {
        $pycolmapDetail = "Run: pip install -r reconstruction_service/requirements.txt"
    }
} else {
    $pycolmapDetail = "Activate conda env first"
}
Write-Status "pycolmap SfM binding" $pycolmapOk $pycolmapDetail

# ------------------------------------------------------------------ 5. COLMAP CLI (CUDA build, optional dense engine)
$colmapVendored = Join-Path $root "colmap-x64-windows-cuda\bin\colmap.exe"
$colmapCandidates = @($colmapVendored, "C:\COLMAP\colmap-x64-windows-cuda\bin\colmap.exe")
$colmapFound = $null
foreach ($c in $colmapCandidates) { if (Test-Path $c) { $colmapFound = $c; break } }
if (-not $colmapFound) { $colmapFound = Get-Command colmap -ErrorAction SilentlyContinue }
$colmapOk = $colmapFound -ne $null
$colmapDetail = if ($colmapFound) { "Found at: $colmapFound" } else { "Set COLMAP_BINARY to enable dense MVS (PatchMatch stereo)." }
Write-Status "COLMAP CLI (CUDA build)" $colmapOk $colmapDetail

# ------------------------------------------------------------------ 6. FFmpeg
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffmpegOk = $ffmpegCmd -ne $null
$ffmpegDetail = if ($ffmpegOk) { ($ffmpegCmd.Source) } else { "Install FFmpeg for server-side video frame extraction." }
Write-Status "FFmpeg" $ffmpegOk $ffmpegDetail

# ------------------------------------------------------------------ 7. Blender (not on PATH)
$blenderCandidates = @(
    "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
)
$blenderFound = $null
foreach ($c in $blenderCandidates) { if ($c -and (Test-Path $c)) { $blenderFound = $c; break } }
if (-not $blenderFound) {
    $candidate = Get-ChildItem "C:\Program Files\Blender Foundation\Blender *\blender.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($candidate) { $blenderFound = $candidate.FullName }
}
$blenderOk = $blenderFound -ne $null
$blenderDetail = if ($blenderFound) { "Found at: $blenderFound" } else { "Set BLENDER_BINARY for PLY->GLB mesh export." }
Write-Status "Blender" $blenderOk $blenderDetail

# ------------------------------------------------------------------ 8. Brush Gaussian splatting trainer
$brushCandidates = @(
    Join-Path $root ".tools\brush\brush_app.exe"
    Join-Path $root "brush_app.exe"
)
$brushFound = $null
foreach ($c in $brushCandidates) { if (Test-Path $c) { $brushFound = $c; break } }
$brushOk = $brushFound -ne $null
$brushDetail = if ($brushFound) { "Found at: $brushFound" } else { "Place brush_app.exe in .tools/brush/ or set BRUSH_BINARY." }
Write-Status "Brush splat trainer" $brushOk $brushDetail

# ------------------------------------------------------------------ 9. gsplat (installed, not buildable on Windows here)
$gsplatOk = $false; $gsplatDetail = ""; $gsplatReady = $false
if ($envActive) {
    $r = Run-PyCheck @'
import json
from reconstruction_service.engines.gsplat_engine import gsplat_status
print(json.dumps(gsplat_status()))
'@
    if ($r.code -eq 0) {
        try {
            $gsplatInfo = (($r.output -join "`n") | ConvertFrom-Json)
            $gsplatOk = ($gsplatInfo.installed -eq $true)
            $gsplatReady = ($gsplatInfo.ready -eq $true)
            $gsplatDetail = "gsplat $($gsplatInfo.version) installed; CUDA backend ready=$($gsplatReady). Reason: $($gsplatInfo.reason)"
            if (-not $gsplatReady) { $gsplatDetail += " — Brush is the working splat trainer." }
        } catch { $gsplatDetail = "Could not parse gsplat status." }
    } else {
        $gsplatDetail = "gsplat not installed."
    }
} else {
    $gsplatDetail = "Activate conda env first"
}
Write-Status "gsplat (optional trainer)" $gsplatOk $gsplatDetail "info"

# ------------------------------------------------------------------ 10. Test fixtures (real rotunda photos)
$fixtureDir = Join-Path $root "test\fixtures\rotunda"
$fixtureCount = @(Get-ChildItem $fixtureDir -File 2>$null).Count
$fixtureOk = $fixtureCount -ge 3
Write-Status "Test fixtures (rotunda photos)" $fixtureOk "$fixtureCount real photos found"

# ------------------------------------------------------------------ 11. Output data dir writable
$dataDir = Join-Path $root "data\reconstructions"
try {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $writeOk = Test-Path $dataDir
    $writeDetail = $dataDir
} catch {
    $writeOk = $false
    $writeDetail = $_.Exception.Message
}
Write-Status "Data dir data/reconstructions/" $writeOk $writeDetail

Write-Host ""
Write-Host ("=" * 66)
if ($failures -eq 0) {
    Write-Host "RESULT: ALL CRITICAL CHECKS PASSED" -ForegroundColor Green
    if ($warnings -gt 0) { Write-Host "($warnings informational item(s) - gsplat/dense optional)" -ForegroundColor Cyan }
    Write-Host ""
    Write-Host "Next: run the service with the pytorch env activated:" -ForegroundColor Cyan
    Write-Host "  conda activate pytorch" -ForegroundColor Cyan
    Write-Host "  npm run reconstruction" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "RESULT: $failures CHECK(S) FAILED — fix the items above." -ForegroundColor Red
    exit 1
}
