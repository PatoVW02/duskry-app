export function HarborMistScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="hm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#081321"/>
          <stop offset="50%" stopColor="#13304e"/>
          <stop offset="100%" stopColor="#21547e"/>
        </linearGradient>
        <radialGradient id="hm-haze" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#d7efff" stopOpacity="0.18"/>
          <stop offset="65%" stopColor="#7dd3fc" stopOpacity="0.08"/>
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="hm-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#245b78" stopOpacity="0.58"/>
          <stop offset="100%" stopColor="#08111a" stopOpacity="0.95"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#hm-sky)"/>
      <rect width="1200" height="780" fill="url(#hm-haze)"/>
      <ellipse cx="220" cy="170" rx="180" ry="42" fill="rgba(255,255,255,0.16)"/>
      <ellipse cx="320" cy="152" rx="118" ry="34" fill="rgba(255,255,255,0.18)"/>
      <ellipse cx="860" cy="210" rx="220" ry="50" fill="rgba(255,255,255,0.12)"/>
      <ellipse cx="970" cy="192" rx="130" ry="30" fill="rgba(255,255,255,0.16)"/>
      <path d="M0 470 L130 380 L250 430 L420 330 L560 390 L720 300 L860 370 L1010 320 L1140 390 L1200 360 L1200 520 L0 520Z" fill="rgba(16,36,52,0.9)"/>
      <path d="M0 560 L150 470 L290 530 L450 430 L620 520 L780 420 L940 500 L1080 450 L1200 510 L1200 610 L0 610Z" fill="rgba(12,26,40,0.95)"/>
      <rect x="0" y="570" width="1200" height="210" fill="url(#hm-water)"/>
      <ellipse cx="580" cy="585" rx="440" ry="36" fill="rgba(255,255,255,0.08)" style={{ filter: 'blur(12px)' }}/>
      <ellipse cx="780" cy="625" rx="300" ry="30" fill="rgba(125,211,252,0.10)" style={{ filter: 'blur(12px)' }}/>
      {[612, 648, 688, 730].map((y) => (
        <path key={y} d={`M0 ${y} Q240 ${y - 8} 480 ${y} Q720 ${y + 8} 960 ${y} Q1080 ${y - 6} 1200 ${y}`}
          stroke="rgba(255,255,255,0.08)" strokeWidth="1" fill="none"/>
      ))}
      <rect x="0" y="540" width="1200" height="44" fill="rgba(215,239,255,0.07)" style={{ filter: 'blur(8px)' }}/>
    </svg>
  );
}
