import type { ReactNode } from 'react';
import './ui.css';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusProps {
  label: ReactNode;
  detail?: ReactNode;
  tone?: StatusTone;
  live?: 'off' | 'polite' | 'assertive';
  className?: string;
}

export function Status({
  label,
  detail,
  tone = 'neutral',
  live = 'off',
  className,
}: StatusProps) {
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;

  return (
    <div
      className={`duskry-ui-status duskry-ui-status--${tone}${className ? ` ${className}` : ''}`}
      role={role}
      aria-live={live === 'off' ? undefined : live}
      aria-atomic={live === 'off' ? undefined : true}
    >
      <span className="duskry-ui-status-dot" aria-hidden="true" />
      <span className="duskry-ui-status-content">
        <span className="duskry-ui-status-label">{label}</span>
        {detail && <span className="duskry-ui-status-detail">{detail}</span>}
      </span>
    </div>
  );
}
