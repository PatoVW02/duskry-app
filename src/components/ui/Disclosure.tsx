import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './ui.css';

export interface DisclosureProps {
  title: ReactNode;
  children: ReactNode;
  summary?: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Disclosure({
  title,
  children,
  summary,
  icon,
  open,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
}: DisclosureProps) {
  const generatedId = useId();
  const panelId = `duskry-disclosure-${generatedId}`;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;

  const toggle = () => {
    const nextOpen = !isOpen;
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <section className={`duskry-ui-disclosure${isOpen ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="duskry-ui-disclosure-trigger"
        aria-expanded={isOpen}
        aria-controls={panelId}
        disabled={disabled}
        onClick={toggle}
      >
        {icon && <span className="duskry-ui-disclosure-icon" aria-hidden="true">{icon}</span>}
        <span className="duskry-ui-disclosure-copy">
          <span className="duskry-ui-disclosure-title">{title}</span>
          {summary && <span className="duskry-ui-disclosure-summary">{summary}</span>}
        </span>
        <ChevronDown className="duskry-ui-disclosure-chevron" size={16} aria-hidden="true" />
      </button>
      <div id={panelId} className="duskry-ui-disclosure-panel" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}
