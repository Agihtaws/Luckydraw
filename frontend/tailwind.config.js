/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        purple: { DEFAULT: "#7C3AED", light: "#a78bfa", dark: "#6d28d9" },
        teal:   { DEFAULT: "#10b981" },
        amber:  { DEFAULT: "#f59e0b" },
      },
      screens: { xs: "480px" },
    },
  },
  plugins: [],
};