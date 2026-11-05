/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#2f54d0", hover: "#2446b5", soft: "#edf1ff" },
        neutral: {
          0: "#ffffff",
          50: "#f6f7fb",
          100: "#eef1f6",
          200: "#e6e9f1",
          300: "#d5dbe7",
          500: "#6f7a90",
          700: "#38445a",
          900: "#172033",
        },
        success: { DEFAULT: "#168352", soft: "#e6f7ef" },
        warning: { DEFAULT: "#8a5a10", soft: "#fff4e5" },
        danger: { DEFAULT: "#b42318", soft: "#fde8ea" },
        info: { DEFAULT: "#405ac5", soft: "#eef3ff" },
      },
      borderRadius: {
        control: "7px",
        card: "11px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 8px 20px rgb(35 52 91 / 7%)",
        pop: "0 16px 40px rgb(23 32 51 / 16%)",
      },
      spacing: {
        4.5: "1.125rem",
        18: "4.5rem",
      },
    },
  },
  plugins: [],
};
