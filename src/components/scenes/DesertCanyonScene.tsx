export function DesertCanyonScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="dc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a0805"/>
          <stop offset="50%" stopColor="#3a1808"/>
          <stop offset="100%" stopColor="#7a3010"/>
        </linearGradient>
        <linearGradient id="dc-rock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c04820"/>
          <stop offset="100%" stopColor="#6a2010"/>
        </linearGradient>
        <linearGradient id="dc-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4804a"/>
          <stop offset="100%" stopColor="#8a4020"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#dc-sky)"/>
      {/* Stars */}
      {[[100,50],[300,80],[500,40],[700,70],[900,30],[1100,60]].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r="0.8" fill="white" opacity="0.6"/>
      ))}
      {/* Left mesa */}
      <path d="M0 200 L0 700 L350 700 L350 350 L300 280 L250 300 L200 240 L150 260 L80 200Z" fill="url(#dc-rock)"/>
      <path d="M0 200 L80 200 L150 260 L200 240 L250 300 L300 280 L350 350 L350 380 L0 380Z" fill="rgba(200,100,50,0.4)"/>
      {/* Right mesa */}
      <path d="M1200 180 L1200 700 L820 700 L820 320 L870 260 L920 300 L970 220 L1020 250 L1060 210 L1100 230 L1150 180Z" fill="url(#dc-rock)"/>
      <path d="M1200 180 L1150 180 L1100 230 L1060 210 L1020 250 L970 220 L920 300 L870 260 L820 320 L820 360 L1200 360Z" fill="rgba(200,100,50,0.35)"/>
      {/* Canyon floor */}
      <path d="M300 700 L350 420 L450 460 L550 400 L650 420 L750 390 L850 430 L900 700Z" fill="url(#dc-floor)"/>
      {/* Sand */}
      <rect x="0" y="680" width="1200" height="100" fill="#c07840"/>
      {/* Rock shadows */}
      <path d="M350 700 L350 500 L420 600 L500 550 L550 620 L600 580 L650 640 L700 590 L750 640 L820 500 L820 700Z"
        fill="rgba(30,10,5,0.5)"/>
    </svg>
  );
}
