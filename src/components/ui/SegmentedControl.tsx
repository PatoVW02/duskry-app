import { RadioGroup, type RadioGroupOption } from './RadioGroup';

export interface SegmentedControlProps {
  value: string;
  onChange: (value: string) => void;
  options: RadioGroupOption[];
  label: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl({
  value,
  onChange,
  options,
  label,
  name,
  disabled,
  className,
}: SegmentedControlProps) {
  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      options={options}
      label={label}
      name={name}
      disabled={disabled}
      hideLabel
      orientation="horizontal"
      variant="segmented"
      className={className}
    />
  );
}
