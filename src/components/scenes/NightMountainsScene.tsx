export function NightMountainsScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="nm-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#03060f"/>
          <stop offset="60%" stopColor="#060e1e"/>
          <stop offset="100%" stopColor="#0a1a2e"/>
        </linearGradient>
        <linearGradient id="nm-lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1828"/>
          <stop offset="100%" stopColor="#050c14"/>
        </linearGradient>
        <radialGradient id="nm-moon" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e8f4f8" stopOpacity="0.95"/>
          <stop offset="100%" stopColor="#b0cce0" stopOpacity="0.5"/>
        </radialGradient>
      </defs>
      {/* Sky */}
      <rect width="1200" height="780" fill="url(#nm-sky)"/>
      {/* Stars */}
      {[
        [80,40],[160,90],[240,30],[340,70],[450,20],[560,55],[670,35],[780,80],[880,25],[980,60],[1080,40],[1140,85],
        [120,160],[280,140],[420,170],[600,130],[750,155],[900,145],[1050,165],[200,200],[500,190],[800,210],[1100,195],
      ].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r={Math.random() > 0.5 ? 1.2 : 0.7} fill="white" opacity={0.4 + Math.random() * 0.5}/>
      ))}
      {/* Moon */}
      <circle cx="900" cy="110" r="38" fill="url(#nm-moon)" opacity="0.85"/>
      <circle cx="916" cy="102" r="32" fill="#03060f" opacity="0.20"/>
      {/* Far mountains */}
      <path d="M0 480 L120 310 L240 400 L380 260 L520 380 L640 240 L760 350 L880 280 L1000 360 L1120 300 L1200 360 L1200 540 L0 540Z"
        fill="#081422" opacity="0.9"/>
      {/* Mid mountains */}
      <path d="M0 530 L150 370 L300 460 L460 320 L600 430 L720 340 L860 410 L1000 360 L1120 420 L1200 380 L1200 580 L0 580Z"
        fill="#0b1e30" opacity="0.95"/>
      {/* Near mountains */}
      <path d="M0 580 L200 440 L350 520 L500 420 L650 500 L780 450 L950 510 L1100 460 L1200 500 L1200 640 L0 640Z"
        fill="#0f2235"/>
      {/* Lake */}
      <rect x="0" y="640" width="1200" height="140" fill="url(#nm-lake)"/>
      {/* Lake reflection */}
      <path d="M0 640 Q600 620 1200 640" stroke="rgba(14,180,160,0.15)" strokeWidth="1" fill="none"/>
      <line x1="0" y1="660" x2="1200" y2="660" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"/>
      <line x1="0" y1="695" x2="1200" y2="695" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5"/>
      {/* Mist */}
      <rect x="0" y="615" width="1200" height="40" fill="rgba(14,60,80,0.15)" style={{ filter: 'blur(8px)' }}/>
    </svg>
  );
}
