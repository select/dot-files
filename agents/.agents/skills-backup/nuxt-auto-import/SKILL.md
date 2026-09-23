---
name: nuxt-auto-import
description: Guide for checking and fixing Nuxt 4 auto-import usage. Use this when reviewing impors in Vue components, composables, or TypeScript files in a Nuxt 4 project.
disable-model-invocation: true
---

**Auto-imported** = No `import` statement needed. Use directly.

**Fix type errors**: Run `nuxt prepare` to rebuild auto-import list.

**Import path**: Use `~` prefix in `/app` (e.g., `~/types/index`)

## ✅ Auto-Imported (No import needed)

- `app/components/*.vue` - All components
- `app/composables/*.ts` - All composables
- `app/stores/*.ts` - All stores
- `app/utils/*.ts` - Root level only (nested files need imports)

## ❌ NOT Auto-Imported (Require import)

- `app/types/` - Use `import type { ... } from '~/types'`
- `app/utils/nested/` - Nested utils need imports
- `app/layouts/`, `pages/`, `plugins/`, `workers/` - All need imports

**Action**: Remove unnecessary imports for auto-imported modules.
