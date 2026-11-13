/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          soft: "var(--color-primary-soft)",
          border: "var(--color-primary-border)",
        },
        neutral: {
          0: "var(--color-neutral-0)",
          50: "var(--color-neutral-50)",
          100: "var(--color-neutral-100)",
          200: "var(--color-neutral-200)",
          300: "var(--color-neutral-300)",
          400: "var(--color-neutral-400)",
          500: "var(--color-neutral-500)",
          700: "var(--color-neutral-700)",
          900: "var(--color-neutral-900)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          hover: "var(--color-success-hover)",
          soft: "var(--color-success-soft)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          soft: "var(--color-warning-soft)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover: "var(--color-danger-hover)",
          soft: "var(--color-danger-soft)",
        },
        info: {
          DEFAULT: "var(--color-info)",
          soft: "var(--color-info-soft)",
        },
        music: {
          DEFAULT: "var(--color-music)",
          soft: "var(--color-music-soft)",
        },
      },
      borderRadius: {
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        modal: "var(--radius-modal)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        subtle: "var(--shadow-subtle)",
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        pop: "var(--shadow-pop)",
      },
      spacing: {
        4.5: "1.125rem",
        18: "4.5rem",
      },
    },
  },
  plugins: [],
};
