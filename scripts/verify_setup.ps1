# DART-Twin: Setup Verification Script
# Verifies the CUDA + COLMAP + Anaconda environment is ready for 3D model generation.
# Run:  .\scripts\verify_setup.ps1
#
# Exit code 0 = all checks passed. Exit code 1 = one or more checks failed.

$ErrorActionPreference = "Continue"
$failures = 0
$root = Resolve-Path "."
$envName = "dart-twin"

function Write-Status($label, $ok, $detail = "") {
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    $color = if ($ok) { "Green" } else { "Red" }
    Write-Host ("{0,-10} : {1}" -f $mark, $label) -ForegroundColor $color
    if ($detail) { Write-Host ("            {0}" -f $detail) -ForegroundColor DarkGray }
    if (-not $ok) { $script:failures++ }
}

Write-Host ("=" * 60)
Write-Host "  DART-Twin Environment Verification" -ForegroundColor Cyan
Write-Host ("=" * 60)
Write-Host ""

# 1. Anaconda environment
$condaEnv = & conda env list 2>$null
$envActive = $condaEnv -match $envName
Write-Status "Anaconda env '$envName'" $envActive "Activate with: conda activate $envName"

# 2. CUDA GPU via nvidia-smi
$nvidia = & nvidia-smi 2>$null
$gpuOk = $LASTEXITCODE -eq 0 -and $nvidia -match "GeForce|RTX|Tesla|Quadro|A100|H100"
Write-Status "CUDA GPU (nvidia-smi)" $gpuOk "Requires NVIDIA driver + CUDA-capable GPU"

# 3. COLMAP binary (vendored CUDA build preferred, then PATH)
$colmapVendored = Join-Path $root "colmap-x64-windows-cuda\bin\colmap.exe"
$colmapPath = if (Test-Path $colmapVendored) { $colmapVendored } else { Get-Command colmap -ErrorAction SilentlyContinue }
$colmapOk = $colmapPath -ne $null
Write-Status "COLMAP binary" $colmapOk "Found at: $colmapPath"

# 4. pycolmap import (inside conda env)
$pycolmapOk = $false
$pycolmapDetail = ""
if ($envActive) {
    $pyResult = & python -c "import pycolmap; print(pycolmap.__version__)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $pyResult) {
        $pycolmapOk = $true
        $pycolmapDetail = "pycolmap $pyResult"
    } else {
        $pycolmapDetail = "Run: pip install -r reconstruction_service/requirements.txt"
    }
} else {
    $pycolmapDetail = "Activate conda env first: conda activate $envName"
}
Write-Status "pycolmap Python binding" $pycolmapOk $pycolmapDetail

# 5. FastAPI reconstruction service deps
$fastapiOk = $false
if ($envActive) {
    $fResult = & python -c "import fastapi, uvicorn, PIL, numpy; print('deps ok')" 2>$null
    $fastapiOk = ($LASTEXITCODE -eq 0)
    if (-not $fastapiOk) { $fastapiDetail = "Run: pip install -r reconstruction_service/requirements.txt" }
    else { $fastapiDetail = "fastapi, uvicorn, Pillow, numpy present" }
} else {
    $fastapiDetail = "Activate conda env first"
}
Write-Status "Reconstruction service deps" $fastapiOk $fastapiDetail

# 6. Input images present
$imgCount = @(Get-ChildItem (Join-Path $root "colmap_images") -File 2>$null).Count
$imagesOk = $imgCount -gt 0
Write-Status "Input images (colmap_images/)" $imagesOk "$imgCount photos found"

# 7. Output directory writable
$outDir = Join-Path $root "public\models"
try {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    $writeOk = Test-Path $outDir
    $writeDetail = "$outDir"
} catch {
    $writeOk = $false
    $writeDetail = $_.Exception.Message
}
Write-Status "Output dir public/models/" $writeOk $writeDetail

Write-Host ""
Write-Host ("=" * 60)
if ($failures -eq 0) {
    Write-Host "RESULT: ALL CHECKS PASSED - ready to run the reconstruction pipeline." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next: python pipeline/reconstruct_full.py --images colmap_images --doorway-width 1.05 --gpu-index 0" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "RESULT: $failures CHECK(S) FAILED - fix the items above before reconstructing." -ForegroundColor Red
    exit 1
}
