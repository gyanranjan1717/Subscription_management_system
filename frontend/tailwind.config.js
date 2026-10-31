/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        odoo: {
          50: '#fdf4f5',
          100: '#fbe8ec',
          500: '#714B67',
          600: '#5c3954',
          700: '#482a41',
          teal: '#017E84'
        }
      }
    },
  },
  plugins: [],
}
