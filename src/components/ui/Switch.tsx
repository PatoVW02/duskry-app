import { useId, type ReactNode } from 'react';
import './ui.css';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  hideLabel?: boolean;
  name?: string;
  value?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  hideLabel = false,
  name,
  value = 'on',
  className,
}: SwitchProps) {
  const generatedId = useId();
  const labelId = `duskry-switch-${generatedId}-label`;
  const descriptionId = description ? `duskry-switch-${generatedId}-description` : undefined;

  return (
    <label className={`duskry-ui-switch-field${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <span className={hideLabel ? 'duskry-ui-visually-hidden' : 'duskry-ui-switch-copy'}>
        <span id={labelId} className="duskry-ui-switch-label">{label}</span>
        {description && <span id={descriptionId} className="duskry-ui-switch-description">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        name={name}
        value={value}
        checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        className="duskry-ui-switch-input"
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className="duskry-ui-switch-control" aria-hidden="true">
        <span className="duskry-ui-switch-thumb" aria-hidden="true" />
      </span>
    </label>
  );
}
