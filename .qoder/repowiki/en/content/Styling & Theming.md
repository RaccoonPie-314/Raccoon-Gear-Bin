# Styling & Theming

<cite>
**Referenced Files in This Document**
- [main.css](file://app/assets/css/main.css)
- [nuxt.config.ts](file://nuxt.config.ts)
- [ColorModeToggle.vue](file://app/components/ColorModeToggle.vue)
- [ProductCard.vue](file://app/components/ProductCard.vue)
- [CategoryNav.vue](file://app/components/CategoryNav.vue)
- [SearchDock.vue](file://app/components/SearchDock.vue)
- [index.vue](file://app/pages/index.vue)
- [package.json](file://package.json)
</cite>

## Update Summary
**Changes Made**
- Enhanced select dropdown animations with sophisticated morphing effects
- Added panel unfold animations from trigger pills with custom easing curves
- Implemented improved micro-interactions for better UX
- Updated troubleshooting guide with new animation-related guidance

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Enhanced Animation System](#enhanced-animation-system)
7. [Dependency Analysis](#dependency-analysis)
8. [Performance Considerations](#performance-considerations)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [Conclusion](#conclusion)

## Introduction
This document explains the styling and theming system for a Nuxt 4 application using Tailwind CSS v4, Nuxt UI, and the color-mode module. It covers the CSS architecture, custom theme configuration, dark mode implementation, responsive design patterns, and performance considerations. It also documents the ColorModeToggle component and how it manages theme switching across the application, along with the enhanced animation system featuring sophisticated morphing effects and panel unfold animations.

## Project Structure
The styling setup is centered around a single global stylesheet that imports Tailwind and Nuxt UI, defines a static theme token, and adds application-wide styles such as dark mode backgrounds, selection colors, scroll behavior, page transitions, and sophisticated select dropdown animations. The Nuxt configuration registers this stylesheet, enables the color-mode module with a class-based approach, and configures Nuxt UI's theme tokens.

```mermaid
graph TB
A["Nuxt App"] --> B["Global Stylesheet<br/>app/assets/css/main.css"]
B --> C["Tailwind CSS v4"]
B --> D["@nuxt/ui"]
E["Nuxt Config<br/>nuxt.config.ts"] --> F["CSS Entry Registration"]
E --> G["Color Mode Module"]
E --> H["Nuxt UI Theme Tokens"]
I["Components"] --> J["SearchDock.vue<br/>Advanced Morphing"]
I --> K["ColorModeToggle.vue<br/>Theme Switching"]
I --> L["ProductCard.vue<br/>Responsive Design"]
```

**Diagram sources**
- [main.css:1-6](file://app/assets/css/main.css#L1-L6)
- [nuxt.config.ts:4-36](file://nuxt.config.ts#L4-L36)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)

**Section sources**
- [main.css:1-106](file://app/assets/css/main.css#L1-L106)
- [nuxt.config.ts:1-52](file://nuxt.config.ts#L1-L52)

## Core Components
- Global stylesheet: Imports Tailwind and Nuxt UI, defines a static font theme token, sets smooth scrolling, base body styles, dark mode overrides, selection colors, scrollbar suppression utilities, page transitions, and sophisticated select dropdown animations with morphing effects.
- Nuxt configuration: Registers the global stylesheet, enables @nuxtjs/color-mode with class suffix disabled, prefers system theme with dark fallback, and configures Nuxt UI theme tokens.
- ColorModeToggle component: Provides a client-only button to toggle between light and dark modes, with accessible labels and icons.
- SearchDock component: Implements advanced morphing animations with panel unfold effects from trigger pills, custom easing curves, and micro-interactions.

Key responsibilities:
- Centralized theme entry point via main.css.
- Class-based dark mode toggling through the color-mode module.
- Responsive layouts built with Tailwind utility classes across components.
- Sophisticated animation system with morphing effects and panel unfold animations.

**Section sources**
- [main.css:1-106](file://app/assets/css/main.css#L1-L106)
- [nuxt.config.ts:4-36](file://nuxt.config.ts#L4-L36)
- [ColorModeToggle.vue:1-66](file://app/components/ColorModeToggle.vue#L1-L66)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)

## Architecture Overview
The styling architecture follows a minimal, composable pattern with enhanced animation capabilities:
- Tailwind CSS v4 provides utility-first classes and a modern build pipeline.
- Nuxt UI contributes additional components and tokens.
- The color-mode module applies a .dark class on the root element when dark mode is active.
- Components use responsive breakpoints and dark variants consistently.
- Advanced animation system with morphing effects and panel unfold animations.

```mermaid
graph TB
subgraph "Application"
P["Pages<br/>index.vue"]
C1["Components<br/>ProductCard.vue"]
C2["Components<br/>CategoryNav.vue"]
C3["Components<br/>SearchDock.vue<br/>Advanced Animations"]
T["Theme Toggle<br/>ColorModeToggle.vue"]
end
subgraph "Styling Layer"
M["main.css<br/>Enhanced Animations"]
TW["Tailwind CSS v4"]
NU["@nuxt/ui"]
CM["Color Mode Module"]
AN["Animation System<br/>Morphing Effects"]
end
P --> C1
P --> C2
P --> C3
P --> T
C1 --> M
C2 --> M
C3 --> M
T --> M
M --> TW
M --> NU
CM --> M
AN --> M
```

**Diagram sources**
- [index.vue:191-329](file://app/pages/index.vue#L191-L329)
- [ProductCard.vue:9-67](file://app/components/ProductCard.vue#L9-L67)
- [CategoryNav.vue:19-35](file://app/components/CategoryNav.vue#L19-L35)
- [SearchDock.vue:288-420](file://app/components/SearchDock.vue#L288-L420)
- [ColorModeToggle.vue:11-64](file://app/components/ColorModeToggle.vue#L11-L64)
- [main.css:62-105](file://app/assets/css/main.css#L62-L105)

## Detailed Component Analysis

### ColorModeToggle Component
The ColorModeToggle component encapsulates theme switching logic and presentation:
- Uses the color-mode composable to read and update the current preference.
- Renders a button with accessible attributes (aria-label, title).
- Displays sun/moon SVG icons based on the current mode.
- Wraps content in ClientOnly to avoid SSR mismatch.

```mermaid
sequenceDiagram
participant User as "User"
participant Button as "ColorModeToggle Button"
participant Mode as "useColorMode()"
participant Root as "Root Element (.dark)"
User->>Button : Click
Button->>Mode : Update preference (light/dark)
Mode-->>Root : Apply/remove .dark class
Root-->>Button : Re-render with updated state
```

**Diagram sources**
- [ColorModeToggle.vue:1-66](file://app/components/ColorModeToggle.vue#L1-L66)

Implementation highlights:
- Computed state determines icon visibility and accessibility labels.
- Click handler flips the preference between light and dark.
- Fallback placeholder ensures layout stability during SSR.

**Section sources**
- [ColorModeToggle.vue:1-66](file://app/components/ColorModeToggle.vue#L1-L66)

### ProductCard Component
ProductCard demonstrates responsive design and consistent styling:
- Uses aspect-ratio and grid layouts to adapt from single-column to multi-column grids.
- Applies dark variants for borders, backgrounds, and text colors.
- Includes hover states and transitions for interactive elements.
- Integrates StockStatus and NuxtLink for navigation and status display.

Responsive patterns:
- Grid columns scale from 1 to 2 to 3 across breakpoints.
- Typography scales with sm:text-* utilities.
- Spacing and sizing adjust responsively.

Accessibility:
- Images include alt text.
- Interactive elements have aria-labels where appropriate.

**Section sources**
- [ProductCard.vue:1-68](file://app/components/ProductCard.vue#L1-L68)

### CategoryNav Component
CategoryNav coordinates two implementations:
- Desktop vertical navigation shown at lg and above.
- Mobile bottom bar handled by CategoryMobile.vue.

Breakpoint usage:
- Hidden on small screens; visible at lg breakpoint.
- Delegates mobile-specific behavior to CategoryMobile.vue.

```mermaid
flowchart TD
Start(["Render CategoryNav"]) --> CheckBreakpoint{"Screen >= lg?"}
CheckBreakpoint --> |Yes| ShowDesktop["Show CategoryDesktop"]
CheckBreakpoint --> |No| ShowMobile["Show CategoryMobile"]
ShowDesktop --> BindModel["Bind modelValue and emit updates"]
ShowMobile --> BindModel
BindModel --> End(["Navigation State Synced"])
```

**Diagram sources**
- [CategoryNav.vue:19-35](file://app/components/CategoryNav.vue#L19-L35)

**Section sources**
- [CategoryNav.vue:1-37](file://app/components/CategoryNav.vue#L1-L37)

### Index Page Layout
The index page showcases a comprehensive responsive layout:
- Header row with logo, theme toggle, language switcher, and admin controls.
- Hero section with responsive typography and spacing.
- Two-column layout on large screens: sticky category sidebar and product listing.
- Search and sort controls with responsive widths.
- Product grid adapting from 1 to 2 to 3 columns.

Responsive patterns:
- Flexbox and grid utilities manage layout shifts.
- Breakpoints: sm, md, lg, xl used for progressive enhancement.
- Sticky positioning for sidebar on larger screens.

Accessibility:
- Inputs have aria-labels and placeholders.
- Buttons include aria-labels and titles.
- Modal dialogs use role="dialog" and aria-modal.

**Section sources**
- [index.vue:191-329](file://app/pages/index.vue#L191-L329)

## Enhanced Animation System

### Select Dropdown Morphing Effects
The application features sophisticated morphing animations for Nuxt UI select dropdowns that create a more natural and polished user experience:

#### Panel Unfold Animations
- **Trigger-to-Panel Morph**: Select panels unfold from their trigger pills rather than appearing as instant pops
- **Transform Origin Integration**: Leverages reka's `--reka-select-content-transform-origin` for edge-aware scaling
- **Custom Easing Curves**: Uses `cubic-bezier(0.33, 1, 0.68, 1)` for open animations and `cubic-bezier(0.42, 0, 1, 1)` for close animations

#### Animation Specifications
- **Open Animation**: 300ms duration with opacity ramp covering first 18% of timeline
- **Close Animation**: 200ms duration with ease-in curve to prevent visual hanging
- **Scale Values**: Start at scaleY(0.24) representing trigger height/panel height ratio (32/136)
- **Opacity Control**: Strategic opacity timing to avoid hard flashes while maintaining smooth transitions

```mermaid
sequenceDiagram
participant Trigger as "Select Trigger Pill"
participant Panel as "Dropdown Panel"
participant Animation as "Morphing Engine"
Trigger->>Animation : Open Event
Animation->>Panel : Apply scaleY(0.24) + opacity : 0
Animation->>Panel : Animate to scaleY(1) + opacity : 1
Note over Panel : Custom easing curve applied
Panel->>Trigger : Smooth unfold effect
Trigger->>Animation : Close Event
Animation->>Panel : Apply ease-in curve
Animation->>Panel : Animate to scaleY(0.24) + opacity : 0
Note over Panel : Prevents visual hanging
```

**Diagram sources**
- [main.css:62-105](file://app/assets/css/main.css#L62-L105)

### SearchDock Advanced Morphing
The SearchDock component implements complex morphing animations that transform search triggers into full search interfaces:

#### Morphing States
- **Capture Phase**: Measures launcher position, size, and glyph properties
- **Transition Phase**: Coordinates panel expansion, flyer animation, and backdrop fade
- **Settlement Phase**: Ensures smooth completion and cleanup

#### Animation Components
- **Panel Morph**: Expands from pill shape to rounded rectangle with border-radius transitions
- **Flyer Animation**: Glyph flies from launcher position to panel position with color transitions
- **Backdrop Fade**: Semi-transparent overlay with staggered timing
- **Content Reveal**: Search input fades in with calculated delay

```mermaid
stateDiagram-v2
[*] --> Capturing
Capturing --> Transitioning : Scene Measured
Transitioning --> Settled : Morph Complete
Settled --> Closing : User Action
Closing --> Settled : Morph Complete
Settled --> [*] : Cleanup
note right of Capturing : Measure launcher<br/>and panel geometry
note right of Transitioning : Animate panel,<br/>flyer, and backdrop
note right of Closing : Reverse morph<br/>to launcher position
```

**Diagram sources**
- [SearchDock.vue:161-191](file://app/components/SearchDock.vue#L161-L191)
- [SearchDock.vue:288-352](file://app/components/SearchDock.vue#L288-L352)
- [SearchDock.vue:371-420](file://app/components/SearchDock.vue#L371-L420)

**Section sources**
- [main.css:62-105](file://app/assets/css/main.css#L62-L105)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)

## Dependency Analysis
The styling dependencies are straightforward with enhanced animation support:
- Tailwind CSS v4 is imported via the global stylesheet.
- Nuxt UI is imported to leverage its components and tokens.
- The color-mode module integrates with the app to apply .dark class.
- Advanced animation system enhances user interactions.

```mermaid
graph LR
MainCSS["main.css<br/>Enhanced Animations"] --> Tailwind["tailwindcss"]
MainCSS --> NuxtUI["@nuxt/ui"]
NuxtConfig["nuxt.config.ts"] --> ColorMode["@nuxtjs/color-mode"]
NuxtConfig --> NuxtUIConfig["ui.theme.colors"]
SearchDock["SearchDock.vue"] --> Morphing["Advanced Morphing"]
```

**Diagram sources**
- [main.css:1-2](file://app/assets/css/main.css#L1-L2)
- [nuxt.config.ts:4-31](file://nuxt.config.ts#L4-L31)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)

**Section sources**
- [package.json:12-24](file://package.json#L12-L24)
- [main.css:1-2](file://app/assets/css/main.css#L1-L2)
- [nuxt.config.ts:4-31](file://nuxt.config.ts#L4-L31)

## Performance Considerations
- CSS Bundle Size:
  - Tailwind CSS v4 uses a modern build pipeline that generates only used utilities, minimizing bundle size.
  - Importing only necessary modules (@nuxt/ui) helps keep the CSS footprint lean.
- Critical CSS Extraction:
  - The global stylesheet is registered in Nuxt config, ensuring critical styles are included early.
  - Keep essential base styles (fonts, background, selection) in main.css to reduce FOUC.
- Style Optimization:
  - Use utility classes directly in components to avoid redundant CSS.
  - Avoid heavy custom CSS; prefer Tailwind utilities for consistency and tree-shaking.
- Animations and Transitions:
  - Prefer transform and opacity for animations to leverage GPU acceleration.
  - Keep animation durations short (e.g., 180ms–300ms) for snappy interactions.
  - Use will-change property strategically for complex morphing animations.
  - Implement requestAnimationFrame for smooth performance in advanced animations.
- Morphing Performance:
  - Capture scene measurements efficiently to avoid layout thrashing.
  - Use transform3d for hardware-accelerated morphing effects.
  - Coordinate multiple animation timelines for optimal performance.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common styling issues and resolutions:
- Dark Mode Not Applying:
  - Ensure the color-mode module is configured with classSuffix disabled so .dark is applied to the root.
  - Verify that components use dark: variants correctly.
- Font Loading Issues:
  - Confirm fonts are declared in the theme token and body styles.
  - Use font-display strategies if needed to prevent invisible text during load.
- Scrollbar Visibility:
  - Use provided utility classes or custom rules to suppress scrollbars where appropriate.
- Select Dropdown Animation Issues:
  - If dropdown animations appear abrupt, verify keyframes and transform origins as defined in main.css.
  - Check that Nuxt UI select components have proper data-slot attributes for morphing effects.
  - Ensure custom easing curves are compatible with target browsers.
- Morphing Animation Problems:
  - For SearchDock morphing, verify that launcher elements are properly measured before animation.
  - Check that transform origins are correctly set for panel unfold effects.
  - Ensure proper cleanup of animation timers and event listeners.
- Browser Compatibility:
  - View transitions and some modern features may not be supported in all browsers; provide graceful fallbacks.
  - Test on iOS Safari and Android Chrome for touch interactions and scroll behaviors.
  - Verify cubic-bezier easing functions work correctly across different browsers.
- Performance Issues:
  - Monitor memory usage during complex morphing animations.
  - Check for layout thrashing in measurement-heavy animation sequences.
  - Ensure proper cleanup of animation resources to prevent memory leaks.

**Section sources**
- [nuxt.config.ts:32-36](file://nuxt.config.ts#L32-L36)
- [main.css:8-37](file://app/assets/css/main.css#L8-L37)
- [main.css:39-49](file://app/assets/css/main.css#L39-L49)
- [main.css:51-105](file://app/assets/css/main.css#L51-L105)
- [SearchDock.vue:161-191](file://app/components/SearchDock.vue#L161-L191)

## Conclusion
This project adopts a clean, utility-first styling approach with Tailwind CSS v4, enhanced by Nuxt UI and the color-mode module. The global stylesheet centralizes theme tokens and base styles, while components implement responsive layouts and dark mode variants consistently. The ColorModeToggle component provides an accessible way to switch themes. The enhanced animation system with sophisticated morphing effects and panel unfold animations significantly improves user experience through smooth, natural interactions. By leveraging Tailwind's responsive utilities, advanced CSS animations, and keeping custom CSS minimal, the application maintains design consistency, performance, and accessibility across devices and browsers.

[No sources needed since this section summarizes without analyzing specific files]