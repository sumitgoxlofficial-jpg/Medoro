/**
 * Homepage illustration for the "motivation" section: a pharmacist at a calm counter, stocked shelves,
 * a care heart with a pulse, and a growth card rising beside them. Decorative only (aria-hidden), drawn in
 * the site's teal palette so it needs no image download.
 */
export function MotivationArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 440" className={className} role="presentation" aria-hidden focusable="false">
      <defs>
        <linearGradient id="mo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E7F2F0" />
          <stop offset="1" stopColor="#D3ECE7" />
        </linearGradient>
        <linearGradient id="mo-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0B5E5B" />
          <stop offset="1" stopColor="#084744" />
        </linearGradient>
        <linearGradient id="mo-line" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#5EEAD4" />
          <stop offset="1" stopColor="#F5C451" />
        </linearGradient>
      </defs>

      {/* backdrop */}
      <rect x="10" y="20" width="500" height="400" rx="36" fill="url(#mo-bg)" />
      <circle cx="420" cy="92" r="70" fill="#FFFFFF" opacity=".55" />
      <circle cx="86" cy="360" r="46" fill="#FFFFFF" opacity=".5" />

      {/* shop awning */}
      <g>
        <rect x="58" y="62" width="300" height="20" rx="6" fill="#0B5E5B" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M${58 + i * 50} 82h50v14a25 25 0 0 1-50 0z`} fill={i % 2 ? "#FFFFFF" : "#14B8A6"} />
        ))}
        <rect x="186" y="40" width="44" height="30" rx="7" fill="#FFFFFF" />
        <path d="M208 46v18M199 55h18" stroke="#0B5E5B" strokeWidth="5" strokeLinecap="round" />
      </g>

      {/* shelves with medicine boxes */}
      <g>
        <rect x="74" y="128" width="268" height="150" rx="10" fill="#FFFFFF" />
        <path d="M74 178h268M74 228h268" stroke="#CFE6E3" strokeWidth="3" />
        {[
          [88, 142, "#14B8A6"], [116, 148, "#8FD3C6"], [138, 138, "#0B5E5B"], [168, 146, "#F5C451"], [194, 140, "#14B8A6"],
          [228, 144, "#8FD3C6"], [254, 138, "#0B5E5B"], [286, 146, "#F28B82"], [310, 142, "#14B8A6"],
          [88, 194, "#0B5E5B"], [120, 190, "#F5C451"], [146, 196, "#14B8A6"], [178, 188, "#8FD3C6"], [212, 194, "#0B5E5B"],
          [240, 190, "#14B8A6"], [272, 196, "#8FD3C6"], [300, 188, "#F5C451"],
        ].map(([x, y, c], i) => (
          <rect key={i} x={x as number} y={y as number} width="22" height={(i < 9 ? 176 : 226) - (y as number)} rx="3" fill={c as string} />
        ))}
        {[96, 150, 204, 258, 300].map((x, i) => (
          <g key={x}>
            <rect x={x} y="240" width="28" height="36" rx="8" fill={i % 2 ? "#E7F2F0" : "#D3ECE7"} stroke="#9FCFC9" strokeWidth="2" />
            <rect x={x + 6} y="234" width="16" height="8" rx="2" fill="#0B5E5B" />
          </g>
        ))}
      </g>

      {/* pharmacist */}
      <g>
        <circle cx="206" cy="262" r="24" fill="#8C5A3C" />
        <path d="M182 258c2-20 16-30 30-28 14 2 22 12 20 26-8-8-18-12-30-10-8 2-14 6-20 12z" fill="#1F2328" />
        <path d="M156 352c4-44 24-62 50-62s46 18 50 62z" fill="#FFFFFF" stroke="#CFE6E3" strokeWidth="2" />
        <path d="M206 290l-12 22 12 40 12-40z" fill="#0B5E5B" />
        <path d="M188 300c-6 18-8 30-6 44M224 300c6 18 8 30 6 44" stroke="#14B8A6" strokeWidth="4" strokeLinecap="round" fill="none" />
        <circle cx="198" cy="262" r="2.4" fill="#1F2328" />
        <circle cx="214" cy="262" r="2.4" fill="#1F2328" />
        <path d="M199 272q7 6 14 0" stroke="#1F2328" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </g>

      {/* counter */}
      <rect x="48" y="340" width="330" height="54" rx="12" fill="#0B5E5B" />
      <rect x="48" y="340" width="330" height="12" rx="6" fill="#14B8A6" />
      <g>
        <rect x="88" y="312" width="58" height="34" rx="6" fill="#1F2328" />
        <rect x="93" y="317" width="48" height="22" rx="3" fill="#5EEAD4" />
        <path d="M100 330h14M100 324h30" stroke="#0B5E5B" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g>
        <rect x="290" y="318" width="44" height="26" rx="13" fill="#FFFFFF" />
        <path d="M312 318v26" stroke="#F28B82" strokeWidth="2" />
        <rect x="290" y="318" width="22" height="26" rx="13" fill="#F28B82" />
      </g>

      {/* growth card */}
      <g className="mo-float">
        <rect x="350" y="150" width="140" height="120" rx="18" fill="url(#mo-card)" />
        <path d="M372 244l26-22 22 12 28-34 22-10" stroke="url(#mo-line)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <path d="M462 182l16-4-4 16" stroke="#F5C451" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <rect x="372" y="168" width="54" height="8" rx="4" fill="#FFFFFF" opacity=".85" />
        <rect x="372" y="182" width="34" height="6" rx="3" fill="#FFFFFF" opacity=".45" />
      </g>

      {/* care heart with pulse */}
      <g className="mo-float mo-float-2">
        <circle cx="440" cy="326" r="42" fill="#FFFFFF" />
        <path d="M440 348c-22-14-30-24-30-36 0-9 7-16 15-16 6 0 11 3 15 9 4-6 9-9 15-9 8 0 15 7 15 16 0 12-8 22-30 36z" fill="#F28B82" />
        <path d="M414 326h12l5-9 7 18 5-9h14" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </g>

      {/* sparkles */}
      <g fill="#F5C451">
        <path className="mo-twinkle" d="M326 112l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" />
        <path className="mo-twinkle mo-twinkle-2" d="M478 384l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
        <path className="mo-twinkle mo-twinkle-3" d="M40 112l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
      </g>
    </svg>
  );
}
