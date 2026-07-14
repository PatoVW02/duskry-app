export interface SelectNavigationOption {
  label: string;
  disabled?: boolean;
}

export function getNextEnabledIndex(
  options: SelectNavigationOption[],
  startIndex: number,
  direction: 1 | -1,
): number {
  if (options.length === 0 || options.every((option) => option.disabled)) return -1;

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (startIndex + direction * offset + options.length * 2) % options.length;
    if (!options[index]?.disabled) return index;
  }

  return -1;
}

export function findTypeaheadMatch(
  options: SelectNavigationOption[],
  query: string,
  startIndex: number,
): number {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return -1;

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (startIndex + offset + options.length) % options.length;
    const option = options[index];
    if (!option?.disabled && option.label.toLocaleLowerCase().startsWith(normalizedQuery)) return index;
  }

  return -1;
}
