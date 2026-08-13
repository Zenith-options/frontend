import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "zn-bg":      "#09090B",
        "zn-raised":  "#0F0F11",
        "zn-surface": "#18181B",
        "zn-overlay": "#27272A",
        "zn-call":    "#22C55E",
        "zn-put":     "#F43F5E",
        "zn-atm":     "#EAB308",
        "zn-brand":   "#8B5CF6",
        "zn-hi":      "#FAFAFA",
        "zn-mid":     "#71717A",
        "zn-lo":      "#3F3F46",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
