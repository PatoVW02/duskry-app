interface RuleFieldOption {
  value: string;
}

export function detectMacOS(platform: string, userAgent: string): boolean {
  return /mac/i.test(`${platform} ${userAgent}`);
}

export function isRuleFieldSupported(field: string, runningOnMacOS: boolean): boolean {
  return field !== 'url' || runningOnMacOS;
}

export function supportedRuleFieldOptions<T extends RuleFieldOption>(
  options: readonly T[],
  runningOnMacOS: boolean,
): T[] {
  return options.filter((option) => isRuleFieldSupported(option.value, runningOnMacOS));
}
