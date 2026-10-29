# COLMAP GPU Pipeline - DART-Twin (CUDA + COLMAP + Anaconda)
# Output: dense/meshed.ply (final 3D mesh)

$ErrorActionPreference = "Stop"
$W = Resolve-Path "."
$ENV = "dart-twin"

# Activate the Anaconda environment (COLMAP, pycolmap, CUDA deps)
try {
    & conda activate $ENV | Out-Null
    Write-Host "Conda environment active: $ENV" -Green
} catch {
    Write-Host "[WARN] Could not activate conda env '$ENV'." -Yellow
    Write-Host "       Run: conda env create -f environment.yml`n       conda activate $ENV" -Yellow
    Write-Host "       Continuing with system COLMAP/Python if available..." -Yellow
    Write-Host ""
}

# Dataset: real captured smartphone photos already flattened into colmap_images/
$DS = Join-Path $W "colmap_images"
$CB = Join-Path $W "colmap-x64-windows-cuda\bin\colmap.exe"
$IMG = Join-Path $W "colmap_images"
$DB = Join-Path $W "database.db"
$SP = Join-Path $W "sparse"
$DN = Join-Path $W "dense"
$GPU = 0
$MAXSZ = 3200
$SIFT = 8192

function Sec($t){Write-Host "";Write-Host ("="*60);Write-Host "  $t";Write-Host ("="*60);Write-Host ""}
function Run($c,$d){Write-Host "[STEP] $d" -ForegroundColor Cyan;Write-Host "[CMD]  $c" -ForegroundColor DarkGray;& cmd /c $c;if($LASTEXITCODE -ne 0){Write-Host "[ERROR] failed ($LASTEXITCODE)" -ForegroundColor Red;exit $LASTEXITCODE};Write-Host "[OK] $d" -ForegroundColor Green}

Sec "COLMAP GPU PIPELINE - DART-TWIN"
if(-not (Test-Path $CB)){Write-Host "[ERROR] COLMAP not found: $CB" -Red;exit 1}
if(-not (Test-Path $DS)){Write-Host "[ERROR] Dataset not found: $DS" -Red;exit 1}
Write-Host "Workspace : $W" -Yellow;Write-Host "Dataset   : $DS";Write-Host "GPU index : $GPU";Write-Host ""
Write-Host "Checking GPU..." -Cyan;& nvidia-smi | Select-Object -First 5

# STAGE 0: verify images are already in the flat colmap_images folder
Sec "STAGE 0: VERIFYING INPUT IMAGES"
$imgs = Get-ChildItem $IMG -File | Measure-Object
Write-Host "Found $($imgs.Count) images in $IMG" -Green
if($imgs.Count -eq 0){Write-Host "[ERROR] No images! Place your captured photos in colmap_images/ first." -Red;exit 1}

# STAGE 1: feature extraction (GPU)
Sec "STAGE 1: FEATURE EXTRACTION (SIFT GPU)"
if(Test-Path $DB){Remove-Item $DB -Force}
$c="`"$CB`" feature_extractor `"--database_path=$DB`" `"--image_path=$IMG`" `"--ImageReader.camera_model=SIMPLE_RADIAL`" `"--FeatureExtraction.type=SIFT`" `"--FeatureExtraction.use_gpu=1`" `"--FeatureExtraction.gpu_index=$GPU`" `"--FeatureExtraction.max_image_size=$MAXSZ`" `"--SiftExtraction.max_num_features=$SIFT`""
Run $c "Feature Extraction"

# STAGE 2: matching (GPU)
Sec "STAGE 2: FEATURE MATCHING (GPU)"
$c="`"$CB`" exhaustive_matcher `"--database_path=$DB`" `"--FeatureMatching.use_gpu=1`" `"--FeatureMatching.gpu_index=$GPU`""
Run $c "Exhaustive Matching"

# STAGE 3: sparse reconstruction
Sec "STAGE 3: SPARSE RECONSTRUCTION"
if(Test-Path $SP){Remove-Item $SP -Recurse -Force}
New-Item -ItemType Directory -Path $SP | Out-Null
$c="`"$CB`" mapper `"--database_path=$DB`" `"--image_path=$IMG`" `"--output_path=$SP`" `"--Mapper.num_threads=16`" `"--Mapper.init_min_tri_angle=4.0`" `"--Mapper.multiple_models=0`""
Run $c "Sparse Mapper"
$md=Join-Path $SP "0"
if(Test-Path $md){
 $ic=(Get-ChildItem "$md\images.txt" -EA SilentlyContinue).Count
 $pc=(Get-ChildItem "$md\points3D.txt" -EA SilentlyContinue).Count
 Write-Host "Sparse: $ic images, $pc points" -Green
}else{Write-Host "[WARN] No sparse model" -Yellow}

# STAGE 4: dense reconstruction
Sec "STAGE 4: DENSE RECONSTRUCTION"
$DS2=Join-Path $DN "stereo";$DF=Join-Path $DN "fused.ply";$DM=Join-Path $DN "meshed.ply"
if(Test-Path $DN){Remove-Item $DN -Recurse -Force}
New-Item -ItemType Directory -Path $DN | Out-Null;New-Item -ItemType Directory -Path $DS2 | Out-Null

$c="`"$CB`" dense_stereo `"--workspace_path=$W`" `"--workspace_format=COLMAP`" `"--output_path=$DS2`" `"--DeepStereo.use_gpu=1`" `"--DeepStereo.gpu_index=$GPU`" `"--DeepStereo.max_image_size=1600`""
Run $c "Dense Stereo"

$c="`"$CB`" stereo_fusion `"--workspace_path=$W`" `"--workspace_format=COLMAP`" `"--input_type=geometric`" `"--output_path=$DF`""
Run $c "Stereo Fusion"

$c="`"$CB`" poisson_mesher `"--input_path=$DF`" `"--output_path=$DM`""
Run $c "Poisson Meshing"

Sec "DONE"
Write-Host "Mesh: $DM" -Yellow
if(Test-Path $DM){Write-Host "Size: $((Get-Item $DM).Length/1MB) MB" -Yellow;Write-Host "View in MeshLab/CloudCompare/Blender" -Cyan}
Write-Host "" -Green