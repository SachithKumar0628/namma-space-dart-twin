@echo off
setlocal enabledelayedexpansion

set "WORKSPACE=%CD%"
set "COLMAP_BIN=%WORKSPACE%\colmap-x64-windows-cuda\bin\colmap.exe"
set "DENSE_DIR=%WORKSPACE%\dense"
set "SPARSE_DIR=%WORKSPACE%\sparse"
set "IMG_DIR=%WORKSPACE%\colmap_images"
set "GPU_INDEX=0"

echo ============================================================
echo   DENSE RECONSTRUCTION (GPU)
echo ============================================================
echo Workspace : %WORKSPACE%
echo GPU index : %GPU_INDEX%
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

:: Step 2: Patch match stereo (depth maps on GPU)
echo [Step 2] Computing stereo depth maps on GPU...
"%COLMAP_BIN%" patch_match_stereo ^
    --workspace_path="%UNDISTORTED%" ^
    --workspace_format=COLMAP ^
    --PatchMatchStereo.gpu_index=%GPU_INDEX% ^
    --PatchMatchStereo.max_image_size=1600
if %errorlevel% neq 0 (
    echo [ERROR] Patch match stereo failed with code %errorlevel%
    exit /b %errorlevel%
)
echo [OK] Patch match stereo completed.
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

echo ============================================================
echo   DENSE RECONSTRUCTION COMPLETE
echo ============================================================
echo Final mesh: %DENSE_MESH%
if exist "%DENSE_MESH%" (
    echo View with: MeshLab, CloudCompare, or Blender
) else (
    echo [WARNING] Mesh was not generated.
)