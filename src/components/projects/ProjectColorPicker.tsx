import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { normalizeProjectColor, projectColorForeground } from '../../lib/projectColor';
import { PROJECT_COLOR_PRESETS, PROJECT_COLORS } from '../../styles/tokens';
import './ProjectEditor.css';

interface Props {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export function ProjectColorPicker({ value, onChange, disabled = false }: Props) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const color = normalizeProjectColor(value);
  const invalid = touched && !color;
  return (
    <fieldset className="project-color-field" disabled={disabled}>
      <legend>Project color</legend>
      <div className="project-color-presets" role="group" aria-label="Preset project colors">
        {PROJECT_COLOR_PRESETS.map((preset) => (
          <button
            key={preset.color}
            type="button"
            className="project-color-swatch"
            style={{ backgroundColor: preset.color, color: projectColorForeground(preset.color) }}
            aria-label={`${preset.name} ${preset.color}`}
            aria-pressed={color === preset.color}
            title={`${preset.name} · ${preset.color}`}
            onClick={() => { onChange(preset.color); setTouched(false); }}
          >
            {color === preset.color && <Check size={15} strokeWidth={2.5} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="project-color-custom">
        <label className="project-color-native">
          <input
            type="color"
            aria-label="Choose a custom project color"
            value={color ?? PROJECT_COLORS[0]}
            onChange={(event) => { onChange(event.target.value.toUpperCase()); setTouched(false); }}
          />
          <span>Custom color</span>
        </label>
        <div className="project-color-hex">
          <label htmlFor={`${id}-hex`}>Hex color</label>
          <input
            id={`${id}-hex`}
            className="glass-input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={value}
            placeholder="#86EFAC"
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-help`}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setTouched(false)}
            onBlur={() => { setTouched(true); if (color) onChange(color); }}
          />
        </div>
      </div>
      <p id={`${id}-help`} className={`project-color-help${invalid ? ' is-error' : ''}`} role={invalid ? 'alert' : undefined}>
        {invalid ? 'Enter a hex color such as #A855F7 or #ABC.' : 'Choose a preset, pick any color, or enter a hex code.'}
      </p>
    </fieldset>
  );
}
