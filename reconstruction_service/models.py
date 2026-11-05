"""
Pydantic request/response schemas for the Namma Space reconstruction service API.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, validator


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _new_id() -> str:
    return f"obj_{uuid4().hex[:16]}"


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    space_type: str = Field(default="Custom")
    units: str = Field(default="metres")
    floor_area: Optional[float] = Field(default=None, ge=0)
    ceiling_height: Optional[float] = Field(default=None, gt=0)
    capture_method: str = Field(default="Still Photos Loop")
    status: str = Field(default="Ready for Upload")


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    space_type: Optional[str] = None
    units: Optional[str] = None
    floor_area: Optional[float] = Field(default=None, ge=0)
    ceiling_height: Optional[float] = Field(default=None, gt=0)
    capture_method: Optional[str] = None
    status: Optional[str] = None
    photo_count: Optional[int] = Field(default=None, ge=0)
    room_count: Optional[int] = Field(default=None, ge=0)
    video_count: Optional[int] = Field(default=None, ge=0)
    reconstruction_engine: Optional[str] = None
    reconstruction_progress: Optional[int] = Field(default=None, ge=0, le=100)
    last_error_message: Optional[str] = None
    reconstruction_model_stats: Optional[dict[str, Any]] = None


class ProjectResponse(ProjectBase):
    id: str
    created_at: str
    updated_at: str
    photo_count: int
    room_count: int
    video_count: int
    reconstruction_engine: str
    reconstruction_progress: int
    last_error_message: Optional[str]
    reconstruction_model_stats: Optional[dict[str, Any]]

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    ok: bool
    projects: list[ProjectResponse]


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

class RoomBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(default="Office")
    length_meters: float = Field(..., gt=0)
    width_meters: float = Field(..., gt=0)
    height_meters: float = Field(..., gt=0)
    origin_description: str = Field(default="")
    coordinate_convention: str = Field(default="Right-Handed Y-Up (Three.js standard)")
    connected_doorway_ids: list[str] = Field(default_factory=list)
    features: dict[str, Any] = Field(default_factory=dict)


class RoomCreate(RoomBase):
    project_id: str


class RoomUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = None
    length_meters: Optional[float] = Field(default=None, gt=0)
    width_meters: Optional[float] = Field(default=None, gt=0)
    height_meters: Optional[float] = Field(default=None, gt=0)
    origin_description: Optional[str] = None
    coordinate_convention: Optional[str] = None
    connected_doorway_ids: Optional[list[str]] = None
    features: Optional[dict[str, Any]] = None
    reconstruction_dimension_estimate: Optional[dict[str, Any]] = None


class RoomResponse(RoomBase):
    id: str
    project_id: str
    created_at: str
    updated_at: str
    reconstruction_dimension_estimate: Optional[dict[str, Any]]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Doorways
# ---------------------------------------------------------------------------

class DoorwayBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    connected_room_ids: list[str] = Field(..., min_items=2, max_items=2)
    width_meters: float = Field(..., gt=0)
    height_meters: float = Field(..., gt=0)
    wall_location: str = Field(default="east")
    offset_meters: float = Field(default=0.0)
    has_clear_line_of_sight: bool = Field(default=True)
    observations: dict[str, Any] = Field(default_factory=dict)


class DoorwayCreate(DoorwayBase):
    project_id: str


class DoorwayUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    connected_room_ids: Optional[list[str]] = Field(default=None, min_items=2, max_items=2)
    width_meters: Optional[float] = Field(default=None, gt=0)
    height_meters: Optional[float] = Field(default=None, gt=0)
    wall_location: Optional[str] = None
    offset_meters: Optional[float] = None
    has_clear_line_of_sight: Optional[bool] = None
    observations: Optional[dict[str, Any]] = None


class DoorwayResponse(DoorwayBase):
    id: str
    project_id: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Photos
# ---------------------------------------------------------------------------

class PhotoBase(BaseModel):
    filename: str = Field(..., min_length=1, max_length=500)
    room_id: str
    pass_label: str = Field(default="Pass A", alias="pass")
    modality: str = Field(default="Still Photograph")
    camera_pose_tag: str = Field(default="")
    focal_length_mm: float = Field(default=24.0)
    sharpness_score: int = Field(default=0, ge=0, le=100)
    exposure_review: str = Field(default="Good")
    overlap_review: str = Field(default="Sufficient (>70%)")
    occlusion_flag: bool = Field(default=False)
    doorway_anchor_id: Optional[str] = None
    reviewer_notes: str = Field(default="")
    timestamp: Optional[str] = None
    is_automated_metric: bool = Field(default=True)
    image_url: Optional[str] = None
    dominant_color: Optional[str] = None
    spatial_pose: Optional[dict[str, Any]] = None


class PhotoCreate(PhotoBase):
    project_id: str


class PhotoUpdate(BaseModel):
    filename: Optional[str] = Field(default=None, min_length=1, max_length=500)
    room_id: Optional[str] = None
    pass_label: Optional[str] = Field(default=None, alias="pass")
    modality: Optional[str] = None
    camera_pose_tag: Optional[str] = None
    focal_length_mm: Optional[float] = None
    sharpness_score: Optional[int] = Field(default=None, ge=0, le=100)
    exposure_review: Optional[str] = None
    overlap_review: Optional[str] = None
    occlusion_flag: Optional[bool] = None
    doorway_anchor_id: Optional[str] = None
    reviewer_notes: Optional[str] = None
    timestamp: Optional[str] = None
    is_automated_metric: Optional[bool] = None
    image_url: Optional[str] = None
    dominant_color: Optional[str] = None
    spatial_pose: Optional[dict[str, Any]] = None


class PhotoResponse(PhotoBase):
    id: str
    project_id: str
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

class JobBase(BaseModel):
    project_id: Optional[str] = None
    status: str = Field(default="queued")
    stage: str = Field(default="queued")
    progress: int = Field(default=0, ge=0, le=100)
    message: str = Field(default="")
    input_count: int = Field(default=0, ge=0)


class JobResponse(JobBase):
    id: str
    created_at: str
    updated_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    stats: Optional[dict[str, Any]]
    assets: Optional[dict[str, Any]]
    error: Optional[str]

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Generic responses
# ---------------------------------------------------------------------------

class MessageResponse(BaseModel):
    ok: bool
    message: str


class ErrorResponse(BaseModel):
    ok: bool = False
    error: str
    code: str = "ERROR"
