import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type AriaAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { findTypeaheadMatch, getNextEnabledIndex } from './selectNavigation';
import './ui.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  name?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  'aria-label'?: AriaAttributes['aria-label'];
  'aria-labelledby'?: AriaAttributes['aria-labelledby'];
  'aria-describedby'?: AriaAttributes['aria-describedby'];
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  onOpenChange?: (open: boolean) => void;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const TYPEAHEAD_RESET_MS = 650;
const MENU_GAP = 6;
const VIEWPORT_MARGIN = 10;

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  id,
  name,
  className,
  style,
  disabled = false,
  required = false,
  invalid = false,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  onOpenChange,
}: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? `duskry-select-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dropPos, setDropPos] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 280,
  });

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const notifyOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  const updateDropPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
    const roomAbove = rect.top - VIEWPORT_MARGIN;
    const preferredHeight = Math.min(280, Math.max(44, options.length * 40 + 8));
    const openAbove = roomBelow < Math.min(preferredHeight, 160) && roomAbove > roomBelow;
    const maxHeight = Math.max(80, Math.min(preferredHeight, openAbove ? roomAbove - MENU_GAP : roomBelow - MENU_GAP));
    const top = openAbove
      ? Math.max(VIEWPORT_MARGIN, rect.top - maxHeight - MENU_GAP)
      : rect.bottom + MENU_GAP;

    setDropPos({
      top,
      left: Math.min(rect.left, Math.max(VIEWPORT_MARGIN, window.innerWidth - Math.max(rect.width, 150) - VIEWPORT_MARGIN)),
      width: rect.width,
      maxHeight,
    });
  }, [options.length]);

  const openDropdown = useCallback((preferredIndex?: number) => {
    if (disabled) return;
    updateDropPosition();
    const initialIndex = preferredIndex ?? (
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : getNextEnabledIndex(options, -1, 1)
    );
    setActiveIndex(initialIndex);
    notifyOpenChange(true);
  }, [disabled, notifyOpenChange, options, selectedIndex, updateDropPosition]);

  const closeDropdown = useCallback((restoreFocus = false) => {
    notifyOpenChange(false);
    setActiveIndex(-1);
    typeaheadRef.current = '';
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, [notifyOpenChange]);

  const selectIndex = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    closeDropdown(true);
  }, [closeDropdown, onChange, options, value]);

  const handleTypeahead = useCallback((key: string) => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    typeaheadRef.current += key.toLocaleLowerCase();
    const match = findTypeaheadMatch(options, typeaheadRef.current, activeIndex >= 0 ? activeIndex : selectedIndex);
    if (match >= 0) {
      if (!open) openDropdown(match);
      else setActiveIndex(match);
    }
    typeaheadTimerRef.current = setTimeout(() => {
      typeaheadRef.current = '';
      typeaheadTimerRef.current = null;
    }, TYPEAHEAD_RESET_MS);
  }, [activeIndex, open, openDropdown, options, selectedIndex]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey && !/\s/.test(event.key)) {
      event.preventDefault();
      handleTypeahead(event.key);
      return;
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = getNextEnabledIndex(options, open ? activeIndex : selectedIndex, 1);
        if (!open) openDropdown(next);
        else setActiveIndex(next);
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const next = getNextEnabledIndex(options, open ? activeIndex : selectedIndex, -1);
        if (!open) openDropdown(next);
        else setActiveIndex(next);
        break;
      }
      case 'Home':
        if (open) {
          event.preventDefault();
          setActiveIndex(getNextEnabledIndex(options, -1, 1));
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActiveIndex(getNextEnabledIndex(options, 0, -1));
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && activeIndex >= 0) selectIndex(activeIndex);
        else openDropdown();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          closeDropdown(true);
        }
        break;
      case 'Tab':
        if (open) closeDropdown(false);
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return;
      closeDropdown(false);
    };
    const handleViewportChange = () => updateDropPosition();

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeDropdown, open, updateDropPosition]);

  useEffect(() => () => {
    if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
  }, []);

  useEffect(() => {
    if (disabled && open) closeDropdown(false);
  }, [closeDropdown, disabled, open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${listboxId}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listboxId, open]);

  const activeOptionId = open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-required={required || undefined}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        disabled={disabled}
        className={`duskry-ui-select-trigger${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => (open ? closeDropdown(false) : openDropdown())}
        onKeyDown={handleKeyDown}
        style={style}
      >
        <span className={`duskry-ui-select-value${selected ? '' : ' is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="duskry-ui-select-chevron" size={14} aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={ariaLabel ? undefined : (ariaLabelledBy ?? triggerId)}
          aria-label={ariaLabel}
          className="duskry-ui-select-listbox"
          style={{
            top: dropPos.top,
            left: dropPos.left,
            width: Math.max(dropPos.width, 150),
            maxHeight: dropPos.maxHeight,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.length === 0 && (
            <div className="duskry-ui-select-empty">No options</div>
          )}
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value}
                id={`${listboxId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                className={`duskry-ui-select-option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}${option.disabled ? ' is-disabled' : ''}`}
                onMouseMove={() => {
                  if (!option.disabled && activeIndex !== index) setActiveIndex(index);
                }}
                onClick={() => selectIndex(index)}
              >
                <span>{option.label}</span>
                {isSelected && <Check size={14} aria-hidden="true" />}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
