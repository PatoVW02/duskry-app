export function OceanSunsetScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="os-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a0530"/>
          <stop offset="40%" stopColor="#6a1540"/>
          <stop offset="70%" stopColor="#c44020"/>
          <stop offset="100%" stopColor="#e8841a"/>
        </linearGradient>
        <linearGradient id="os-ocean" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b3a00" stopOpacity="0.8"/>
          <stop offset="100%" stopColor="#1a0a20"/>
        </linearGradient>
        <radialGradient id="os-sunball" cx="50%" cy="100%" r="50%">
          <stop offset="0%" stopColor="#ffd040" stopOpacity="1"/>
          <stop offset="40%" stopColor="#ff8020" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#ff4040" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#os-sky)"/>
      <ellipse cx="600" cy="420" rx="600" ry="280" fill="url(#os-sunball)"/>
      {/* Sun */}
      <circle cx="600" cy="420" r="52" fill="#ffd040" opacity="0.9"/>
      <circle cx="600" cy="420" r="38" fill="#ffe880" opacity="0.95"/>
      {/* Horizon */}
      <rect x="0" y="420" width="1200" height="10" fill="rgba(255,180,50,0.3)" style={{ filter: 'blur(4px)' }}/>
      {/* Ocean */}
      <rect x="0" y="425" width="1200" height="355" fill="url(#os-ocean)"/>
      {/* Sun reflection */}
      <ellipse cx="600" cy="500" rx="80" ry="300" fill="rgba(255,160,30,0.20)"/>
      {/* Waves */}
      {[450,490,530,570,610,660,720].map((y, i) => (
        <path key={i} d={`M0 ${y} Q300 ${y - 8} 600 ${y} Q900 ${y + 8} 1200 ${y}`}
          stroke="rgba(255,160,40,0.10)" strokeWidth="1" fill="none"/>
      ))}
      {/* Clouds */}
      <ellipse cx="150" cy="220" rx="130" ry="40" fill="rgba(180,60,30,0.35)"/>
      <ellipse cx="230" cy="200" rx="90" ry="30" fill="rgba(200,70,30,0.3)"/>
      <ellipse cx="1000" cy="260" rx="110" ry="35" fill="rgba(160,50,60,0.30)"/>
    </svg>
  );
}
