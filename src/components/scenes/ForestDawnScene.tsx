export function ForestDawnScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="fd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1a0a05"/>
          <stop offset="40%" stopColor="#5c2a10"/>
          <stop offset="70%" stopColor="#c85a1a"/>
          <stop offset="100%" stopColor="#e8883a"/>
        </linearGradient>
        <radialGradient id="fd-sun" cx="50%" cy="100%" r="60%">
          <stop offset="0%" stopColor="#ffd580" stopOpacity="0.8"/>
          <stop offset="60%" stopColor="#f97316" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#f97316" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#fd-sky)"/>
      <ellipse cx="600" cy="780" rx="500" ry="300" fill="url(#fd-sun)"/>
      {/* Horizon glow */}
      <rect x="0" y="480" width="1200" height="60" fill="rgba(250,160,50,0.15)" style={{ filter: 'blur(20px)' }}/>
      {/* Far tree line */}
      {Array.from({ length: 30 }, (_, i) => {
        const x = i * 42 - 10;
        const h = 120 + Math.sin(i * 1.3) * 30;
        return <path key={i} d={`M${x} 540 L${x + 20} ${540 - h} L${x + 40} 540Z`} fill="#1c3020" opacity="0.7"/>;
      })}
      {/* Mid trees */}
      {Array.from({ length: 20 }, (_, i) => {
        const x = i * 64 - 20;
        const h = 180 + Math.sin(i * 2) * 40;
        return (
          <g key={i}>
            <path d={`M${x} 620 L${x + 28} ${620 - h} L${x + 56} 620Z`} fill="#152518"/>
            <path d={`M${x + 14} 620 L${x + 28} ${620 - h * 0.6} L${x + 42} 620Z`} fill="#1f3828"/>
          </g>
        );
      })}
      {/* Ground */}
      <rect x="0" y="650" width="1200" height="130" fill="#0d1a0f"/>
      {/* Foreground fog */}
      <rect x="0" y="590" width="1200" height="80" fill="rgba(200,120,40,0.08)" style={{ filter: 'blur(12px)' }}/>
    </svg>
  );
}
