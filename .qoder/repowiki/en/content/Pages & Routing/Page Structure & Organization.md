# Page Structure & Organization

<cite>
**Referenced Files in This Document**
- [index.vue](file://app/pages/index.vue)
- [products/[id].vue](file://app/pages/products/[id].vue)
- [admin/login.vue](file://app/pages/admin/login.vue)
- [CategoryNav.vue](file://app/components/CategoryNav.vue)
- [SearchDock.vue](file://app/components/SearchDock.vue)
- [ProductCard.vue](file://app/components/ProductCard.vue)
- [CategoryDesktop.vue](file://app/components/category/CategoryDesktop.vue)
- [CategoryMobile.vue](file://app/components/category/CategoryMobile.vue)
- [app.vue](file://app/app.vue)
- [nuxt.config.ts](file://nuxt.config.ts)
- [useCatalog.ts](file://app/composables/useCatalog.ts)
- [useAdminAuth.ts](file://app/composables/useAdminAuth.ts)
- [admin-auth.global.ts](file://app/middleware/admin-auth.global.ts)
- [i18n.config.ts](file://i18n.config.ts)
</cite>

## Update Summary
**Changes Made**
- Updated catalog page section with comprehensive visual and structural rebalancing details
- Added detailed documentation for new SearchDock component with morphing search interface
- Enhanced CategoryNav component documentation with desktop and mobile variants
- Updated grid spacing and responsive design patterns
- Improved typography and masthead structure documentation
- Added advanced interaction patterns including drag-to-select functionality

## Table of Contents
1. Introduction
2. Project Structure
3. Core Components
4. Architecture Overview
5. Detailed Component Analysis
6. Dependency Analysis
7. Performance Considerations
8. Troubleshooting Guide
9. Conclusion

## Introduction
This document explains the Nuxt.js page structure and organization patterns used in the project. It covers file-based routing, directory conventions, and how pages map to routes. It focuses on:
- The main catalog landing page (index.vue) for browsing products with enhanced visual design
- The dynamic product detail page (products/[id].vue) for individual product views
- The admin login page (admin/login.vue) for administrative access
It also describes script setup patterns, template organization, styling approaches, integration with data fetching and state management, SEO considerations, and performance strategies.

## Project Structure
The application uses Nuxt's file-based routing under app/pages. Each Vue SFC maps directly to a route path:
- app/pages/index.vue → /
- app/pages/products/[id].vue → /products/:id
- app/pages/admin/login.vue → /admin/login

Global layout is minimal; app.vue renders NuxtPage, delegating rendering to matched pages. Routing configuration and modules are declared in nuxt.config.ts.

```mermaid
graph TB
A["Nuxt Router"] --> B["/ -> app/pages/index.vue"]
A --> C["/products/:id -> app/pages/products/[id].vue"]
A --> D["/admin/login -> app/pages/admin/login.vue"]
E["app/app.vue"] --> F["NuxtPage"]
F --> B
F --> C
F --> D
```

**Diagram sources**
- [app.vue:1-4](file://app/app.vue#L1-L4)
- [nuxt.config.ts:1-52](file://nuxt.config.ts#L1-L52)

**Section sources**
- [app.vue:1-4](file://app/app.vue#L1-L4)
- [nuxt.config.ts:1-52](file://nuxt.config.ts#L1-L52)

## Core Components
- Pages:
  - index.vue: Enhanced catalog landing with sophisticated masthead, unified search/sort controls, improved grid spacing, and responsive sidebar navigation
  - products/[id].vue: Dynamic product detail with image gallery, specs, and stock status
  - admin/login.vue: Admin authentication form with validation and error handling
- Advanced UI Components:
  - SearchDock.vue: Morphing search interface with animated transitions and scroll-aware behavior
  - CategoryNav.vue: Responsive category navigation with desktop and mobile variants
  - ProductCard.vue: Enhanced product cards with hover effects and admin controls
- Composables:
  - useCatalog.ts: Data fetching for products, categories, and mapping to typed models
  - useAdminAuth.ts: Authentication helpers for sign-in/sign-out and role checks
- Middleware:
  - admin-auth.global.ts: Guards /admin/* routes, redirects unauthenticated users to /admin/login
- Internationalization:
  - i18n.config.ts: Locale definitions and messages used across pages

Key responsibilities:
- Routing and navigation via Nuxt's file system
- Data fetching through Supabase client within composables or pages
- Sophisticated UI composition using advanced components with complex interactions
- Global behavior via middleware and config

**Section sources**
- [index.vue:1-468](file://app/pages/index.vue#L1-L468)
- [products/[id].vue:1-177](file://app/pages/products/[id].vue#L1-L177)
- [admin/login.vue:1-121](file://app/pages/admin/login.vue#L1-L121)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)
- [CategoryNav.vue:1-37](file://app/components/CategoryNav.vue#L1-L37)
- [ProductCard.vue:1-68](file://app/components/ProductCard.vue#L1-L68)
- [useCatalog.ts:1-61](file://app/composables/useCatalog.ts#L1-L61)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [admin-auth.global.ts:1-28](file://app/middleware/admin-auth.global.ts#L1-L28)
- [i18n.config.ts:1-14](file://i18n.config.ts#L1-L14)

## Architecture Overview
Pages integrate with Supabase via composables and utilities. Authentication is handled by Supabase Auth and enforced by middleware. Internationalization is provided by i18n. Styling uses Tailwind classes and global CSS with sophisticated animations and transitions.

```mermaid
sequenceDiagram
participant U as "User"
participant R as "Nuxt Router"
participant P as "Page (index.vue)"
participant SD as "SearchDock"
participant CN as "CategoryNav"
participant C as "useCatalog"
participant S as "Supabase Client"
participant M as "Middleware (admin-auth.global.ts)"
U->>R : Navigate to "/"
R->>P : Render index.vue
P->>C : fetchProducts()
C->>S : Query products + categories
S-->>C : Data
C-->>P : Mapped products
P->>SD : Initialize morphing search
P->>CN : Load category navigation
P-->>U : Enhanced catalog UI
U->>R : Navigate to "/admin/*"
R->>M : Run global middleware
M->>S : Check admin_users
alt Not authorized
M-->>R : Redirect to /admin/login
else Authorized
R-->>P : Render protected page
end
```

**Diagram sources**
- [index.vue:101-120](file://app/pages/index.vue#L101-L120)
- [SearchDock.vue:288-352](file://app/components/SearchDock.vue#L288-L352)
- [CategoryNav.vue:20-36](file://app/components/CategoryNav.vue#L20-L36)
- [useCatalog.ts:37-57](file://app/composables/useCatalog.ts#L37-L57)
- [admin-auth.global.ts:1-28](file://app/middleware/admin-auth.global.ts#L1-L28)

## Detailed Component Analysis

### Enhanced Landing Page: app/pages/index.vue
**Updated** The catalog page underwent comprehensive visual and structural rebalancing with sophisticated design improvements.

Responsibilities:
- Loads categories and published products concurrently with enhanced loading states
- Provides unified search/sort controls with improved UX patterns
- Implements responsive sidebar navigation with desktop and mobile variants
- Renders product grid with improved spacing and typography
- Offers admin mode: add/edit/delete products, manage images, and logout
- Sets page title via useHead with enhanced SEO

**Visual Enhancements:**
- **Masthead Restructuring**: Slim logo on left with utility controls on right, separated by hairline borders
- **Unified Controls**: Search and sort controls share consistent 44px rhythm and responsive layout
- **Improved Grid Spacing**: Enhanced gap values (gap-x-6 gap-y-10 sm:gap-x-8 sm:gap-y-12) for better visual hierarchy
- **Typography Enhancements**: Improved tracking values, font weights, and responsive text sizing
- **Responsive Design**: Mobile-first approach with sophisticated breakpoints and adaptive layouts

Data flow:
- On mount, load catalog data from Supabase with parallel queries
- Map raw records into typed models with translations based on current locale
- Compute filtered and sorted lists reactively with enhanced filtering logic
- Persist changes via Supabase and refresh catalog

SEO:
- Title set dynamically with useHead for optimal search engine optimization

Performance:
- Parallel queries for categories and products
- Local computed filtering/sorting avoids extra network calls
- Loading skeletons improve perceived performance
- Optimized image loading with lazy loading

Styling:
- Tailwind utility classes for responsive layout and dark mode support
- Sophisticated animation transitions and micro-interactions
- Consistent spacing and typography system

**Section sources**
- [index.vue:1-468](file://app/pages/index.vue#L1-L468)

#### Enhanced Layout Structure
```mermaid
flowchart TD
Masthead["Enhanced Masthead<br/>Logo + Utility Controls"] --> Heading["Refined Page Heading<br/>Eyebrow + Display Line"]
Heading --> MainLayout["Main Layout Container<br/>Sidebar + Content Area"]
MainLayout --> Sidebar["Category Navigation Sidebar<br/>Sticky Desktop + Fixed Mobile"]
MainLayout --> Content["Content Area<br/>Unified Controls + Product Grid"]
Sidebar --> CategoryNav["CategoryNav Component<br/>Desktop/Mobile Variants"]
Sidebar --> SearchDock["SearchDock Component<br/>Morphing Interface"]
Content --> Controls["Unified Search/Sort Controls<br/>Consistent 44px Rhythm"]
Content --> ProductGrid["Enhanced Product Grid<br/>Improved Spacing + Typography"]
```

**Diagram sources**
- [index.vue:192-332](file://app/pages/index.vue#L192-L332)

### Advanced Search Interface: app/components/SearchDock.vue
**New** Sophisticated morphing search interface with advanced animations and scroll-aware behavior.

Responsibilities:
- Creates morphing transition between launcher icon and full search interface
- Implements scroll-aware visibility with hysteresis for smooth user experience
- Provides both desktop and mobile launcher interfaces
- Handles keyboard navigation and accessibility features
- Manages complex animation states and timing

**Advanced Features:**
- **Morphing Animation**: Smooth transition from launcher icon to search panel with precise timing
- **Scroll Awareness**: Automatically collapses when search field scrolls off-screen
- **Backdrop Management**: Animated backdrop with blur effects and proper z-index management
- **Keyboard Navigation**: Full keyboard support with focus trapping and escape key handling
- **Touch Support**: Mobile-optimized touch interactions and gesture handling

Animation System:
- Uses cubic-bezier easing functions for natural motion curves
- Implements requestAnimationFrame for smooth 60fps animations
- Manages multiple animation states with proper cleanup
- Handles resize events and viewport changes

Accessibility:
- Proper ARIA attributes and roles for screen readers
- Focus management and keyboard navigation
- Semantic HTML structure with proper labeling

**Section sources**
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)

### Enhanced Category Navigation: app/components/CategoryNav.vue
**Updated** Responsive category navigation with sophisticated desktop and mobile implementations.

Responsibilities:
- Provides dual implementation: desktop vertical nav and mobile bottom bar
- Handles category selection with enhanced visual feedback
- Integrates with parent component for two-way data binding
- Supports both database categories and predefined category sets

**Desktop Implementation (CategoryDesktop.vue):**
- **Magnification Effects**: Mouse proximity-based scaling for interactive feel
- **Drag-to-Select**: Advanced drag gestures with velocity detection
- **Sliding Indicator**: Smooth animated selection indicator with precise positioning
- **Z-index Management**: Dynamic layering based on mouse proximity

**Mobile Implementation (CategoryMobile.vue):**
- **Fixed Bottom Bar**: Persistent navigation accessible at all times
- **Horizontal Scrolling**: Smooth scrolling with active item auto-centering
- **Touch Gestures**: Drag-to-select with momentum and bounce effects
- **Scroll Detection**: Auto-hide/show based on page scroll position

Both implementations feature:
- Consistent category data structure and selection logic
- Enhanced visual feedback with smooth transitions
- Accessibility support with proper ARIA attributes
- Responsive design principles throughout

**Section sources**
- [CategoryNav.vue:1-37](file://app/components/CategoryNav.vue#L1-L37)
- [CategoryDesktop.vue:1-611](file://app/components/category/CategoryDesktop.vue#L1-L611)
- [CategoryMobile.vue:1-577](file://app/components/category/CategoryMobile.vue#L1-L577)

### Enhanced Product Cards: app/components/ProductCard.vue
**Updated** Product cards with improved hover effects, admin controls, and responsive design.

Responsibilities:
- Displays product information with enhanced visual hierarchy
- Provides hover-triggered edit buttons for admin mode
- Implements lazy loading for product images
- Shows stock status and pricing information

**Enhanced Features:**
- **Hover Effects**: Subtle scale transforms and shadow changes on hover
- **Admin Controls**: Contextual edit buttons that appear on hover in admin mode
- **Image Handling**: Graceful fallbacks for missing images with placeholder content
- **Responsive Typography**: Adaptive text sizing across different screen sizes

**Section sources**
- [ProductCard.vue:1-68](file://app/components/ProductCard.vue#L1-L68)

### Dynamic Product Detail: app/pages/products/[id].vue
Responsibilities:
- Reads route param id
- Fetches single product via useCatalog.fetchProduct
- Parses specifications into structured label/value pairs
- Displays image gallery with thumbnails and selected image
- Shows stock status, price, description, and specs
- Sets dynamic page title

Error states:
- Loading skeleton while fetching
- Alert on load errors
- "Product not found" view when missing

SEO:
- Title includes product name and app name

Performance:
- Single targeted query for product by id
- Lightweight parsing for specs

**Section sources**
- [products/[id].vue:1-177](file://app/pages/products/[id].vue#L1-L177)

### Admin Login: app/pages/admin/login.vue
Responsibilities:
- Validates email/password inputs
- Signs in user via useAdminAuth.signIn
- Verifies admin role by querying admin_users
- Redirects to catalog on success
- Displays localized error messages
- Sets page title

Security:
- Uses Supabase Auth
- Role verification prevents unauthorized access even if auth succeeds

UX:
- Loading state during submission
- Clear error alerts

**Section sources**
- [admin/login.vue:1-121](file://app/pages/admin/login.vue#L1-L121)

### Middleware: app/middleware/admin-auth.global.ts
Behavior:
- Guards all /admin/* routes except /admin/login
- Checks authenticated user via Supabase
- Verifies admin role in admin_users table
- Redirects to /admin/login if not authorized

Integration:
- Works globally with Nuxt's middleware pipeline
- Ensures consistent protection across admin features

**Section sources**
- [admin-auth.global.ts:1-28](file://app/middleware/admin-auth.global.ts#L1-L28)

### Composables: Data and Auth
- useCatalog.ts
  - Provides fetchProducts, fetchProduct, fetchCategories
  - Maps raw Supabase results to typed models with localization-aware names
  - Builds public URLs for product images
- useAdminAuth.ts
  - Exposes getCurrentUser, isAdmin, isSuperAdmin, signIn, signOut
  - Queries admin_users to determine roles

These composables centralize logic and reduce duplication across pages.

**Section sources**
- [useCatalog.ts:1-61](file://app/composables/useCatalog.ts#L1-L61)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)

## Dependency Analysis
Pages depend on:
- Supabase client for data and auth
- i18n for localized strings
- Advanced UI components for sophisticated interactions
- Middleware for route guards

```mermaid
graph LR
Index["index.vue"] --> UC["useCatalog.ts"]
Index --> UA["useAdminAuth.ts"]
Index --> SD["SearchDock.vue"]
Index --> CN["CategoryNav.vue"]
Index --> PC["ProductCard.vue"]
Detail["products/[id].vue"] --> UC
Login["admin/login.vue"] --> UA
UA --> SB["Supabase Client"]
UC --> SB
MW["admin-auth.global.ts"] --> SB
Index --> I18N["i18n.config.ts"]
Detail --> I18N
Login --> I18N
SD --> I18N
CN --> I18N
PC --> I18N
```

**Diagram sources**
- [index.vue:1-468](file://app/pages/index.vue#L1-L468)
- [products/[id].vue:1-177](file://app/pages/products/[id].vue#L1-L177)
- [admin/login.vue:1-121](file://app/pages/admin/login.vue#L1-L121)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)
- [CategoryNav.vue:1-37](file://app/components/CategoryNav.vue#L1-L37)
- [ProductCard.vue:1-68](file://app/components/ProductCard.vue#L1-L68)
- [useCatalog.ts:1-61](file://app/composables/useCatalog.ts#L1-L61)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [admin-auth.global.ts:1-28](file://app/middleware/admin-auth.global.ts#L1-L28)
- [i18n.config.ts:1-14](file://i18n.config.ts#L1-L14)

**Section sources**
- [index.vue:1-468](file://app/pages/index.vue#L1-L468)
- [products/[id].vue:1-177](file://app/pages/products/[id].vue#L1-L177)
- [admin/login.vue:1-121](file://app/pages/admin/login.vue#L1-L121)
- [SearchDock.vue:1-628](file://app/components/SearchDock.vue#L1-L628)
- [CategoryNav.vue:1-37](file://app/components/CategoryNav.vue#L1-L37)
- [ProductCard.vue:1-68](file://app/components/ProductCard.vue#L1-L68)
- [useCatalog.ts:1-61](file://app/composables/useCatalog.ts#L1-L61)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [admin-auth.global.ts:1-28](file://app/middleware/admin-auth.global.ts#L1-L28)
- [i18n.config.ts:1-14](file://i18n.config.ts#L1-L14)

## Performance Considerations
- Parallel data loading: The landing page loads categories and products concurrently to minimize total load time.
- Client-side filtering and sorting: Reduces server round-trips by computing derived lists reactively.
- Skeleton loaders: Provide immediate feedback during async operations.
- Image handling: Public URLs are generated per storage path; consider caching strategies at CDN level.
- Route-level concerns:
  - Use head meta tags for SEO titles per page
  - Keep payloads lean by selecting only needed fields
- Middleware efficiency: Minimal checks and early redirects prevent unnecessary work.
- **Advanced Animation Performance**: 
  - Efficient animation state management with proper cleanup
  - RequestAnimationFrame usage for smooth 60fps animations
  - Optimized DOM manipulation and event handling
- **Component Optimization**:
  - Lazy loading for heavy components like SearchDock
  - Virtual scrolling considerations for large product lists
  - Debounced event handlers for scroll and resize events

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and where to inspect:
- Catalog load failures:
  - Check error state and message in the landing page; verify Supabase connectivity and permissions
  - See error handling paths in the catalog loader
- Product detail not found:
  - Ensure product exists and is published; review fetch logic and error display
- Admin login errors:
  - Validate credentials and check admin role presence in admin_users
  - Review sign-in flow and redirection logic
- Middleware redirects:
  - If stuck on /admin/login, confirm user session and admin role lookup
- **Search Dock Issues**:
  - Verify animation state cleanup and event listener removal
  - Check scroll event handling and position calculations
- **Category Navigation Problems**:
  - Ensure proper component mounting and lifecycle hooks
  - Verify touch event handling on mobile devices
  - Check responsive breakpoint behavior

Relevant locations:
- Catalog load error handling and retry
- Product detail error and not-found states
- Admin login validation and error messaging
- Middleware authorization checks
- Search dock animation and event management
- Category navigation component lifecycle

**Section sources**
- [index.vue:101-120](file://app/pages/index.vue#L101-L120)
- [products/[id].vue:10-20](file://app/pages/products/[id].vue#L10-L20)
- [admin/login.vue:15-54](file://app/pages/admin/login.vue#L15-L54)
- [admin-auth.global.ts:1-28](file://app/middleware/admin-auth.global.ts#L1-L28)
- [SearchDock.vue:429-445](file://app/components/SearchDock.vue#L429-L445)
- [CategoryDesktop.vue:379-412](file://app/components/category/CategoryDesktop.vue#L379-L412)
- [CategoryMobile.vue:343-391](file://app/components/category/CategoryMobile.vue#L343-L391)

## Conclusion
The project follows Nuxt's file-based routing with clear separation of concerns and significantly enhanced user experience:
- Pages handle presentation and orchestration with sophisticated visual design
- Advanced components provide rich interactions including morphing animations and drag gestures
- Composables encapsulate data fetching and business logic
- Middleware enforces security for admin areas
- Internationalization and styling are consistently applied with modern design principles
- Enhanced responsive design ensures optimal experience across all device types

This structure supports scalable feature growth, maintainable code, strong UX with robust error handling, performance optimizations, and sophisticated interaction patterns that elevate the user experience beyond basic functionality.