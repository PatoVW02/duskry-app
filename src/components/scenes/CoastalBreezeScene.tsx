export function CoastalBreezeScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="cb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fe6ff"/>
          <stop offset="45%" stopColor="#59c8f5"/>
          <stop offset="100%" stopColor="#1f6ca8"/>
        </linearGradient>
        <linearGradient id="cb-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3eb7d9"/>
          <stop offset="100%" stopColor="#0d3c65"/>
        </linearGradient>
        <linearGradient id="cb-cliff" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2c6a57"/>
          <stop offset="100%" stopColor="#16362f"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#cb-sky)"/>
      <circle cx="920" cy="150" r="54" fill="rgba(255,248,220,0.92)"/>
      <circle cx="920" cy="150" r="88" fill="rgba(255,248,220,0.18)"/>
      <ellipse cx="210" cy="140" rx="150" ry="38" fill="rgba(255,255,255,0.22)"/>
      <ellipse cx="320" cy="122" rx="110" ry="28" fill="rgba(255,255,255,0.26)"/>
      <ellipse cx="730" cy="190" rx="180" ry="36" fill="rgba(255,255,255,0.16)"/>
      <path d="M0 450 L140 360 L290 420 L440 300 L610 380 L760 285 L920 350 L1070 300 L1200 340 L1200 520 L0 520Z" fill="#2d5e71" opacity="0.45"/>
      <path d="M0 560 L150 470 L280 520 L430 440 L570 510 L760 430 L930 500 L1080 450 L1200 500 L1200 620 L0 620Z" fill="url(#cb-cliff)"/>
      <rect x="0" y="560" width="1200" height="220" fill="url(#cb-water)"/>
      <path d="M0 590 Q150 575 300 590 Q450 605 600 590 Q750 575 900 590 Q1050 605 1200 590" stroke="rgba(255,255,255,0.18)" strokeWidth="2" fill="none"/>
      {[620, 658, 700, 742].map((y) => (
        <path key={y} d={`M0 ${y} Q150 ${y - 10} 300 ${y} Q450 ${y + 10} 600 ${y} Q750 ${y - 8} 900 ${y} Q1050 ${y + 8} 1200 ${y}`}
          stroke="rgba(255,255,255,0.10)" strokeWidth="1.2" fill="none"/>
      ))}
      <ellipse cx="380" cy="610" rx="170" ry="24" fill="rgba(130,250,255,0.18)" style={{ filter: 'blur(10px)' }}/>
    </svg>
  );
}
