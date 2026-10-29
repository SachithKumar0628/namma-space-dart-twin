@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: COLMAP GPU Pipeline - DART-Twin (CUDA + COLMAP + Anaconda)
:: Output: dense\meshed.ply (final 3D mesh)
:: =============================================================================

set "WORKSPACE=%CD%"
set "CONDA_ENV_NAME=dart-twin"

:: Activate the Anaconda environment (COLMAP, pycolmap, CUDA deps)
call conda activate "%CONDA_ENV_NAME%" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Could not activate conda env '%CONDA_ENV_NAME%'.
    echo      Run: conda env create -f environment.yml && conda activate %CONDA_ENV_NAME%
    echo      Continuing with system COLMAP/Python if available...
    echo.
)

:: Dataset: real captured smartphone photos already flattened into colmap_images/
set "DATASET_DIR=%WORKSPACE%\colmap_images"
set "COLMAP_BIN=%WORKSPACE%\colmap-x64-windows-cuda\bin\colmap.exe"
set "IMG_DIR=%WORKSPACE%\colmap_images"
set "DB_PATH=%WORKSPACE%\database.db"
set "SPARSE_DIR=%WORKSPACE%\sparse"
set "DENSE_DIR=%WORKSPACE%\dense"

set "GPU_INDEX=0"
set "MAX_IMAGE_SIZE=3200"
set "SIFT_MAX_FEATURES=8192"
set "WEB_MODEL_DIR=%WORKSPACE%\public\models"
set "WEB_MODEL=%WEB_MODEL_DIR%\dart_twin_reconstruction.ply"

echo ============================================================
echo   COLMAP GPU PIPELINE - DART-TWIN
echo ============================================================
echo Workspace   : %WORKSPACE%
echo Dataset     : %DATASET_DIR%
echo COLMAP      : %COLMAP_BIN%
echo GPU index   : %GPU_INDEX%
echo Max img size: %MAX_IMAGE_SIZE% px
echo.

:: Validate
if not exist "%COLMAP_BIN%" (
    echo [ERROR] COLMAP binary not found: %COLMAP_BIN%
    exit /b 1
)
if not exist "%DATASET_DIR%" (
    echo [ERROR] Dataset not found: %DATASET_DIR%
    exit /b 1
)

echo Checking GPU...
nvidia-smi
echo.

:: STAGE 0: Verify images are already in the flat colmap_images folder
echo ============================================================
echo   STAGE 0: VERIFYING INPUT IMAGES
echo ============================================================
set /a count=0
for %%f in ("%IMG_DIR%\*") do (
    set /a count+=1
)
echo Found %count% images in %IMG_DIR%.
if %count% equ 0 (
    echo [ERROR] No images found! Place your captured photos in colmap_images/ first.
    exit /b 1
)
echo.

:: STAGE 1: Feature extraction (SIFT on GPU)
echo ============================================================
echo   STAGE 1: FEATURE EXTRACTION (SIFT GPU)
echo ============================================================
if exist "%DB_PATH%" del "%DB_PATH%"
"%COLMAP_BIN%" feature_extractor ^
    --database_path="%DB_PATH%" ^
    --image_path="%IMG_DIR%" ^
    --ImageReader.camera_model=SIMPLE_RADIAL ^
    --FeatureExtraction.type=SIFT ^
    --FeatureExtraction.use_gpu=1 ^
    --FeatureExtraction.gpu_index=%GPU_INDEX% ^
    --FeatureExtraction.max_image_size=%MAX_IMAGE_SIZE% ^
    --SiftExtraction.max_num_features=%SIFT_MAX_FEATURES%
if %errorlevel% neq 0 (
    echo [ERROR] Feature extraction failed
    exit /b %errorlevel%
)
echo [OK] Feature extraction completed.
echo.

:: STAGE 2: Feature matching (exhaustive on GPU)
echo ============================================================
echo   STAGE 2: FEATURE MATCHING (GPU)
echo ============================================================
"%COLMAP_BIN%" exhaustive_matcher ^
    --database_path="%DB_PATH%" ^
    --FeatureMatching.use_gpu=1 ^
    --FeatureMatching.gpu_index=%GPU_INDEX%
