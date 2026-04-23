import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  style?: React.CSSProperties;
}

export function Select({ value, onChange, options, placeholder = 'Select…', style }: SelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number }>({
    top: 0, left: 0, width: 0,
  });

  const selected = options.find((o) => o.value === value);

  const openDropdown = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 5,
          background: 'rgba(255, 255, 255, 0.07)',
          border: `0.5px solid ${open ? 'rgba(45, 212, 191, 0.50)' : 'rgba(255, 255, 255, 0.15)'}`,
          borderRadius: 8,
          padding: '7px 10px',
          color: selected ? 'rgba(255, 255, 255, 0.88)' : 'rgba(255, 255, 255, 0.38)',
          fontSize: 12,
          fontFamily: 'Inter, sans-serif',
          cursor: 'pointer',
          flex: '1 1 auto',
          minWidth: 90,
          outline: 'none',
          transition: 'border-color 0.15s',
          ...style,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={11}
          style={{
            flexShrink: 0,
            opacity: 0.45,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        />
      </button>

      {open && createPortal(
        <div
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: Math.max(dropPos.width, 130),
            zIndex: 9999,
            background: 'rgba(10, 20, 16, 0.96)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '0.5px solid rgba(255, 255, 255, 0.13)',
            borderRadius: 10,
            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
            padding: '4px 0',
            overflow: 'hidden',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((opt) => {
            const isActive = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: isActive ? 'rgba(45, 212, 191, 0.12)' : 'transparent',
                  border: 'none',
                  padding: '7px 12px',
                  fontSize: 12,
                  fontFamily: 'Inter, sans-serif',
                  color: isActive ? 'rgba(45, 212, 191, 0.90)' : 'rgba(255, 255, 255, 0.80)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isActive
                    ? 'rgba(45, 212, 191, 0.18)'
                    : 'rgba(255, 255, 255, 0.07)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive
                    ? 'rgba(45, 212, 191, 0.12)'
                    : 'transparent';
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
