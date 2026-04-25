function flagEnabled(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === '') return defaultValue;
  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

export const billingPlansEnabled = flagEnabled(
  import.meta.env.VITE_BILLING_PLANS_ENABLED,
  true
);
