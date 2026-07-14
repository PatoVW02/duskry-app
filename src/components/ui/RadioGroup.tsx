import { useId, type ReactNode } from 'react';
import './ui.css';

export interface RadioGroupOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  value: string;
  onChange: (value: string) => void;
  options: RadioGroupOption[];
  label: ReactNode;
  name?: string;
  description?: ReactNode;
  hideLabel?: boolean;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'cards' | 'segmented';
  className?: string;
}

export function RadioGroup({
  value,
  onChange,
  options,
  label,
  name,
  description,
  hideLabel = false,
  disabled = false,
  orientation = 'vertical',
  variant = 'cards',
  className,
}: RadioGroupProps) {
  const generatedId = useId();
  const groupName = name ?? `duskry-radio-${generatedId}`;
  const descriptionId = description ? `${groupName}-description` : undefined;

  return (
    <fieldset
      className={`duskry-ui-radio-group duskry-ui-radio-group--${variant} duskry-ui-radio-group--${orientation}${className ? ` ${className}` : ''}`}
      aria-describedby={descriptionId}
      disabled={disabled}
    >
      <legend className={hideLabel ? 'duskry-ui-visually-hidden' : 'duskry-ui-radio-legend'}>{label}</legend>
      {description && <p id={descriptionId} className="duskry-ui-radio-description">{description}</p>}
      <div className="duskry-ui-radio-options">
        {options.map((option, index) => {
          const optionDescriptionId = option.description ? `${groupName}-${index}-description` : undefined;
          return (
            <label key={option.value} className="duskry-ui-radio-option">
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                aria-describedby={optionDescriptionId}
                onChange={() => onChange(option.value)}
              />
              <span className="duskry-ui-radio-option-surface">
                <span className="duskry-ui-radio-option-label">{option.label}</span>
                {option.description && (
                  <span id={optionDescriptionId} className="duskry-ui-radio-option-description">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
