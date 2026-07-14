import { useEffect, useState } from 'react';
import { NightMountainsScene } from '../scenes/NightMountainsScene';
import { ForestDawnScene } from '../scenes/ForestDawnScene';
import { AlpineDayScene } from '../scenes/AlpineDayScene';
import { OceanSunsetScene } from '../scenes/OceanSunsetScene';
import { DesertCanyonScene } from '../scenes/DesertCanyonScene';
import { ArcticNightScene } from '../scenes/ArcticNightScene';
import { EmeraldDuskScene } from '../scenes/EmeraldDuskScene';
import { HarborMistScene } from '../scenes/HarborMistScene';
import { AmberCityScene } from '../scenes/AmberCityScene';
import { CoastalBreezeScene } from '../scenes/CoastalBreezeScene';
import { GoldenMeadowScene } from '../scenes/GoldenMeadowScene';
import { SunlitCanyonScene } from '../scenes/SunlitCanyonScene';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { getAutoScene } from '../../lib/utils';
import { type SceneId } from '../../lib/sceneConfig';

const SCENES: Record<SceneId, React.ReactNode> = {
  'night-mountains': <NightMountainsScene />,
  'forest-dawn':     <ForestDawnScene />,
  'alpine-day':      <AlpineDayScene />,
  'ocean-sunset':    <OceanSunsetScene />,
  'desert-canyon':   <DesertCanyonScene />,
  'arctic-night':    <ArcticNightScene />,
  'emerald-dusk':    <EmeraldDuskScene />,
  'harbor-mist':     <HarborMistScene />,
  'amber-city':      <AmberCityScene />,
  'coastal-breeze':  <CoastalBreezeScene />,
  'golden-meadow':   <GoldenMeadowScene />,
  'sunlit-canyon':   <SunlitCanyonScene />,
};

export function SceneBackground() {
  const scene = useSettingsStore((s) => s.scene);
  const sceneAuto = useSettingsStore((s) => s.sceneAuto);
  const autoSceneSchedule = useSettingsStore((s) => s.autoSceneSchedule);
  const scenePreviewMode = useSettingsStore((s) => s.scenePreviewMode);
  const scenePreviewScene = useSettingsStore((s) => s.scenePreviewScene);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!sceneAuto) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleNextMinute = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 25;
      timer = setTimeout(() => {
        setNow(new Date());
        scheduleNextMinute();
      }, delay);
    };
    setNow(new Date());
    scheduleNextMinute();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [sceneAuto]);

  const activeScene: SceneId = sceneAuto
    ? getAutoScene(autoSceneSchedule, now)
    : scene;

  return (
    <div className="scene-layer" aria-hidden="true">
      {SCENES[(scenePreviewMode && scenePreviewScene) ? scenePreviewScene : activeScene] ?? SCENES['night-mountains']}
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
    'emerald-dusk':    <EmeraldDuskScene />,
    'harbor-mist':     <HarborMistScene />,
    'amber-city':      <AmberCityScene />,
    'coastal-breeze':  <CoastalBreezeScene />,
    'golden-meadow':   <GoldenMeadowScene />,
    'sunlit-canyon':   <SunlitCanyonScene />,
  };
  return <div className="scene-preview">{mini[id]}</div>;
}
