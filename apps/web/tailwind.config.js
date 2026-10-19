/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        border: 'var(--border)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        'accent-text': 'var(--accent-text)',
        ok: 'var(--ok)',
        wa: 'var(--wa)',
        tle: 'var(--tle)',
        mle: 'var(--mle)',
        re: 'var(--re)',
        ce: 'var(--ce)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: { DEFAULT: 'var(--radius)', sm: 'var(--radius-sm)' },
      boxShadow: { DEFAULT: 'var(--shadow)' },
    },
  },
  plugins: [],
}
