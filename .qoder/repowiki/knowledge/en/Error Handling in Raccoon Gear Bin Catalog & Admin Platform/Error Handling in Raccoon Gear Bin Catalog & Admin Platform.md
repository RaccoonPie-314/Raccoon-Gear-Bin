---
kind: error_handling
name: Error Handling in Raccoon Gear Bin Catalog & Admin Platform
category: error_handling
scope:
    - '**'
source_files:
    - app/composables/useCatalog.ts
    - app/composables/useAdminAuth.ts
    - app/middleware/admin-auth.global.ts
    - server/utils/supabase.ts
    - app/pages/admin/login.vue
    - app/pages/index.vue
    - app/pages/products/[id].vue
---

## Overview

This Nuxt 3 + Supabase application uses a lightweight, convention-driven error handling strategy with no dedicated error types, error codes, or centralized error middleware. Errors are primarily represented as plain `Error` instances (or Supabase's `{ data, error }` result tuples), propagated by throwing them from composables and caught at the page/component layer where user-facing messages are rendered.

## Key Patterns Observed

### 1. Composables propagate errors upward via `throw`

- `app/composables/useCatalog.ts`: Every data-fetching function (`fetchProducts`, `fetchProduct`, `fetchCategories`) destructures `{ data, error }` from the Supabase client call and re-throws the error: `if (error) throw error`. This pushes network/RLS failures to the caller.
- `app/composables/useAdminAuth.ts`: `signIn` and `signOut` follow the same pattern — if Supabase auth returns an error, it is re-thrown so callers can catch and display it.

### 2. Pages/components catch and render user-facing messages

- `app/pages/admin/login.vue`: Wraps `useAdminAuth().signIn(...)` in `try/catch`; on failure, sets a reactive `actionError` state that is displayed to the user. Also throws a localized `Error(t('invalidLogin'))` for invalid credentials before calling Supabase.
- `app/pages/index.vue` (admin product editor): Each mutation (`saveProduct`, `deleteProduct`) wraps its async operation in `try/catch`, assigns `error?.message || t('productSaveError')` / `t('productDeleteError')` to a local `actionError` reactive, and resets `isSaving` in `finally` blocks. Validation errors are thrown as `new Error(t('requiredCategory'))`.
- `app/pages/products/[id].vue`: Catches errors from `useCatalog().fetchProduct(id)` and surfaces them.

### 3. Middleware handles authorization errors by redirecting

- `app/middleware/admin-auth.global.ts`: For `/admin/*` routes, it checks the current user and queries `admin_users`. If the query returns an error, it logs `console.error('Admin authorization lookup failed:', error)` and redirects to `/admin/login` via `navigateTo('/admin/login', { replace: true })`. If no admin record is found, it also redirects. There is no error type distinction between "network error" and "not authorized" — both result in the same redirect.

### 4. Server-side configuration validation throws early

- `server/utils/supabase.ts`: `createSupabaseAdminClient()` validates runtime config (`supabaseUrl`, `supabaseServiceRoleKey`) and throws `new Error('Missing Supabase service configuration')` if either is missing. This is the only server-side error path visible in the repo.

### 5. No custom error classes or error codes

There is no `errors/` directory, no sentinel error constants, no HTTP status-to-error mapping, and no global error handler plugin. All errors are plain JavaScript `Error` objects with string messages, often localized via `t()` from `@nuxtjs/i18n`.

### 6. Supabase client error shape is assumed everywhere

The codebase consistently assumes Supabase calls return `{ data, error }` tuples (not throwing exceptions). The composables unwrap these and either pass `data` through or re-throw `error`. This is a contract enforced by the Supabase JS SDK, not by any local wrapper.

## Conventions and Constraints

- **Composables throw, pages catch**: Data-layer functions (`useCatalog`, `useAdminAuth`) do not swallow errors — they re-throw them. Presentation layers (`pages/*.vue`) are responsible for catching and translating errors into UI feedback. This is the dominant pattern across all composables and pages.
- **Localized error messages**: User-facing error strings go through `t('...')` (e.g. `t('invalidLogin')`, `t('requiredCategory')`, `t('productSaveError')`, `t('productDeleteError')`), defined in the i18n locale files.
- **Authorization failures redirect silently**: In `admin-auth.global.ts`, both DB query errors and missing admin records lead to a redirect to `/admin/login` rather than surfacing an error to the user. Only the DB error is logged via `console.error`.
- **No global error boundary**: There is no Nuxt `error.vue` override or global error interceptor configured in `nuxt.config.ts` or `app.vue` for this concern; each page handles its own errors locally.
- **Server config errors fail fast**: Missing Supabase env vars cause an immediate `throw new Error(...)` during server startup, which will surface as a 500 response from Nuxt's dev server.

## Notable Gaps

- Network vs. business logic errors are not distinguished (no error codes or typed error classes).
- The `useCatalog.publicImageUrl` method accesses `.data.publicUrl` without checking for null/error, which could throw if the storage URL request fails.
- No structured logging framework is used beyond `console.error` in middleware/auth checks.