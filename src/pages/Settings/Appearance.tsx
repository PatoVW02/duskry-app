import { useSettingsStore } from '../../stores/useSettingsStore';
import { SceneThumbnail } from '../../components/layout/SceneBackground';
import { Select } from '../../components/ui/Select';
import { SCENE_IDS, SCENE_LABELS, type SceneId } from '../../lib/sceneConfig';
import { formatMinutesAsTime, parseTimeToMinutes } from '../../lib/utils';

export function Appearance() {
  const scene = useSettingsStore((s) => s.scene);
  const sceneAuto = useSettingsStore((s) => s.sceneAuto);
  const autoSceneSchedule = useSettingsStore((s) => s.autoSceneSchedule);
  const setScene = useSettingsStore((s) => s.setScene);
  const setSceneAuto = useSettingsStore((s) => s.setSceneAuto);
  const setAutoSceneSchedule = useSettingsStore((s) => s.setAutoSceneSchedule);
  const openScenePreview = useSettingsStore((s) => s.openScenePreview);

  const sceneOptions = SCENE_IDS.map((id) => ({
    value: id,
    label: SCENE_LABELS[id],
  }));

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

        <div
          className="glass-stat"
          style={{
            padding: 14,
            marginBottom: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.82)' }}>
            Auto schedule
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)' }}>
            Each background stays active from its start time until the next one begins.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {autoSceneSchedule.map((slot, index) => (
              <div
                key={`${slot.startMinutes}-${slot.scene}-${index}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px minmax(0, 1fr)',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <input
                  type="time"
                  value={formatMinutesAsTime(slot.startMinutes)}
                  onChange={(e) => {
                    const next = [...autoSceneSchedule];
                    next[index] = {
                      ...slot,
                      startMinutes: parseTimeToMinutes(e.target.value),
                    };
                    void setAutoSceneSchedule(next);
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '0.5px solid rgba(255,255,255,0.15)',
                    borderRadius: 8,
                    padding: '7px 10px',
                    color: 'rgba(255,255,255,0.88)',
                    fontSize: 12,
                    fontFamily: 'Inter, sans-serif',
                    outline: 'none',
                  }}
                />
                <Select
                  value={slot.scene}
                  onChange={(value) => {
                    const next = [...autoSceneSchedule];
                    next[index] = { ...slot, scene: value as SceneId };
                    void setAutoSceneSchedule(next);
                  }}
                  options={sceneOptions}
                  style={{ minWidth: 0 }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="scene-grid">
          {SCENE_IDS.map((id) => (
            <button
              key={id}
              className={`scene-thumb ${scene === id && !sceneAuto ? 'active' : ''}`}
              type="button"
            >
              <SceneThumbnail id={id} />
              <div className="scene-thumb-actions">
                <button
                  type="button"
                  className="scene-thumb-action scene-thumb-action--primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    void setScene(id).then(() => setSceneAuto(false));
                  }}
                >
                  Set
                </button>
                <button
                  type="button"
                  className="scene-thumb-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    openScenePreview(id);
                  }}
                >
                  View
                </button>
              </div>
              <span>{SCENE_LABELS[id]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
