import { CapturePhotoRecord, DoorwayAnchor, RoomMetadata, SOPCheckItem, NammaProject } from '../types/dart';

export const IS_SYNTHETIC_SAMPLE_DATA = false;

// No demo data — the app starts with an empty state so users only see their
// own uploaded projects, rooms, doorways, and photos.
export const INITIAL_PROJECTS: NammaProject[] = [];
export const INITIAL_ROOMS: RoomMetadata[] = [];
export const INITIAL_DOORWAYS: DoorwayAnchor[] = [];
export const INITIAL_PHOTOS: CapturePhotoRecord[] = [];
export const INITIAL_SOP_CHECKLIST: SOPCheckItem[] = [];