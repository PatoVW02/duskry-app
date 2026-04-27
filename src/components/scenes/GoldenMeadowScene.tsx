export function GoldenMeadowScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="gm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8ad8ff"/>
          <stop offset="50%" stopColor="#74c5ff"/>
          <stop offset="100%" stopColor="#f0d58e"/>
        </linearGradient>
        <radialGradient id="gm-sun" cx="20%" cy="18%" r="28%">
          <stop offset="0%" stopColor="#fff2c3" stopOpacity="0.95"/>
          <stop offset="40%" stopColor="#ffe08a" stopOpacity="0.55"/>
          <stop offset="100%" stopColor="#ffe08a" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="gm-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7db55c"/>
          <stop offset="100%" stopColor="#345b2d"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#gm-sky)"/>
      <rect width="1200" height="780" fill="url(#gm-sun)"/>
      <circle cx="210" cy="135" r="46" fill="#fff3ca" opacity="0.95"/>
      <ellipse cx="300" cy="170" rx="180" ry="34" fill="rgba(255,255,255,0.20)"/>
      <ellipse cx="430" cy="148" rx="130" ry="26" fill="rgba(255,255,255,0.24)"/>
      <ellipse cx="840" cy="210" rx="190" ry="34" fill="rgba(255,255,255,0.14)"/>
      <path d="M0 470 L170 350 L320 410 L500 320 L660 390 L820 300 L980 370 L1120 330 L1200 360 L1200 520 L0 520Z" fill="#7a8d82" opacity="0.5"/>
      <path d="M0 560 L150 450 L290 520 L420 455 L560 520 L700 470 L850 545 L1000 500 L1130 548 L1200 520 L1200 610 L0 610Z" fill="#4b6f49" opacity="0.75"/>
      <rect x="0" y="580" width="1200" height="200" fill="url(#gm-grass)"/>
      <path d="M0 590 Q180 565 360 590 Q540 615 720 590 Q900 565 1080 590 Q1140 598 1200 592" fill="rgba(196,176,94,0.35)"/>
      <path d="M0 640 Q150 620 300 640 Q450 660 600 640 Q750 620 900 640 Q1050 660 1200 640" fill="rgba(255,210,120,0.14)"/>
      {Array.from({ length: 18 }, (_, i) => {
        const x = i * 72 - 20;
        const h = 36 + (i % 4) * 10;
        return <path key={i} d={`M${x} 580 Q${x + 12} ${580 - h} ${x + 24} 580`} stroke="rgba(255,230,160,0.22)" strokeWidth="2" fill="none"/>;
      })}
    </svg>
  );
}
