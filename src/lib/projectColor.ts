/** Persist full RGB hex so every project surface can safely append alpha. */
export function normalizeProjectColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) {
    return `#${[...hex].map((digit) => digit + digit).join('').toUpperCase()}`;
  }
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

function luminance(value: string): number {
  const hex = normalizeProjectColor(value) ?? '#86EFAC';
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** Pick the higher contrast foreground for any custom solid background. */
export function projectColorForeground(value: string): '#FFFFFF' | '#000000' {
  const lightness = luminance(value);
  return (lightness + 0.05) / 0.05 >= 1.05 / (lightness + 0.05) ? '#000000' : '#FFFFFF';
}

/** Keep dark custom project colors from hiding text on Duskry's dark surfaces. */
export function projectColorText(value: string): string {
  const normalized = normalizeProjectColor(value);
  return normalized && luminance(normalized) >= 0.25 ? normalized : '#E2E8F0';
}
