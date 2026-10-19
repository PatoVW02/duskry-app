export const PROJECT_COLOR_PRESETS = [
  { color: '#86EFAC', name: 'Green' },
  { color: '#38BDF8', name: 'Sky' },
  { color: '#2DD4BF', name: 'Teal' },
  { color: '#A78BFA', name: 'Purple' },
  { color: '#FB923C', name: 'Orange' },
  { color: '#F472B6', name: 'Pink' },
  { color: '#FBBF24', name: 'Amber' },
  { color: '#60A5FA', name: 'Blue' },
  { color: '#F87171', name: 'Red' },
  { color: '#FDA4AF', name: 'Rose' },
  { color: '#FB7185', name: 'Coral' },
  { color: '#FDBA74', name: 'Peach' },
  { color: '#FDE047', name: 'Yellow' },
  { color: '#FEF08A', name: 'Lemon' },
  { color: '#BEF264', name: 'Lime' },
  { color: '#34D399', name: 'Emerald' },
  { color: '#6EE7B7', name: 'Mint' },
  { color: '#22D3EE', name: 'Cyan' },
  { color: '#7DD3FC', name: 'Light blue' },
  { color: '#818CF8', name: 'Indigo' },
  { color: '#C084FC', name: 'Violet' },
  { color: '#E879F9', name: 'Fuchsia' },
  { color: '#CBD5E1', name: 'Silver' },
  { color: '#94A3B8', name: 'Slate' },
];

export const PROJECT_COLORS = PROJECT_COLOR_PRESETS.map(({ color }) => color);

export const colors = {
  projects: PROJECT_COLORS,
  text: {
    primary:   'rgba(255, 255, 255, 0.90)',
    secondary: 'rgba(255, 255, 255, 0.50)',
    muted:     'rgba(255, 255, 255, 0.28)',
  },
  surface: {
    card:    'rgba(10, 22, 18, 0.35)',
    sidebar: 'rgba(15, 25, 35, 0.45)',
    stat:    'rgba(10, 22, 18, 0.48)',
  },
  border: {
    default: 'rgba(255, 255, 255, 0.12)',
    subtle:  'rgba(255, 255, 255, 0.06)',
    strong:  'rgba(255, 255, 255, 0.20)',
  },
};
