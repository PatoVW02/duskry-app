export type SceneId =
  | 'night-mountains'
  | 'forest-dawn'
  | 'alpine-day'
  | 'ocean-sunset'
  | 'desert-canyon'
  | 'arctic-night'
  | 'emerald-dusk'
  | 'harbor-mist'
  | 'amber-city'
  | 'coastal-breeze'
  | 'golden-meadow'
  | 'sunlit-canyon';

export interface AutoSceneSlot {
  startMinutes: number;
  scene: SceneId;
}

export const SCENE_IDS: SceneId[] = [
  'night-mountains',
  'forest-dawn',
  'alpine-day',
  'ocean-sunset',
  'desert-canyon',
  'arctic-night',
  'emerald-dusk',
  'harbor-mist',
  'amber-city',
  'coastal-breeze',
  'golden-meadow',
  'sunlit-canyon',
];

export const SCENE_LABELS: Record<SceneId, string> = {
  'night-mountains': 'Night Mountains',
  'forest-dawn': 'Forest Dawn',
  'alpine-day': 'Alpine Day',
  'ocean-sunset': 'Ocean Sunset',
  'desert-canyon': 'Desert Canyon',
  'arctic-night': 'Arctic Night',
  'emerald-dusk': 'Emerald Dusk',
  'harbor-mist': 'Harbor Mist',
  'amber-city': 'Amber City',
  'coastal-breeze': 'Coastal Breeze',
  'golden-meadow': 'Golden Meadow',
  'sunlit-canyon': 'Sunlit Canyon',
};

export const DEFAULT_AUTO_SCENE_SCHEDULE: AutoSceneSlot[] = [
  { startMinutes: 0, scene: 'arctic-night' },
  { startMinutes: 5 * 60, scene: 'golden-meadow' },
  { startMinutes: 8 * 60, scene: 'alpine-day' },
  { startMinutes: 12 * 60, scene: 'coastal-breeze' },
  { startMinutes: 17 * 60, scene: 'ocean-sunset' },
  { startMinutes: 20 * 60, scene: 'night-mountains' },
];
