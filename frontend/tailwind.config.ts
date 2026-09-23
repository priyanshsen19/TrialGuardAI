import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        panel: 'hsl(var(--panel))',
        'panel-2': 'hsl(var(--panel-2))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        pass: 'hsl(var(--pass))',
        fail: 'hsl(var(--fail))',
        warn: 'hsl(var(--warn))',
        info: 'hsl(var(--info))',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { lg: '0.5rem', md: '0.375rem', sm: '0.25rem' },
      keyframes: {
        'nav-progress': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(300%)' } },
      },
      animation: { 'nav-progress': 'nav-progress 1s ease-in-out infinite' },
    },
  },
  plugins: [],
} satisfies Config;
