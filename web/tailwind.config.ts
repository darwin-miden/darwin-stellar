import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Darwin palette (was Agama dark-green): dark warm frame, cream panels, near-black ink text,
        // Darwin orange (#ff6a3d) as the brand/accent.
        bg: '#141210',
        panel: '#fdf8ed',
        surface: '#f6efde',
        surface2: '#ede5cf',
        border: 'rgba(11,11,12,0.12)',
        borderStrong: 'rgba(11,11,12,0.22)',
        fg: {
          DEFAULT: '#0b0b0c',
          muted: '#4a4a4f',
          dim: '#8a8a86',
        },
        brand: {
          DEFAULT: '#ff6a3d',
          600: '#e0562f',
          700: '#c0481f',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        pill: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        'gradient-frame':
          'linear-gradient(135deg, #4F6BFF 0%, #7B3FE4 50%, #2A2F55 100%)',
        'gradient-btn':
          'linear-gradient(180deg, #6B8BFF 0%, #2E58E8 100%)',
        'gradient-pill':
          'linear-gradient(180deg, rgba(27,32,50,0.9), rgba(13,16,26,0.9))',
      },
    },
  },
  plugins: [],
};

export default config;
