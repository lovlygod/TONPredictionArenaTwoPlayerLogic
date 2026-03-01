/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F1A",
        panel: "rgba(255,255,255,0.06)",
        line: "rgba(255,255,255,0.12)",
        accent: "#2DD4FF",
        violet: "#9B8CFF",
        danger: "#FF4D74",
        success: "#7CFFB2",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(45,212,255,0.3), 0 0 40px rgba(45,212,255,0.18)",
      },
      fontFamily: {
        sans: ["Sora", "ui-sans-serif", "system-ui"],
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulsefast: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".5" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        pulsefast: "pulsefast 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
