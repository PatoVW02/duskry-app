export function ArcticNightScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="an-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#020810"/>
          <stop offset="50%" stopColor="#050e1e"/>
          <stop offset="100%" stopColor="#081828"/>
        </linearGradient>
        <linearGradient id="an-ice" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a2030"/>
          <stop offset="100%" stopColor="#040c18"/>
        </linearGradient>
        {/* Aurora gradients */}
        <linearGradient id="au1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(0,200,180,0)"/>
          <stop offset="30%" stopColor="rgba(0,200,180,0.4)"/>
          <stop offset="60%" stopColor="rgba(80,50,200,0.35)"/>
          <stop offset="100%" stopColor="rgba(80,50,200,0)"/>
        </linearGradient>
        <linearGradient id="au2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(0,220,160,0)"/>
          <stop offset="40%" stopColor="rgba(0,220,160,0.3)"/>
          <stop offset="70%" stopColor="rgba(60,100,220,0.25)"/>
          <stop offset="100%" stopColor="rgba(60,100,220,0)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#an-sky)"/>
      {/* Stars */}
      {[
        [60,30],[150,60],[250,25],[380,50],[500,20],[620,45],[740,30],[860,55],[980,22],[1080,48],[1150,70],
        [100,110],[300,90],[500,120],[700,95],[900,115],[1100,100],
      ].map(([x,y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.5 : 0.8} fill="white" opacity={0.3 + (i % 4) * 0.15}/>
      ))}
      {/* Aurora borealis */}
      <path d="M-100 200 Q200 120 500 180 Q800 240 1300 160" stroke="url(#au1)" strokeWidth="60" fill="none" opacity="0.6" style={{ filter: 'blur(8px)' }}/>
      <path d="M-100 260 Q300 180 600 240 Q900 300 1300 220" stroke="url(#au2)" strokeWidth="45" fill="none" opacity="0.5" style={{ filter: 'blur(10px)' }}/>
      <path d="M0 180 Q250 140 550 200 Q850 250 1200 180" stroke="rgba(0,220,160,0.2)" strokeWidth="30" fill="none" style={{ filter: 'blur(15px)' }}/>
      {/* Frozen mountains */}
      <path d="M0 500 L180 320 L300 420 L450 280 L580 380 L720 300 L860 400 L980 330 L1100 410 L1200 360 L1200 560 L0 560Z"
        fill="#0a1828"/>
      {/* Snow highlights */}
      <path d="M180 320 L220 370 L260 345 L300 420 L340 380 L450 280 L490 340 L540 360 L580 380 L620 340 L660 320 L720 300 L760 355 L800 370 L860 400 L900 360 L980 330 L1020 380 L1060 365 L1100 410Z"
        fill="rgba(160,200,230,0.7)"/>
      {/* Ice lake */}
      <rect x="0" y="580" width="1200" height="200" fill="url(#an-ice)"/>
      {/* Aurora reflection */}
      <ellipse cx="500" cy="650" rx="400" ry="60" fill="rgba(0,180,150,0.08)" style={{ filter: 'blur(12px)' }}/>
      {/* Ice cracks */}
      <path d="M200 620 L350 640 L400 680 L500 650 L600 700 L700 640 L850 660 L950 630"
        stroke="rgba(100,160,200,0.20)" strokeWidth="1" fill="none"/>
    </svg>
  );
}
