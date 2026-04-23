export function AlpineDayScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="ad-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a2040"/>
          <stop offset="50%" stopColor="#1a4a80"/>
          <stop offset="100%" stopColor="#3a7cc0"/>
        </linearGradient>
        <linearGradient id="ad-meadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a5530"/>
          <stop offset="100%" stopColor="#1a3520"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#ad-sky)"/>
      {/* Clouds */}
      <ellipse cx="250" cy="120" rx="120" ry="35" fill="rgba(255,255,255,0.18)"/>
      <ellipse cx="320" cy="105" rx="80" ry="28" fill="rgba(255,255,255,0.22)"/>
      <ellipse cx="800" cy="160" rx="100" ry="30" fill="rgba(255,255,255,0.15)"/>
      <ellipse cx="860" cy="148" rx="70" ry="24" fill="rgba(255,255,255,0.18)"/>
      {/* Far peaks with snow */}
      <path d="M0 420 L180 200 L280 320 L420 160 L560 300 L680 180 L800 280 L920 200 L1040 300 L1200 240 L1200 480 L0 480Z"
        fill="#4a6a8a"/>
      {/* Snow caps */}
      <path d="M180 200 L220 250 L260 230 L280 320 L320 280 L340 260 L420 160 L460 220 L500 240 L560 300 L600 260 L640 240 L680 180 L720 240 L760 260Z"
        fill="rgba(220,235,250,0.90)"/>
      {/* Mid mountains */}
      <path d="M0 520 L200 360 L360 460 L520 360 L680 460 L820 380 L1000 460 L1120 400 L1200 440 L1200 560 L0 560Z"
        fill="#2a4a5a"/>
      {/* Meadow */}
      <rect x="0" y="560" width="1200" height="220" fill="url(#ad-meadow)"/>
      <path d="M0 560 Q200 540 400 560 Q600 580 800 560 Q1000 540 1200 560" fill="rgba(50,100,55,0.6)"/>
    </svg>
  );
}
