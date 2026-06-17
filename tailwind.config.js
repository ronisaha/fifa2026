/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // World Cup 2026 inspired palette
        pitch: {
          50: '#eefbf4',
          100: '#d6f5e3',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
        },
        brand: {
          DEFAULT: '#1d4ed8',
          dark: '#1e3a8a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
