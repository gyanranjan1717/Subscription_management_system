/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // One restrained accent for primary actions and active navigation.
        brand: {
          50: '#eef3fa',
          100: '#d9e5f4',
          600: '#2f5f9e',
          700: '#244d84',
          800: '#1c3d6b'
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      }
    }
  },
  plugins: []
};
