# State Management & Composables

<cite>
**Referenced Files in This Document**
- [useCatalog.ts](file://app/composables/useCatalog.ts)
- [useCatalogBrowse.ts](file://app/composables/useCatalogBrowse.ts)
- [useAdminAuth.ts](file://app/composables/useAdminAuth.ts)
- [catalog.ts](file://app/types/catalog.ts)
- [product.ts](file://app/types/product.ts)
- [database.ts](file://app/types/database.ts)
- [admin-auth.global.ts](file://app/middleware/admin-auth.global.ts)
- [supabase.ts](file://server/utils/supabase.ts)
- [index.vue](file://app/pages/index.vue)
- [login.vue](file://app/pages/admin/login.vue)
</cite>

## Update Summary
**Changes Made**
- Added comprehensive documentation for the new useCatalogBrowse composable
- Updated architecture diagrams to reflect the separation of concerns pattern
- Enhanced examples showing how useCatalog and useCatalogBrowse work together
- Updated component usage patterns to demonstrate the new state management approach

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains the state management and composable architecture in Raccoon-Gear-Bin, focusing on Vue 3 Composition API patterns used to manage product catalog data and admin authentication state. The architecture now features a clear separation of concerns between data access (useCatalog) and browsing state management (useCatalogBrowse), establishing distinct boundaries between data fetching operations and user interaction state. It details how reactive data flows from Supabase through typed composables into UI components, how TypeScript interfaces ensure type safety across the stack, and how business logic is separated from presentation layers. It also covers error handling patterns, caching strategies, and best practices for integrating with Nuxt's composable system.

## Project Structure
The project organizes reusable business logic under app/composables, strongly types data models under app/types, and uses Nuxt middleware for route-level authorization. The server-side utility provides a service-role client for privileged operations.

```mermaid
graph TB
subgraph "Client"
Pages["Pages (Vue)"]
Composables["Composables<br/>useCatalog.ts<br/>useCatalogBrowse.ts<br/>useAdminAuth.ts"]
Types["Types<br/>catalog.ts<br/>product.ts<br/>database.ts"]
end
subgraph "Server"
SupabaseUtils["Supabase Utils<br/>server/utils/supabase.ts"]
end
subgraph "Backend"
Supabase["Supabase Client"]
DB["PostgreSQL"]
end
Pages --> Composables
Composables --> Types
Composables --> SupabaseUtils
SupabaseUtils --> Supabase
Supabase --> DB
```

**Diagram sources**
- [useCatalog.ts:1-116](file://app/composables/useCatalog.ts#L1-L116)
- [useCatalogBrowse.ts:1-40](file://app/composables/useCatalogBrowse.ts#L1-L40)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)
- [product.ts:1-40](file://app/types/product.ts#L1-L40)
- [database.ts:1-164](file://app/types/database.ts#L1-L164)
- [supabase.ts:1-20](file://server/utils/supabase.ts#L1-L20)

**Section sources**
- [useCatalog.ts:1-116](file://app/composables/useCatalog.ts#L1-L116)
- [useCatalogBrowse.ts:1-40](file://app/composables/useCatalogBrowse.ts#L1-L40)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)
- [product.ts:1-40](file://app/types/product.ts#L1-L40)
- [database.ts:1-164](file://app/types/database.ts#L1-L164)
- [supabase.ts:1-20](file://server/utils/supabase.ts#L1-L20)

## Core Components
- **useCatalog**: Encapsulates product and category fetching, translation-aware mapping, and image URL resolution. Returns pure functions that components can call to fetch and transform data.
- **useCatalogBrowse**: Manages browsing state including search queries, category filtering, and sorting preferences. Provides reactive computed properties for filtered and sorted product lists without owning any data fetching logic.
- **useAdminAuth**: Encapsulates authentication state and role checks, exposing user accessors, sign-in/sign-out, and admin role checks.
- **Types**: Strongly typed interfaces for catalog entities and database rows, ensuring compile-time safety across composables and components.

Key responsibilities:
- Data fetching and transformation are isolated in useCatalog.
- User interaction state (search, filter, sort) is managed by useCatalogBrowse.
- UI components consume only high-level APIs and reactive state.
- Type contracts are defined once and reused across the app.

**Updated** Added useCatalogBrowse as a dedicated composable for managing browsing state, separating it from data access concerns.

**Section sources**
- [useCatalog.ts:1-116](file://app/composables/useCatalog.ts#L1-L116)
- [useCatalogBrowse.ts:1-40](file://app/composables/useCatalogBrowse.ts#L1-L40)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)
- [product.ts:1-40](file://app/types/product.ts#L1-L40)

## Architecture Overview
The application follows a clear separation between UI and business logic with enhanced state management:
- Pages/components call composables to perform actions and read state.
- useCatalog handles all data fetching and transformation from Supabase.
- useCatalogBrowse manages user interaction state (search, filters, sorting) independently of data source.
- useAdminAuth centralizes authentication and authorization logic.
- Middleware enforces route-level authorization using Supabase auth and admin roles.
- Server utilities provide a service-role client for privileged operations when needed.

```mermaid
sequenceDiagram
participant Page as "Page/Component"
participant Catalog as "useCatalog"
participant Browse as "useCatalogBrowse"
participant Auth as "useAdminAuth"
participant MW as "Route Middleware"
participant SB as "Supabase Client"
participant DB as "Database"
Page->>Catalog : fetchCatalog()
Catalog->>SB : select products + translations + images
SB-->>Catalog : rows
Catalog-->>Page : mapped CatalogProduct[]
Page->>Browse : initialize with products
Browse->>Browse : compute filteredProducts
Page->>MW : navigate to /admin/*
MW->>SB : check admin_users by user_id
SB-->>MW : role record or null
MW-->>Page : allow or redirect to login
Page->>Auth : signIn(email, password)
Auth->>SB : auth.signInWithPassword
SB-->>Auth : session/user
Auth-->>Page : { user }
```

**Updated** Added useCatalogBrowse to the sequence diagram to show its role in the data flow.

**Diagram sources**
- [useCatalog.ts:90-112](file://app/composables/useCatalog.ts#L90-L112)
- [useCatalogBrowse.ts:13-38](file://app/composables/useCatalogBrowse.ts#L13-L38)
- [useAdminAuth.ts:56-69](file://app/composables/useAdminAuth.ts#L56-L69)
- [admin-auth.global.ts:1-27](file://app/middleware/admin-auth.global.ts#L1-L27)

## Detailed Component Analysis

### Composable: useCatalog
Responsibilities:
- Fetch published products and categories from Supabase.
- Map database rows to typed domain models (CatalogProduct, CatalogCategory).
- Resolve public image URLs from storage paths.
- Provide locale-aware content selection for translations.
- Handle specification parsing and formatting for editor functionality.

Data flow:
- Database rows include related translations and images.
- Mapping selects the current locale first, then falls back to English, then to the first available translation.
- Images are sorted by sort_order and transformed to include public URLs.

Error handling:
- Errors from Supabase queries are thrown to callers, enabling UI to catch and display errors.

Caching strategy:
- No in-memory cache is implemented; each call performs a fresh query.
- For performance, consider adding a lightweight cache layer keyed by locale and filters.

Type safety:
- Uses Database type for typed queries.
- Returns CatalogProduct and CatalogCategory interfaces.

```mermaid
flowchart TD
Start(["Call fetchCatalog"]) --> Query["Query Supabase<br/>products + relations"]
Query --> Rows{"Rows received?"}
Rows --> |No| ReturnEmpty["Return empty arrays"]
Rows --> |Yes| Map["Map rows to CatalogProduct"]
Map --> LocaleSelect["Select translation by locale<br/>fallback to 'en'"]
LocaleSelect --> Images["Sort images by sort_order<br/>resolve public URLs"]
Images --> Result["Return { products, categories }"]
```

**Updated** Enhanced the flow diagram to show the complete fetchCatalog workflow.

**Diagram sources**
- [useCatalog.ts:90-112](file://app/composables/useCatalog.ts#L90-L112)
- [useCatalog.ts:42-63](file://app/composables/useCatalog.ts#L42-L63)

**Section sources**
- [useCatalog.ts:1-116](file://app/composables/useCatalog.ts#L1-L116)

### Composable: useCatalogBrowse
Responsibilities:
- Manage browsing state including search queries, category filters, and sort preferences.
- Provide reactive computed properties for filtered and sorted product lists.
- Handle multiple matching strategies for category selection (by ID, slug, or name).
- Support various sorting options (newest, price-low, price-high, name).

State management:
- search: Reactive string for search queries.
- selectedCategory: Reactive string for category filtering.
- sortOrder: Reactive enum for sorting preferences.
- filteredProducts: Computed property that derives the final product list based on all filters and sorting.

Filtering logic:
- Category matching supports multiple formats (ID, slug, or case-insensitive name).
- Search matching covers product names, SKUs, and short descriptions.
- Sorting maintains server-side ordering for 'newest' while applying client-side sorts for other options.

Integration pattern:
- Takes a source array of CatalogProduct as input via MaybeRefOrGetter.
- Returns reactive state and computed properties for UI consumption.
- No data fetching or DOM manipulation - purely state management.

```mermaid
flowchart TD
Input["Source Products"] --> Filter["Apply Filters<br/>category + search"]
Filter --> Sort["Apply Sorting<br/>price/name/newest"]
Sort --> Output["Filtered Products"]
State["User Input<br/>search/category/sort"] --> Filter
State --> Sort
```

**New Section** Documentation for the new useCatalogBrowse composable that manages browsing state separately from data access.

**Diagram sources**
- [useCatalogBrowse.ts:18-36](file://app/composables/useCatalogBrowse.ts#L18-L36)

**Section sources**
- [useCatalogBrowse.ts:1-40](file://app/composables/useCatalogBrowse.ts#L1-L40)

### Composable: useAdminAuth
Responsibilities:
- Expose reactive user state via Supabase.
- Provide role checks (isAdmin, isSuperAdmin) by querying admin_users.
- Handle sign-in and sign-out flows.

Reactive state:
- user is a reactive ref provided by Supabase integration.
- Role checks are async functions that return booleans based on database records.

Error handling:
- Authentication errors are thrown to callers.
- Role lookup errors are logged and treated as unauthorized.

Integration points:
- Used by pages for sign-in flows and by the global middleware for route protection.

```mermaid
sequenceDiagram
participant UI as "UI Component"
participant Auth as "useAdminAuth"
participant SB as "Supabase Auth"
participant DB as "admin_users"
UI->>Auth : isAdmin()
Auth->>SB : getUser()
SB-->>Auth : user or null
Auth->>DB : select role where user_id = id
DB-->>Auth : role or null
Auth-->>UI : boolean
UI->>Auth : signIn(email, password)
Auth->>SB : signInWithPassword
SB-->>Auth : session/user
Auth-->>UI : { user }
```

**Section sources**
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)

### Route Middleware: admin-auth.global
Purpose:
- Protects /admin routes by checking if the current user exists and has an admin record.
- Redirects unauthorized users to /admin/login.

Flow:
- Skips guard for non-admin routes and the login page itself.
- Reads the current user from Supabase.
- Queries admin_users to verify authorization.
- Redirects if missing or on error.

```mermaid
flowchart TD
Enter(["Middleware Entry"]) --> CheckPath{"Path starts with '/admin'?"}
CheckPath --> |No| Allow["Allow navigation"]
CheckPath --> |Yes| IsLogin{"Is path '/admin/login'?"}
IsLogin --> |Yes| Allow
IsLogin --> |No| HasUser{"Has user.id?"}
HasUser --> |No| Redirect["Redirect to /admin/login"]
HasUser --> |Yes| CheckRole["Query admin_users by user_id"]
CheckRole --> RoleFound{"Record found?"}
RoleFound --> |No| Redirect
RoleFound --> |Yes| Allow
```

**Section sources**
- [admin-auth.global.ts:1-27](file://app/middleware/admin-auth.global.ts#L1-L27)

### Server Utility: createSupabaseAdminClient
Purpose:
- Creates a Supabase client with service-role privileges for server-side operations.
- Validates runtime configuration and disables session persistence and token refresh.

Usage:
- Intended for server-only code paths requiring elevated permissions.

**Section sources**
- [supabase.ts:1-20](file://server/utils/supabase.ts#L1-L20)

### Type System
- catalog.ts defines domain-facing types: CatalogImage, CatalogProduct, CatalogCategory.
- product.ts defines internal record shapes for product-related tables and translations.
- database.ts defines row types and the full Database schema for typed Supabase queries.

Benefits:
- Compile-time validation of queries and responses.
- Clear contracts between composables and UI components.
- Consistent naming and structure across the app.

```mermaid
classDiagram
class CatalogImage {
+string id
+string storagePath
+string altText
+string url
}
class CatalogProduct {
+string id
+string categoryId
+string categoryName
+string categorySlug
+string slug
+string sku
+number price
+string currency
+number stockQuantity
+string status
+string name
+string shortDescription
+string description
+string specifications
+CatalogImage[] images
}
class CatalogCategory {
+string id
+string name
+string slug
}
CatalogProduct --> CatalogImage : "has many"
```

**Diagram sources**
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)

**Section sources**
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)
- [product.ts:1-40](file://app/types/product.ts#L1-L40)
- [database.ts:1-164](file://app/types/database.ts#L1-L164)

### Usage in Pages and Components
- The main index page demonstrates the new architecture pattern: useCatalog for data fetching and useCatalogBrowse for browsing state management.
- The page initializes useCatalogBrowse with the products array from useCatalog, creating a clean separation between data source and user interaction state.
- The admin login page uses useAdminAuth for sign-in and validates admin rights before navigation.

Best practices demonstrated:
- Separate loading, error, and success states.
- Use try/catch around async operations.
- Keep UI concerns separate from data fetching logic by calling composables.
- **New**: Separate data access from browsing state management for better maintainability and testability.

**Updated** Enhanced examples to show the new separation pattern between useCatalog and useCatalogBrowse.

**Section sources**
- [index.vue:23-40](file://app/pages/index.vue#L23-L40)
- [login.vue:1-121](file://app/pages/admin/login.vue#L1-L121)

## Dependency Analysis
Composables depend on:
- Supabase client for data and auth.
- i18n for locale-aware content selection.
- Typed database schemas for safe queries.

Components depend on:
- Composables for business logic.
- Types for prop and state typing.

```mermaid
graph LR
Index["pages/index.vue"] --> UC["composables/useCatalog.ts"]
Index --> UCB["composables/useCatalogBrowse.ts"]
Login["pages/admin/login.vue"] --> UA["composables/useAdminAuth.ts"]
UC --> Types["types/catalog.ts"]
UC --> DBT["types/database.ts"]
UCB --> Types
UA --> DBT
MW["middleware/admin-auth.global.ts"] --> DBT
SU["server/utils/supabase.ts"] --> DBT
```

**Updated** Added useCatalogBrowse to the dependency graph showing its relationship with types and the page component.

**Diagram sources**
- [index.vue:23-40](file://app/pages/index.vue#L23-L40)
- [login.vue:1-121](file://app/pages/admin/login.vue#L1-L121)
- [useCatalog.ts:1-116](file://app/composables/useCatalog.ts#L1-L116)
- [useCatalogBrowse.ts:1-40](file://app/composables/useCatalogBrowse.ts#L1-L40)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [admin-auth.global.ts:1-27](file://app/middleware/admin-auth.global.ts#L1-L27)
- [supabase.ts:1-20](file://server/utils/supabase.ts#L1-L20)
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)
- [database.ts:1-164](file://app/types/database.ts#L1-L164)

**Section sources**
- [useCatalog.ts:1-116](file://app/composables/useCatalog.ts#L1-L116)
- [useCatalogBrowse.ts:1-40](file://app/composables/useCatalogBrowse.ts#L1-L40)
- [useAdminAuth.ts:1-79](file://app/composables/useAdminAuth.ts#L1-L79)
- [admin-auth.global.ts:1-27](file://app/middleware/admin-auth.global.ts#L1-L27)
- [supabase.ts:1-20](file://server/utils/supabase.ts#L1-L20)
- [catalog.ts:1-31](file://app/types/catalog.ts#L1-L31)
- [database.ts:1-164](file://app/types/database.ts#L1-L164)

## Performance Considerations
- Avoid redundant queries by caching results at the composable level when appropriate.
- Prefer selective field projection in Supabase queries to reduce payload size.
- Defer heavy transformations until necessary; keep mapping functions simple.
- Consider pagination for large catalogs to improve initial load times.
- Use computed properties in components to derive filtered/sorted lists without re-fetching.
- **New**: Leverage useCatalogBrowse's computed properties for efficient client-side filtering and sorting without additional network requests.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Missing environment variables for Supabase: Ensure runtime config includes supabaseUrl and serviceRoleKey; the server utility throws when missing.
- Unauthorized access to admin routes: Verify user session and admin_users record; middleware redirects to login if not authorized.
- Image URLs not resolving: Confirm storage bucket configuration and that storage_path values are valid; the composable resolves public URLs.
- Translation fallback behavior: If locale-specific translations are missing, the composable falls back to English or the first available translation.
- **New**: Browsing state not updating: Ensure useCatalogBrowse is initialized with the correct source array and that reactive updates are properly propagated.

Operational tips:
- Wrap composable calls in try/catch to surface errors to the UI.
- Log Supabase errors during development to diagnose query issues.
- Validate admin role checks both on the client and server side for security.
- **New**: When debugging filtering issues, check that category matching supports multiple formats (ID, slug, name).

**Updated** Added troubleshooting guidance for the new useCatalogBrowse composable.

**Section sources**
- [supabase.ts:1-20](file://server/utils/supabase.ts#L1-L20)
- [admin-auth.global.ts:1-27](file://app/middleware/admin-auth.global.ts#L1-L27)
- [useCatalog.ts:8-11](file://app/composables/useCatalog.ts#L8-L11)
- [useCatalog.ts:90-112](file://app/composables/useCatalog.ts#L90-L112)
- [useCatalogBrowse.ts:18-36](file://app/composables/useCatalogBrowse.ts#L18-L36)

## Conclusion
Raccoon-Gear-Bin implements a clean, type-safe composable architecture that separates business logic from UI with enhanced state management patterns. useCatalog encapsulates catalog data fetching and mapping, useCatalogBrowse manages browsing state independently of data access, and useAdminAuth centralizes authentication and authorization. The middleware ensures secure access to admin routes. Strong TypeScript definitions across catalog, product, and database schemas enforce correctness throughout the pipeline. The new separation of concerns between data access and browsing state improves maintainability, testability, and performance by keeping user interaction state separate from data source concerns. To further improve scalability, consider introducing caching, pagination, and centralized error handling within composables.

**Updated** Enhanced conclusion to highlight the benefits of the new separation pattern and improved architectural clarity.

[No sources needed since this section summarizes without analyzing specific files]