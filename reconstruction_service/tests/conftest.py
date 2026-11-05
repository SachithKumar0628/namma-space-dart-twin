"""
Pytest configuration for reconstruction_service tests.

Adds the project root to sys.path so the reconstruction_service package
imports correctly (with all relative imports resolved).
"""

import sys
from pathlib import Path

# Add IITB project root so `reconstruction_service` is importable as a package.
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Also add the service dir for direct module imports.
SERVICE_DIR = Path(__file__).resolve().parent.parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))
