interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function Stepper({ value, onChange, min = 0, max = 99 }: StepperProps) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const atMin = value <= min;
  const atMax = value >= max;

  const btnBase: React.CSSProperties = {
    width: 28,
    height: 32,
    background: 'rgba(255, 255, 255, 0.06)',
    border: '0.5px solid rgba(255, 255, 255, 0.14)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    lineHeight: 1,
    flexShrink: 0,
    outline: 'none',
    cursor: 'pointer',
    transition: 'color 0.12s',
    fontFamily: 'Inter, sans-serif',
    padding: 0,
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'stretch' }}>
      <button
        type="button"
        onClick={() => onChange(clamp(value - 1))}
        disabled={atMin}
        style={{
          ...btnBase,
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          color: atMin ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.60)',
          cursor: atMin ? 'default' : 'pointer',
        }}
      >
        −
      </button>

      <input
        type="text"
        inputMode="numeric"
        value={String(value).padStart(2, '0')}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
          onChange(isNaN(n) ? min : clamp(n));
        }}
        onFocus={(e) => e.target.select()}
        style={{
          width: 40,
          height: 32,
          background: 'rgba(255, 255, 255, 0.07)',
          border: '0.5px solid rgba(255, 255, 255, 0.14)',
          borderLeft: 'none',
          borderRight: 'none',
          color: 'rgba(255, 255, 255, 0.90)',
          fontSize: 13,
          fontFamily: 'Inter, sans-serif',
          textAlign: 'center',
          outline: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      />

      <button
        type="button"
        onClick={() => onChange(clamp(value + 1))}
        disabled={atMax}
        style={{
          ...btnBase,
          borderLeft: 'none',
          borderRadius: '0 8px 8px 0',
          color: atMax ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.60)',
          cursor: atMax ? 'default' : 'pointer',
        }}
      >
        +
      </button>
    </div>
  );
}
