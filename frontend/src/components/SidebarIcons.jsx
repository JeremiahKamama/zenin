const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  "aria-hidden": "true"
};

const strokeProps = {
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

export function HomeIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3.5 11.4 12 4.4l8.5 7" {...strokeProps} />
      <path d="M6.5 10.2v9.3h11v-9.3" {...strokeProps} />
    </svg>
  );
}

export function PortfolioIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5" {...strokeProps} />
      <path d="M12 4.5v7.5h7.5" {...strokeProps} />
    </svg>
  );
}

export function WatchlistIcon() {
  return (
    <svg {...iconProps}>
      <path d="m12 4.2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z" {...strokeProps} />
    </svg>
  );
}

export function AnalyticsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 19h15" {...strokeProps} />
      <path d="M7 17v-5.5" {...strokeProps} />
      <path d="M12 17V8" {...strokeProps} />
      <path d="M17 17v-3.5" {...strokeProps} />
    </svg>
  );
}

export function ResearchIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5.5 5.5h8.2a3 3 0 0 1 3 3v10H8.5a3 3 0 0 0-3 3z" {...strokeProps} />
      <path d="M8.5 9h5.2" {...strokeProps} />
      <path d="M8.5 12h4" {...strokeProps} />
      <path d="M17.5 7.5h1.5a2 2 0 0 1 2 2v8.5" {...strokeProps} />
    </svg>
  );
}

export function MetricsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 17.5h15" {...strokeProps} />
      <path d="M6 14l3.2-3.2 3 2.3 5.8-6.3" {...strokeProps} />
    </svg>
  );
}

export function OptionsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7.3 15.8a3.8 3.8 0 1 1 0-7.6" {...strokeProps} />
      <path d="M16.7 8.2a3.8 3.8 0 1 1 0 7.6" {...strokeProps} />
      <path d="M8.2 12h7.6" {...strokeProps} />
    </svg>
  );
}

export function PredictionsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 17.5h15" {...strokeProps} />
      <path d="m5.5 15 4.2-4.1 3.3 2.5 5.5-6.2" {...strokeProps} />
    </svg>
  );
}

export function JournalIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6 5.5h5.5a2 2 0 0 1 2 2v11H8a2 2 0 0 0-2 2z" {...strokeProps} />
      <path d="M18 5.5h-5.5a2 2 0 0 0-2 2v11H16a2 2 0 0 1 2 2z" {...strokeProps} />
    </svg>
  );
}

export function BriefingIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4.5 6.5h12.5a2 2 0 0 1 2 2v9.5H8.5a4 4 0 0 0-4 4z" {...strokeProps} />
      <path d="M8 10h7M8 13h5" {...strokeProps} />
      <path d="M16.5 6.5 14.5 4.3 9 4.8" {...strokeProps} />
    </svg>
  );
}

export function DecisionsIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12.5 8.5 16 19 5.5" {...strokeProps} />
      <path d="M9.5 6.5h11M9.5 17.5h5" {...strokeProps} />
    </svg>
  );
}

export function TaxIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 4.5h10v15H7z" {...strokeProps} />
      <path d="M9.5 8h5" {...strokeProps} />
      <path d="M9.5 11.5h1.5M13 11.5h1.5" {...strokeProps} />
      <path d="M9.5 15h1.5M13 15h1.5" {...strokeProps} />
      <path d="M9.5 18.5h1.5M13 18.5h1.5" {...strokeProps} />
    </svg>
  );
}

export function LiveRailIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6.5 17.5v-3.5" {...strokeProps} />
      <path d="M11.5 17.5V9.5" {...strokeProps} />
      <path d="M16.5 17.5V6.5" {...strokeProps} />
    </svg>
  );
}

export function ThemeDarkIcon() {
  return (
    <svg {...iconProps}>
      <path d="M18.5 14.3A6.7 6.7 0 0 1 9.7 5.5 7.2 7.2 0 1 0 18.5 14.3z" {...strokeProps} />
    </svg>
  );
}

export function ThemeLightIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z" {...strokeProps} />
      <path d="M12 3.5v2M12 18.5v2M4.5 12h2M17.5 12h2M6.7 6.7l1.4 1.4M15.9 15.9l1.4 1.4M17.3 6.7l-1.4 1.4M8.1 15.9l-1.4 1.4" {...strokeProps} />
    </svg>
  );
}

export function AccountIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 12.2a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z" {...strokeProps} />
      <path d="M5.5 19.2a6.7 6.7 0 0 1 13 0" {...strokeProps} />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg {...iconProps}>
      <path d="M10 5.5H6.5v13H10" {...strokeProps} />
      <path d="M12.5 8.5 16.5 12l-4 3.5" {...strokeProps} />
      <path d="M16.5 12H9" {...strokeProps} />
    </svg>
  );
}
