/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        harvest: {
          50: '#f3f8ef',
          100: '#e3efd9',
          200: '#c8e0b6',
          300: '#a3cb8a',
          400: '#7db15f',
          500: '#5c9540',
          600: '#457630',
          700: '#365c28',
          800: '#2d4a24',
          900: '#263f20',
        },
      },
      fontFamily: {
        // Five scripts, not one (§17). Each "Noto Sans <Script>" name only
        // engages if that font is actually present — most Android/desktop
        // systems ship at least partial Indic coverage — so this costs
        // nothing when unused and never leaves a script rendering as tofu
        // when it is. No web font is loaded for this (§18): system fonts
        // only, kept fast on low-end mobile.
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Noto Sans',
          'Noto Sans Tamil',
          'Noto Sans Kannada',
          'Noto Sans Devanagari',
          'Noto Sans Malayalam',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
