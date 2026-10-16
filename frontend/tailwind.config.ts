import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";

/** TailwindCSS configuration. */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "slide-in": {
          from: { transform: "translateY(-0.5rem)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        blink: "blink 1s step-end infinite",
        "slide-in": "slide-in 0.2s ease-out",
      },
    },
  },
  plugins: [typography],
};

export default config;
