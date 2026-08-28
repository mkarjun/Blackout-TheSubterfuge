/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#05070c',
        panel: '#0c1119',
        edge: '#1c2534',
        neon: '#38f2c4',
        alarm: '#ff4d5e',
        caution: '#ffc14d',
        dim: '#7b8798',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'Consolas', 'monospace'],
      },
      keyframes: {
        flicker: {
          '0%,100%': { opacity: '1' },
          '45%': { opacity: '0.65' },
          '50%': { opacity: '0.25' },
          '55%': { opacity: '0.8' },
        },
        slidein: {
          from: { transform: 'translateX(14px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        flicker: 'flicker 2.6s infinite',
        slidein: 'slidein 180ms ease-out',
      },
    },
  },
  plugins: [],
};
