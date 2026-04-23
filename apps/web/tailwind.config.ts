import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Satoshi", "Aptos", "Manrope", "ui-sans-serif", "sans-serif"],
        display: ["Space Grotesk", "Satoshi", "ui-sans-serif", "sans-serif"]
      },
      colors: {
        obsidian: "#070a0f",
        panel: "#10151f",
        graphite: "#17202c",
        line: "rgba(148, 163, 184, 0.16)",
        accent: "#8fb7ae",
        amber: "#d6a96c"
      },
      boxShadow: {
        premium: "0 20px 60px rgba(0, 0, 0, 0.34)",
        soft: "0 1px 0 rgba(255, 255, 255, 0.04), 0 18px 48px rgba(0, 0, 0, 0.28)"
      }
    }
  },
  plugins: []
};

export default config;
