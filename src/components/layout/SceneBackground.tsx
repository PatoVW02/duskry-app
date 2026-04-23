import { NightMountainsScene } from '../scenes/NightMountainsScene';
import { ForestDawnScene } from '../scenes/ForestDawnScene';
import { AlpineDayScene } from '../scenes/AlpineDayScene';
import { OceanSunsetScene } from '../scenes/OceanSunsetScene';
import { DesertCanyonScene } from '../scenes/DesertCanyonScene';
import { ArcticNightScene } from '../scenes/ArcticNightScene';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { getAutoScene } from '../../lib/utils';

export type SceneId =
  | 'night-mountains'
  | 'forest-dawn'
  | 'alpine-day'
  | 'ocean-sunset'
  | 'desert-canyon'
  | 'arctic-night';

export const SCENE_LABELS: Record<SceneId, string> = {
  'night-mountains': 'Night Mountains',
  'forest-dawn':     'Forest Dawn',
  'alpine-day':      'Alpine Day',
  'ocean-sunset':    'Ocean Sunset',
  'desert-canyon':   'Desert Canyon',
  'arctic-night':    'Arctic Night',
};

const SCENES: Record<SceneId, React.ReactNode> = {
  'night-mountains': <NightMountainsScene />,
  'forest-dawn':     <ForestDawnScene />,
  'alpine-day':      <AlpineDayScene />,
  'ocean-sunset':    <OceanSunsetScene />,
  'desert-canyon':   <DesertCanyonScene />,
  'arctic-night':    <ArcticNightScene />,
};

export function SceneBackground() {
  const scene = useSettingsStore((s) => s.scene);
  const sceneAuto = useSettingsStore((s) => s.sceneAuto);

  const activeScene: SceneId = sceneAuto
    ? (getAutoScene(new Date().getHours()) as SceneId)
    : scene;

  return (
    <div className="scene-layer">
      {SCENES[activeScene] ?? SCENES['night-mountains']}
    </div>
  );
}

export function SceneThumbnail({ id }: { id: SceneId }) {
  const mini: Record<SceneId, React.ReactNode> = {
    'night-mountains': <NightMountainsScene />,
    'forest-dawn':     <ForestDawnScene />,
    'alpine-day':      <AlpineDayScene />,
    'ocean-sunset':    <OceanSunsetScene />,
    'desert-canyon':   <DesertCanyonScene />,
    'arctic-night':    <ArcticNightScene />,
  };
  return <div className="scene-preview">{mini[id]}</div>;
}
