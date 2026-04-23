import { useSettingsStore } from '../../stores/useSettingsStore';
import { SCENE_LABELS, SceneThumbnail, type SceneId } from '../../components/layout/SceneBackground';

const SCENE_IDS: SceneId[] = [
  'night-mountains',
  'forest-dawn',
  'alpine-day',
  'ocean-sunset',
  'desert-canyon',
  'arctic-night',
];

export function Appearance() {
  const scene = useSettingsStore((s) => s.scene);
  const sceneAuto = useSettingsStore((s) => s.sceneAuto);
  const setScene = useSettingsStore((s) => s.setScene);
  const setSceneAuto = useSettingsStore((s) => s.setSceneAuto);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="glass-card" style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Background scene</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', marginBottom: 16 }}>
          Choose the scenic background displayed behind the app.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div
            style={{
              width: 34,
              height: 20,
              borderRadius: 10,
              background: sceneAuto ? 'rgba(45,212,191,0.8)' : 'rgba(255,255,255,0.15)',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
              flexShrink: 0,
            }}
            onClick={() => setSceneAuto(!sceneAuto)}
          >
            <div style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'white',
              position: 'absolute',
              top: 2,
              left: sceneAuto ? 16 : 2,
              transition: 'left 0.2s',
            }}/>
          </div>
          <span style={{ fontSize: 13 }}>Auto-select by time of day</span>
        </div>

        <div className="scene-grid">
          {SCENE_IDS.map((id) => (
            <button
              key={id}
              className={`scene-thumb ${scene === id && !sceneAuto ? 'active' : ''}`}
              onClick={() => { setScene(id); setSceneAuto(false); }}
            >
              <SceneThumbnail id={id} />
              <span>{SCENE_LABELS[id]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
