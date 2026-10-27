import type { RoomMetadata, SpaceType } from '../types/dart';

export interface PhotoRoomGroup {
  key: string;
  name: string;
  category: RoomMetadata['category'];
}

const ROOM_PATTERNS: Array<{
  pattern: RegExp;
  key: string;
  name: string;
  category: RoomMetadata['category'];
}> = [
  { pattern: /entrance|foyer|entry/i, key: 'entrance', name: 'Entrance', category: 'Entrance' },
  { pattern: /living|salon|hall/i, key: 'living', name: 'Living Room', category: 'Living' },
  { pattern: /dining/i, key: 'dining', name: 'Dining Area', category: 'Dining' },
  { pattern: /kitchen/i, key: 'kitchen', name: 'Kitchen', category: 'Kitchen' },
  { pattern: /bed(room)?|master/i, key: 'bedroom', name: 'Bedroom', category: 'Bedroom' },
  { pattern: /balcony|terrace/i, key: 'balcony', name: 'Balcony', category: 'Balcony' },
  { pattern: /bath(room)?|toilet|wash/i, key: 'bathroom', name: 'Bathroom', category: 'Bathroom' },
  { pattern: /office|study/i, key: 'office', name: 'Office', category: 'Office' },
];

export function inferPhotoRoomGroup(filename: string): PhotoRoomGroup | null {
  const match = ROOM_PATTERNS.find((entry) => entry.pattern.test(filename));
  return match
    ? { key: match.key, name: match.name, category: match.category }
    : null;
}

export function groupPhotoFilenames(
  filenames: string[],
  fallbackName = 'Captured Space',
  fallbackCategory: RoomMetadata['category'] = 'Living'
): PhotoRoomGroup[] {
  const groups: PhotoRoomGroup[] = [];
  const seen = new Set<string>();
  filenames.forEach((filename) => {
    const inferred = inferPhotoRoomGroup(filename);
    const group = inferred || {
      key: 'captured',
      name: fallbackName,
      category: fallbackCategory,
    };
    if (!seen.has(group.key)) {
      seen.add(group.key);
      groups.push(group);
    }
  });
  return groups;
}

export function categoryForSpaceType(spaceType: SpaceType): RoomMetadata['category'] {
  if (spaceType === 'Bedroom') return 'Bedroom';
  if (spaceType === 'Office') return 'Office';
  if (spaceType === 'Corridor') return 'Corridor';
  return 'Living';
}
