import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import type { StatusTone } from './Status';
import './ui.css';

export interface ToastProps {
  title: ReactNode;
  message?: ReactNode;
  tone?: StatusTone;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function Toast({
  title,
  message,
  tone = 'neutral',
  action,
  onDismiss,
  className,
}: ToastProps) {
  const isAssertive = tone === 'danger';

  return (
    <div
      className={`duskry-ui-toast duskry-ui-toast--${tone}${className ? ` ${className}` : ''}`}
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="duskry-ui-toast-indicator" aria-hidden="true" />
      <span className="duskry-ui-toast-copy">
        <span className="duskry-ui-toast-title">{title}</span>
        {message && <span className="duskry-ui-toast-message">{message}</span>}
      </span>
      {action && <span className="duskry-ui-toast-action">{action}</span>}
      {onDismiss && (
        <IconButton label="Dismiss notification" size="small" onClick={onDismiss}>
          <X size={15} aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
}
