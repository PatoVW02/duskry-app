import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import './ui.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  children: ReactNode;
  size?: 'small' | 'medium' | 'large';
  variant?: 'ghost' | 'surface' | 'danger';
  selected?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label,
  children,
  size = 'medium',
  variant = 'ghost',
  selected,
  className,
  title,
  type = 'button',
  ...buttonProps
}, ref) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={selected}
      title={title ?? label}
      className={`duskry-ui-icon-button duskry-ui-icon-button--${size} duskry-ui-icon-button--${variant}${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  );
});
