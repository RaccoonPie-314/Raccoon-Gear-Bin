---
kind: business_term
name: Business Glossary
category: business_term
scope:
    - '**'
---

### Raccoon Gear Bin
- Definition：The project's product name (also the package name). It is a Nuxt-based catalog site for gear/products with an admin area protected by Supabase Auth and an `admin_users` table.
- Aliases：Raccoon-Gear-Bin

### admin_users
- Definition：Internal table storing authorized administrators. A row links a Supabase Auth user id to an admin account; presence grants access to `/admin/*`, and a `role` column distinguishes `super_admin` from ordinary admins.
