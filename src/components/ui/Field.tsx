import { useId, type ReactNode } from 'react';
import './ui.css';

export interface FieldControlProps {
  id: string;
  required?: boolean;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

export interface FieldProps {
  label: ReactNode;
  children: (controlProps: FieldControlProps) => ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optionalLabel?: string;
  controlId?: string;
  className?: string;
}

export function Field({
  label,
  children,
  description,
  error,
  required = false,
  optionalLabel = 'Optional',
  controlId,
  className,
}: FieldProps) {
  const generatedId = useId();
  const id = controlId ?? `duskry-field-${generatedId}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`duskry-ui-field${className ? ` ${className}` : ''}`}>
      <label className="duskry-ui-field-label" htmlFor={id}>
        <span>{label}</span>
        {!required && optionalLabel && <span className="duskry-ui-field-optional">{optionalLabel}</span>}
      </label>
      {children({
        id,
        required: required || undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {description && <div id={descriptionId} className="duskry-ui-field-description">{description}</div>}
      {error && <div id={errorId} className="duskry-ui-field-error" role="alert">{error}</div>}
    </div>
  );
}
