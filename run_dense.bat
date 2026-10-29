@echo off
setlocal enabledelayedexpansion

:: =============================================================================
:: DENSE RECONSTRUCTION (GPU) - DART-Twin (CUDA + COLMAP + Anaconda)
:: Runs dense stereo + fusion + Poisson meshing on an existing sparse model.
:: =============================================================================

set "WORKSPACE=%CD%"
set "CONDA_ENV_NAME=dart-twin"

:: Activate the Anaconda environment
call conda activate "%CONDA_ENV_NAME%" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Could not activate conda env '%CONDA_ENV_NAME%'.
    echo      Run: conda env create -f environment.yml && conda activate %CONDA_ENV_NAME%
    echo      Continuing with system COLMAP if available...
    echo.
)

set "COLMAP_BIN=%WORKSPACE%\colmap-x64-windows-cuda\bin\colmap.exe"
set "DENSE_DIR=%WORKSPACE%\dense"
set "SPARSE_DIR=%WORKSPACE%\sparse"
set "IMG_DIR=%WORKSPACE%\colmap_images"
set "GPU_INDEX=0"
set "WEB_MODEL_DIR=%WORKSPACE%\public\models"
set "WEB_MODEL=%WEB_MODEL_DIR%\dart_twin_reconstruction.ply"

echo ============================================================
echo   DENSE RECONSTRUCTION (GPU)
echo ============================================================
echo Workspace : %WORKSPACE%
echo GPU index : %GPU_INDEX%
echo.

:: Validate
if not exist "%COLMAP_BIN%" (
    echo [ERROR] COLMAP binary not found: %COLMAP_BIN%
    exit /b 1
)
if not exist "%SPARSE_DIR%\0" (
    echo [ERROR] Sparse model not found at %SPARSE_DIR%\0
    echo      Run the sparse mapper first (run_colmap_pipeline.bat)
    exit /b 1
)

echo Checking GPU...
nvidia-smi
echo.

:: Step 1: Image undistorter
set "UNDISTORTED=%DENSE_DIR%\undistorted"
if not exist "%UNDISTORTED%" mkdir "%UNDISTORTED%"

echo [Step 1] Undistorting images for dense reconstruction...
"%COLMAP_BIN%" image_undistorter ^
    --image_path="%IMG_DIR%" ^
    --input_path="%SPARSE_DIR%\0" ^
    --output_path="%UNDISTORTED%" ^
    --output_type=COLMAP ^
    --max_image_size=1600
if %errorlevel% neq 0 (
    echo [ERROR] Image undistorter failed with code %errorlevel%
    exit /b %errorlevel%
)
echo [OK] Image undistorter completed.
echo.

:: Step 2: Dense stereo (depth maps on GPU) - uses dense_stereo (COLMAP 3.9+)
echo [Step 2] Computing dense stereo depth maps on GPU...
if exist "%DENSE_DIR%\stereo" rmdir /s /q "%DENSE_DIR%\stereo"
mkdir "%DENSE_DIR%\stereo"
"%COLMAP_BIN%" dense_stereo ^
    --workspace_path="%WORKSPACE%" ^
    --workspace_format=COLMAP ^
    --output_path="%DENSE_DIR%\stereo" ^
    --DeepStereo.use_gpu=1 ^
    --DeepStereo.gpu_index=%GPU_INDEX% ^
    --DeepStereo.max_image_size=1600
if %errorlevel% neq 0 (
    echo [ERROR] Dense stereo failed with code %errorlevel%
    exit /b %errorlevel%
)
echo [OK] Dense stereo completed.
echo.

:: Step 3: Stereo fusion
set "DENSE_FUSED=%DENSE_DIR%\fused.ply"
echo [Step 3] Fusing depth maps into point cloud...
"%COLMAP_BIN%" stereo_fusion ^
    --workspace_path="%WORKSPACE%" ^
    --workspace_format=COLMAP ^
    --input_type=geometric ^
    --output_path="%DENSE_FUSED%"
if %errorlevel% neq 0 (
    echo [ERROR] Stereo fusion failed with code %errorlevel%
    exit /b %errorlevel%
)
echo [OK] Stereo fusion completed.
echo.

:: Step 4: Poisson meshing
set "DENSE_MESH=%DENSE_DIR%\meshed.ply"
echo [Step 4] Running Poisson meshing...
"%COLMAP_BIN%" poisson_mesher ^
    --input_path="%DENSE_FUSED%" ^
    --output_path="%DENSE_MESH%"
if %errorlevel% neq 0 (
    echo [ERROR] Poisson meshing failed with code %errorlevel%
    exit /b %errorlevel%
)
echo [OK] Poisson meshing completed.
echo.

:: Publish to public/models/ so the web viewer can load it
if not exist "%WEB_MODEL_DIR%" mkdir "%WEB_MODEL_DIR%"
copy "%DENSE_MESH%" "%WEB_MODEL%" >nul
if exist "%WEB_MODEL%" (
    echo Published web asset: %WEB_MODEL%
)

echo ============================================================
echo   DENSE RECONSTRUCTION COMPLETE
echo ============================================================
echo Final mesh: %DENSE_MESH%
if exist "%DENSE_MESH%" (
    echo View with: MeshLab, CloudCompare, or Blender
    echo Web asset: %WEB_MODEL%
) else (
    echo [WARNING] Mesh was not generated.
)
