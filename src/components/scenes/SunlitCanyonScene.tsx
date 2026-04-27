export function SunlitCanyonScene() {
  return (
    <svg viewBox="0 0 1200 780" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="sc-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#79d4ff"/>
          <stop offset="55%" stopColor="#9be4ff"/>
          <stop offset="100%" stopColor="#ffd99a"/>
        </linearGradient>
        <linearGradient id="sc-rock" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d08a4a"/>
          <stop offset="100%" stopColor="#7c4426"/>
        </linearGradient>
        <linearGradient id="sc-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#efc172"/>
          <stop offset="100%" stopColor="#a16135"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="780" fill="url(#sc-sky)"/>
      <circle cx="980" cy="130" r="50" fill="rgba(255,244,214,0.95)"/>
      <ellipse cx="200" cy="155" rx="160" ry="34" fill="rgba(255,255,255,0.22)"/>
      <ellipse cx="320" cy="138" rx="118" ry="26" fill="rgba(255,255,255,0.24)"/>
      <path d="M0 210 L0 700 L340 700 L340 360 L290 300 L250 320 L195 250 L130 290 L90 230Z" fill="url(#sc-rock)"/>
      <path d="M0 210 L90 230 L130 290 L195 250 L250 320 L290 300 L340 360 L340 410 L0 390Z" fill="rgba(255,210,150,0.18)"/>
      <path d="M1200 190 L1200 700 L835 700 L835 340 L885 290 L930 320 L980 255 L1035 286 L1080 232 L1140 242Z" fill="url(#sc-rock)"/>
      <path d="M1200 190 L1140 242 L1080 232 L1035 286 L980 255 L930 320 L885 290 L835 340 L835 382 L1200 360Z" fill="rgba(255,216,162,0.16)"/>
      <path d="M295 700 L350 448 L450 485 L560 430 L650 458 L760 420 L860 474 L915 700Z" fill="url(#sc-floor)"/>
      <path d="M350 700 L390 555 L455 585 L520 535 L578 570 L632 540 L700 590 L760 550 L820 592 L860 520 L915 700Z" fill="rgba(102,52,25,0.28)"/>
      <rect x="0" y="690" width="1200" height="90" fill="#a96135"/>
      <path d="M480 780 C500 740 520 722 548 700 C575 679 604 654 640 626" stroke="rgba(90,220,240,0.24)" strokeWidth="4" fill="none"/>
      <path d="M480 780 C500 740 520 722 548 700 C575 679 604 654 640 626" stroke="rgba(90,220,240,0.10)" strokeWidth="12" fill="none" style={{ filter: 'blur(6px)' }}/>
    </svg>
  );
}
