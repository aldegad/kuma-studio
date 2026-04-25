interface PanelIconProps {
  panelId?: string;
  className?: string;
}

export function PanelIcon({ panelId, className = "h-4 w-4" }: PanelIconProps) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (panelId) {
    case "plan-panel":
      return (
        <svg {...common}>
          <path d="M7 5h12" />
          <path d="M7 12h12" />
          <path d="M7 19h12" />
          <path d="m3 5 1 1 2-2" />
          <path d="m3 12 1 1 2-2" />
          <path d="m3 19 1 1 2-2" />
        </svg>
      );
    case "git-log":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <circle cx="6" cy="18" r="2" />
          <path d="M6 8v8" />
          <path d="M8 6h4a6 6 0 0 1 6 6v4" />
        </svg>
      );
    case "memo":
      return (
        <svg {...common}>
          <path d="M7 4h8l4 4v12H7z" />
          <path d="M15 4v5h5" />
          <path d="M10 13h6" />
          <path d="M10 17h4" />
        </svg>
      );
    case "content":
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h10" />
          <path d="M4 18h7" />
          <path d="M17 13l3 3-3 3" />
        </svg>
      );
    case "experiment":
      return (
        <svg {...common}>
          <path d="M10 3h4" />
          <path d="M11 3v6l-5 8a3 3 0 0 0 2.6 4.5h6.8A3 3 0 0 0 18 17l-5-8V3" />
          <path d="M8 16h8" />
        </svg>
      );
    case "cmux":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" />
          <circle cx="16" cy="8" r="3" />
          <circle cx="12" cy="17" r="3" />
          <path d="M10 10.5 11 14" />
          <path d="m14 10.5-1 3.5" />
        </svg>
      );
    case "skills":
      return (
        <svg {...common}>
          <path d="M9 4h6v4h4v6h-4v6H9v-6H5V8h4z" />
          <path d="M9 8h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case "minimap":
      return (
        <svg {...common}>
          <path d="M4 6h5v12H4z" />
          <path d="M9 6l6-2v12l-6 2z" />
          <path d="m15 4 5 2v12l-5-2z" />
        </svg>
      );
    case "whiteboard":
      return (
        <svg {...common}>
          <path d="M5 5h14v10H5z" />
          <path d="M9 19h6" />
          <path d="M12 15v4" />
          <path d="M8 9h8" />
          <path d="M8 12h5" />
        </svg>
      );
    case "usage-limit":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M4 9h16" />
          <path d="M8 13h8" />
        </svg>
      );
  }
}
