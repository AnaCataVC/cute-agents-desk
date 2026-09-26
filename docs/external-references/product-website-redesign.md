# Research & Reference: Product Website Design & Active Development Disclosure

> **Created:** 2026-09-12
> **Last Updated:** 2026-09-12

## 1. Context & Objectives

The goal is to elevate the product website (`website/index.html` and `website/style.css`) of **Cute Agents Desk** to match the high-end, polished design language established across Ana Catalina's developer tool portfolio (specifically `workspace-companion/website/index.html`, `work-activity-panel/index.html`, and `projects-hub`), while explicitly communicating that the project is in active development (work-in-progress / v0.1.0-alpha).

---

## 2. Benchmark Analysis: Design Patterns in the Workspace

Comparative audit of existing landing pages in local developer repositories:

### A. `workspace-companion/website/index.html`
* **Visual Atmosphere:** Ultra-dark canvas (`#0c0e14`) with ambient glowing meshes (`radial-gradient` blur orbs in indigo and purple).
* **Header:** Sticky glassmorphic navbar (`backdrop-blur-md bg-[#0c0e14]/80 border-b border-white/[0.06]`) featuring app icon with glow ring, project title, subtitle, anchor navigation links, and GitHub button.
* **Hero Hierarchy:**
  * Floating status pill with pulsing ping animation dot.
  * Multi-line bold headline with gradient text highlights (`bg-gradient-to-r from-indigo-400 via-purple-300 to-indigo-200 bg-clip-text text-transparent`).
  * Concise technical value proposition.
  * Verified action CTAs (real links, no dead ends).
  * High-density metric badges bar (`< 40 MB`, `0 ms flicker`, `1-Click switch`, `100% Safe`).
* **Component Cards:** Glassmorphic cards with rounded corners (`rounded-2xl`), subtle borders (`border-white/10`), inner glow on hover, and custom scrollbars.

### B. `projects-hub` (Portfolio Integration)
* **Status Badges:** Clear color-coded status badges:
  * `Activo` / `Active` -> Mint Green (`#10B981` / `#C8F3E0`)
  * `En Desarrollo` / `In Development` -> Amber / Warm Gold (`#F59E0B` / `#E9B872`)
  * `Archivado` / `Archived` -> Muted Slate (`#64748B`)
* **Metadata Schema:** Explicit categorization with Problem, Solution, Technologies, and Key Learnings.

### C. `cute-agents-desk` Current State & Pastel-Tech Assets
* **Palette:**
  * Background: `#151223` / `#1E1A2B` / `#2A243D`
  * Accents: Lilac (`#C7B8EA`), Lavender (`#8F6FFF`), Purple Accent (`#A855F7`), Mint (`#C8F3E0`), Rose/Blocked (`#C23B6B`)
* **Dynamic Assets:** Native SVG robot generator (`website/robot.js`) with keyframe animations (`bob`, `antenna`, `blink`, `wave`, `breathe`).
* **Current Shortcomings:**
  * Top navigation is very basic without glassmorphism or sticky positioning.
  * Lack of a prominent, well-structured warning/callout explaining the project's early-stage development phase.
  * Hero lacks gradient styling and punchy technical metric cards.
  * Features grid is plain without modern glassmorphism or rich architectural illustrations.
  * Engine comparison table is minimal compared to the rich documentation in `README.md` and `docs/architecture/`.

---

## 3. Work-In-Progress (WIP) Disclosure Pattern

To satisfy the explicit user requirement:
> "para que advierta que es un proyecto en desarrollo"

The website must integrate a dedicated, unmistakable warning banner and status indicators:

1. **Top Floating Status Pill:**
   * Pill in hero: `● v0.1.0-alpha · En desarrollo activo · Desktop Local` with an amber/purple pulsing indicator.
2. **Dedicated Callout Banner ("Aviso de Desarrollo Activo"):**
   * Positioned immediately below the hero or as a highlighted notification panel.
   * Visual style: Translucent glass card with an amber/purple gradient border and soft warning glow.
   * Message points:
     * **Estado Actual:** Cute Agents Desk es un prototipo funcional y banco de pruebas de arquitectura local en desarrollo activo.
     * **Sin binarios publicados:** `npm run dist` puede compilar un instalador NSIS de Windows (ver `package.json`), pero el repositorio no publica ni distribuye ninguno; hoy la aplicación se corre desde el código fuente sobre Windows 10/11.
     * **Evolución Continua:** Las interfaces IPC, protocolos de hooks (`claude` / `agy`), y el formato del buzón de coordinación están sujetos a iteración y cambios frecuentes.
     * **Canal de retroalimentación:** Invitación a reportar problemas, ideas y contribuciones en el repositorio de GitHub.

---

## 4. Invariants & Regulatory Directives

* **Zero Broken Mockups Rule:**
  * DO NOT add non-functional package manager commands (`winget install cute-agents-desk` or fake download links).
  * Only real, verified instructions: `git clone`, `npm install`, `node node_modules/electron/install.js`, `npm start`, and test validation with `npm test`.
* **Zero Flags Rule:**
  * No country flag emojis or graphics in documentation, language switchers, or footers.
* **Self-Contained & High Performance:**
  * Use vanilla modern CSS3 + Google Fonts (`Outfit`, `Inter`) to ensure zero external build step and instant loading without relying on external CDNs for core styles.
  * Preserve SVG robot animations with `prefers-reduced-motion` fallbacks.
