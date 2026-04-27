export function EmeraldDuskScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="ed-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06111b"/>
          <stop offset="45%" stopColor="#0d2330"/>
          <stop offset="100%" stopColor="#123640"/>
        </linearGradient>
        <linearGradient id="ed-ridge-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0b1d28"/>
          <stop offset="100%" stopColor="#09131d"/>
        </linearGradient>
        <linearGradient id="ed-ridge-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#123339"/>
          <stop offset="100%" stopColor="#0a171d"/>
        </linearGradient>
        <linearGradient id="ed-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1f6b72" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#081118" stopOpacity="0.95"/>
        </linearGradient>
        <linearGradient id="ed-aura" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(45,212,191,0)"/>
          <stop offset="35%" stopColor="rgba(45,212,191,0.18)"/>
          <stop offset="65%" stopColor="rgba(125,211,252,0.14)"/>
          <stop offset="100%" stopColor="rgba(45,212,191,0)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#ed-sky)"/>
      <ellipse cx="620" cy="210" rx="500" ry="90" fill="url(#ed-aura)" opacity="0.9"/>
      <ellipse cx="420" cy="170" rx="280" ry="54" fill="url(#ed-aura)" opacity="0.5" transform="rotate(-7 420 170)"/>
      <ellipse cx="860" cy="250" rx="340" ry="62" fill="url(#ed-aura)" opacity="0.35" transform="rotate(5 860 250)"/>
      {[
        [72, 52, 0.8, 0.6], [150, 88, 1.1, 0.7], [246, 44, 0.7, 0.7], [328, 94, 1.2, 0.55],
        [418, 38, 0.9, 0.8], [520, 76, 0.7, 0.7], [614, 58, 1.0, 0.6], [708, 30, 0.8, 0.8],
        [812, 72, 1.0, 0.55], [908, 48, 0.7, 0.75], [1014, 84, 1.1, 0.65], [1110, 42, 0.8, 0.7],
      ].map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="white" opacity={o}/>
      ))}
      <path d="M0 520 L140 360 L260 450 L390 300 L520 410 L680 270 L820 390 L960 310 L1080 400 L1200 340 L1200 560 L0 560Z" fill="url(#ed-ridge-far)" opacity="0.95"/>
      <path d="M0 610 L160 470 L300 560 L470 420 L640 540 L780 430 L940 530 L1080 460 L1200 520 L1200 660 L0 660Z" fill="url(#ed-ridge-near)"/>
      <rect x="0" y="640" width="1200" height="140" fill="url(#ed-water)"/>
      <ellipse cx="700" cy="655" rx="180" ry="28" fill="rgba(45,212,191,0.15)" style={{ filter: 'blur(10px)' }}/>
      <path d="M0 676 Q300 664 600 676 Q900 688 1200 676" stroke="rgba(125,211,252,0.12)" strokeWidth="1" fill="none"/>
      <path d="M0 706 Q300 696 600 706 Q900 716 1200 706" stroke="rgba(45,212,191,0.08)" strokeWidth="1" fill="none"/>
    </svg>
  );
}
