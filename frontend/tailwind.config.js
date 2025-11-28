/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f3f4f0',   // very light, gần Dust Grey
          100: '#dad7cd',   // Dust Grey
          200: '#c3cbb3',   // giữa Dust Grey & Dry Sage
          300: '#a3b18a',   // Dry Sage
          400: '#7b996f',   // giữa Dry Sage & Fern
          500: '#588157',   // Fern
          600: '#3a5a40',   // Hunter Green
          700: '#344e41',   // Pine Teal
          800: '#28362f',   // darker teal green
          900: '#1c241f',   // very dark pine
        }
      }
    },
  },
  plugins: [],
}
