/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        bg:       '#0F1117',
        surface:  '#1A1D27',
        elevated: '#222536',
        border:   '#2E3148',
        divider:  '#262A3A',
        ink:      '#F0F0F5',
        muted:    '#8B8FA8',
        faint:    '#5B5F75',
        accent:   '#6C63FF',
        accent2:  '#8B85FF',
        ok:       '#22C55E',
        warn:     '#F59E0B',
        danger:   '#EF4444',
        info:     '#3B82F6',
        violet:   '#8B5CF6',
      },
      boxShadow: {
        soft:  '0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.4)',
        pop:   '0 12px 32px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.4)',
      },
      keyframes: {
        slideUp: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
      },
      animation: {
        slideUp: 'slideUp .25s ease-out both',
        fadeIn:  'fadeIn .2s ease-out both',
        pulseSoft: 'pulseSoft 2s ease-in-out infinite',
      }
    }
  },
  plugins: [],
}
