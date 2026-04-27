export function AmberCityScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="ac-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#120912"/>
          <stop offset="42%" stopColor="#4a1730"/>
          <stop offset="72%" stopColor="#9c3f26"/>
          <stop offset="100%" stopColor="#f2a64a"/>
        </linearGradient>
        <radialGradient id="ac-glow" cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor="#ffd58a" stopOpacity="0.85"/>
          <stop offset="52%" stopColor="#fb923c" stopOpacity="0.28"/>
          <stop offset="100%" stopColor="#fb923c" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="ac-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#633424" stopOpacity="0.55"/>
          <stop offset="100%" stopColor="#120912" stopOpacity="0.96"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#ac-sky)"/>
      <ellipse cx="620" cy="440" rx="560" ry="260" fill="url(#ac-glow)"/>
      <circle cx="620" cy="360" r="56" fill="#ffd58a" opacity="0.9"/>
      <circle cx="620" cy="360" r="40" fill="#fff0c2" opacity="0.92"/>
      <path d="M0 520 L0 640 L120 640 L120 470 L170 470 L170 610 L235 610 L235 430 L300 430 L300 590 L370 590 L370 390 L450 390 L450 630 L520 630 L520 470 L590 470 L590 600 L670 600 L670 420 L760 420 L760 650 L850 650 L850 500 L940 500 L940 620 L1015 620 L1015 460 L1085 460 L1085 640 L1200 640 L1200 520Z" fill="rgba(23,11,20,0.88)"/>
      {[
        [56, 542, 14, 44], [84, 542, 14, 44], [251, 485, 16, 52], [279, 485, 16, 52],
        [394, 445, 18, 56], [426, 445, 18, 56], [545, 520, 14, 44], [700, 470, 18, 58],
        [732, 470, 18, 58], [883, 548, 16, 48], [911, 548, 16, 48], [1040, 510, 16, 52],
      ].map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="3" fill="rgba(255,214,138,0.38)"/>
      ))}
      <rect x="0" y="630" width="1200" height="150" fill="url(#ac-water)"/>
      <ellipse cx="620" cy="640" rx="110" ry="210" fill="rgba(255,180,90,0.16)"/>
      {[654, 690, 726].map((y) => (
        <path key={y} d={`M0 ${y} Q300 ${y - 10} 600 ${y} Q900 ${y + 10} 1200 ${y}`}
          stroke="rgba(255,214,138,0.10)" strokeWidth="1" fill="none"/>
      ))}
    </svg>
  );
}
