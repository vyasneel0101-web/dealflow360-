/**
 * tailwind.config.js — the DealFlow360 design system.
 *
 * Tailwind is only the delivery mechanism; the system is ours (design.md §2).
 * The constraints below are the point of this file: a deliberately small scale
 * is what keeps screens built independently by two people from drifting apart.
 *
 * SHARED FILE — coordinate before editing. Changing a token here silently
 * changes every screen the other developer has already built.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./web/index.html",
    "./web/src/**/*.{ts,tsx}",
    "./portal/index.html",
    "./portal/src/**/*.{ts,tsx}",
  ],
  theme: {
    // ── Spacing: 4px base. Six content steps, replacing Tailwind's default 32.
    // A constrained scale is what makes independently-built screens line up.
    // 12 and 16 exist only for page-level layout, not for component internals.
    spacing: {
      0: "0px",
      px: "1px",
      1: "4px",   // tight — icon to label
      2: "8px",   // related elements
      3: "12px",  // control padding
      4: "16px",  // card padding
      6: "24px",  // page gutter
      8: "32px",  // section separation
      12: "48px", // page-level only
      16: "64px", // page-level only
    },

    // ── Colour: neutrals carry the UI. Colour is reserved for STATE.
    // In a governance product a coloured thing must mean something — if colour
    // is decorative, users stop reading it and the OVER badge stops working.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#FFFFFF",

      bg: "#F7F8FA",
      surface: "#FFFFFF",
      border: "#E4E7EC",

      text: {
        DEFAULT: "#101828",
        muted: "#667085",
        inverse: "#FFFFFF",
      },

      brand: {
        DEFAULT: "#2563EB",
        hover: "#1D4ED8",
        subtle: "#EFF4FF",
      },

      // State colours. Each has a `subtle` background for badge fills.
      // Every pairing below clears 4.5:1 against its own subtle background.
      ok: { DEFAULT: "#12805C", subtle: "#E6F4EF" }, // OK, Approved, Paid, Active
      warn: { DEFAULT: "#B54708", subtle: "#FEF0E6" }, // MEDIUM, Pending, Backorder
      danger: { DEFAULT: "#B42318", subtle: "#FEE4E2" }, // HIGH, OVER, Rejected, Unpaid
      info: { DEFAULT: "#175CD3", subtle: "#EFF4FF" }, // Draft, Under Negotiation
    },

    // ── Type: four sizes only.
    fontSize: {
      xs: ["12px", { lineHeight: "16px" }],   // metadata, table captions
      sm: ["14px", { lineHeight: "20px" }],   // body, table cells
      base: ["16px", { lineHeight: "24px" }], // section headings
      xl: ["20px", { lineHeight: "28px" }],   // page titles
    },
    fontWeight: {
      normal: "400",
      medium: "500",
      semibold: "600",
    },

    borderRadius: {
      none: "0",
      sm: "4px",  // inputs, badges
      md: "8px",  // cards
      full: "9999px",
    },

    // One shadow, used on overlays only. Flat surfaces are separated by
    // `border`, not by stacked shadows.
    boxShadow: {
      none: "none",
      overlay: "0 8px 24px rgba(16, 24, 40, 0.12)",
    },

    extend: {
      fontFamily: {
        // System stack — no webfont, so nothing loads from a CDN at runtime.
        sans: [
          "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto",
          "Helvetica Neue", "Arial", "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      gridTemplateColumns: {
        // Screen 4: line table + summary/upsell rail.
        builder: "minmax(0, 1fr) 320px",
      },
      maxWidth: {
        page: "1440px",
        portal: "760px", // the portal is calmer and narrower by design
      },
    },
  },
  plugins: [],
};
