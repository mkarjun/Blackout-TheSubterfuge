import React from 'react';

/**
 * Icons.jsx - the icon vocabulary for the HUD and the landing page.
 *
 * Inline SVG rather than a package: they inherit `currentColor`, so one button style
 * tints them all, and it saves a dependency for a dozen glyphs. Authored on a 24x24
 * grid with a 1.7 stroke so they carry the same optical weight in a toolbar.
 */

function Svg({ children, size = 16, fill = false, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Support: a coffee cup. The single most important icon on the page - it is the ask. */
export function IconCoffee(props) {
  return (
    <Svg {...props}>
      <path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
      <path d="M17 10h1.6a2.4 2.4 0 0 1 0 4.8H17" />
      <path d="M7.5 2.5c-.7 1-.7 1.8 0 2.8M10.8 2.5c-.7 1-.7 1.8 0 2.8M14.1 2.5c-.7 1-.7 1.8 0 2.8" />
    </Svg>
  );
}

export function IconPlay(props) {
  return (
    <Svg fill {...props}>
      <path d="M7 4.5v15l13-7.5z" />
    </Svg>
  );
}

export function IconPause(props) {
  return (
    <Svg fill {...props}>
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </Svg>
  );
}

export function IconEye(props) {
  return (
    <Svg {...props}>
      <path d="M2.5 12s3.6-6.5 9.5-6.5S21.5 12 21.5 12s-3.6 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  );
}

export function IconEyeOff(props) {
  return (
    <Svg {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c5.9 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9" />
      <path d="M6.3 7.5A16.6 16.6 0 0 0 2.5 12S6.1 18 12 18a9.6 9.6 0 0 0 3.9-.8" />
      <path d="M9.9 10a2.9 2.9 0 0 0 4.1 4.1" />
    </Svg>
  );
}

export function IconSound(props) {
  return (
    <Svg {...props}>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />
    </Svg>
  );
}

export function IconMuted(props) {
  return (
    <Svg {...props}>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M16.5 10l4 4M20.5 10l-4 4" />
    </Svg>
  );
}

export function IconGear(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.5 14.4a1.6 1.6 0 0 0 .3 1.7l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.7.3h.1a1.6 1.6 0 0 0 1-1.5v-.2a1.9 1.9 0 0 1 3.8 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.7v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Svg>
  );
}

export function IconRestart(props) {
  return (
    <Svg {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" />
      <path d="M3.5 19v-5h5" />
    </Svg>
  );
}

export function IconExit(props) {
  return (
    <Svg {...props}>
      <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </Svg>
  );
}

export function IconSpark(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.2 13.8 9l5.8 1.8-5.8 1.8L12 18.4l-1.8-5.8L4.4 10.8 10.2 9z" />
      <path d="M18.5 3.5v3M20 5h-3" />
    </Svg>
  );
}

export function IconCloud(props) {
  return (
    <Svg {...props}>
      <path d="M6.8 18.5a4 4 0 0 1-.5-8 5.6 5.6 0 0 1 10.7-1.2 3.9 3.9 0 0 1 .3 7.8z" />
      <path d="M12 15.5v-5M9.8 12.4 12 10.2l2.2 2.2" />
    </Svg>
  );
}

export function IconGithub(props) {
  return (
    <Svg fill {...props}>
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85l-.01 2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </Svg>
  );
}

export function IconChevron({ open = false, ...props }) {
  return (
    <Svg {...props}>
      <path
        d="M6 9.5 12 15l6-5.5"
        style={{
          transformOrigin: '12px 12px',
          transform: open ? 'none' : 'rotate(-90deg)',
          transition: 'transform 160ms ease',
        }}
      />
    </Svg>
  );
}

export function IconUsers(props) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 14.6a5.5 5.5 0 0 1 3 4.9" />
    </Svg>
  );
}

export function IconClose(props) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconDownload(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.5v11M8 10.8l4 4 4-4" />
      <path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}