if %errorlevel% neq 0 (
    echo [ERROR] Feature matching failed
    exit /b %errorlevel%
)
echo [OK] Feature matching completed.
echo.

:: STAGE 3: Sparse reconstruction (Incremental Mapper)
echo ============================================================
echo   STAGE 3: SPARSE RECONSTRUCTION
echo ============================================================
if exist "%SPARSE_DIR%" rmdir /s /q "%SPARSE_DIR%"
mkdir "%SPARSE_DIR%"
"%COLMAP_BIN%" mapper ^
    --database_path="%DB_PATH%" ^
    --image_path="%IMG_DIR%" ^
    --output_path="%SPARSE_DIR%" ^
    --Mapper.num_threads=16 ^
    --Mapper.init_min_tri_angle=4.0 ^
    --Mapper.multiple_models=0
if %errorlevel% neq 0 (
    echo [ERROR] Sparse reconstruction failed
    exit /b %errorlevel%
)
echo [OK] Sparse reconstruction completed.
echo.

:: Check sparse results
if exist "%SPARSE_DIR%\0\cameras.txt" (
    echo Sparse model generated in %SPARSE_DIR%\0
) else (
    echo [WARNING] No sparse model found
)

:: STAGE 4: Dense reconstruction
echo ============================================================
echo   STAGE 4: DENSE RECONSTRUCTION
echo ============================================================
set "DENSE_STEREO=%DENSE_DIR%\stereo"
set "DENSE_FUSED=%DENSE_DIR%\fused.ply"
set "DENSE_MESH=%DENSE_DIR%\meshed.ply"

if exist "%DENSE_DIR%" rmdir /s /q "%DENSE_DIR%"
mkdir "%DENSE_DIR%"
mkdir "%DENSE_STEREO%"

:: 4a. Stereo depth maps (GPU)
echo [4a] Computing stereo depth maps on GPU...
"%COLMAP_BIN%" dense_stereo ^
    --workspace_path="%WORKSPACE%" ^
    --workspace_format=COLMAP ^
    --output_path="%DENSE_STEREO%" ^
    --DeepStereo.use_gpu=1 ^
    --DeepStereo.gpu_index=%GPU_INDEX% ^
    --DeepStereo.max_image_size=1600
if %errorlevel% neq 0 (
    echo [ERROR] Dense stereo failed
    exit /b %errorlevel%
)
echo [OK] Dense stereo completed.

:: 4b. Fusion
echo [4b] Fusing depth maps into point cloud...
"%COLMAP_BIN%" stereo_fusion ^
    --workspace_path="%WORKSPACE%" ^
    --workspace_format=COLMAP ^
    --input_type=geometric ^
    --output_path="%DENSE_FUSED%"
if %errorlevel% neq 0 (
    echo [ERROR] Stereo fusion failed
    exit /b %errorlevel%
)
echo [OK] Stereo fusion completed.

:: 4c. Poisson meshing
echo [4c] Running Poisson meshing...
"%COLMAP_BIN%" poisson_mesher ^
    --input_path="%DENSE_FUSED%" ^
    --output_path="%DENSE_MESH%"
if %errorlevel% neq 0 (
    echo [ERROR] Poisson meshing failed
    exit /b %errorlevel%
)
echo [OK] Poisson meshing completed.
echo.

:: COMPLETION
echo ============================================================
echo   PIPELINE COMPLETE
echo ============================================================
echo Sparse model : %SPARSE_DIR%
echo Dense stereo : %DENSE_STEREO%
echo Fused cloud  : %DENSE_FUSED%
echo Final mesh   : %DENSE_MESH%
if exist "%DENSE_MESH%" (
    echo.
    echo Mesh ready for viewing in MeshLab, CloudCompare, or Blender:
    echo   %DENSE_MESH%
    :: Publish to public/models/ so the web viewer can load it
    if not exist "%WEB_MODEL_DIR%" mkdir "%WEB_MODEL_DIR%"
    copy "%DENSE_MESH%" "%WEB_MODEL%" >nul
    if exist "%WEB_MODEL%" (
        echo.
        echo Published web asset: %WEB_MODEL%
    )
) else (
    echo [WARNING] Mesh was not generated.
)
echo.
echo Done!