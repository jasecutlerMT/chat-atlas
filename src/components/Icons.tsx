// Small inline SVG icons so the app ships zero external assets.

interface IconProps {
  size?: number;
}

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const SearchIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

export const CopyIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);

export const CheckIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const CloseIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const FolderIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

export const DownloadIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const SunIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
  </svg>
);

export const MoonIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export const PauseIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const PlayIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </svg>
);

export const ArrowRightIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="13 5 20 12 13 19" />
  </svg>
);

export const PaperclipIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export const PinIcon = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 17v5" />
    <path d="M9 3h6l-1 7 3 3H7l3-3z" />
  </svg>
);

export const AtlasLogo = ({ size = 22 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="7" cy="7" r="3" fill="var(--accent)" />
    <circle cx="17.5" cy="10" r="2.2" fill="currentColor" opacity="0.75" />
    <circle cx="10" cy="17.5" r="2.6" fill="currentColor" opacity="0.5" />
    <line x1="9" y1="9" x2="15.6" y2="9.4" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
    <line x1="8.4" y1="9.6" x2="9.6" y2="15.4" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
    <line x1="12" y1="16.4" x2="16.2" y2="11.8" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
  </svg>
);
