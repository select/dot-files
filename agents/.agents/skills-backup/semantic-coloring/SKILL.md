---
name: semantic-coloring
description: Guide for using and migrating to the semantic color system. Use this skill when migrating components from hardcoded colors, creating new styled components, reviewing color consistency, or updating theme-related code.
---

# Purpose

This skill provides guidelines for using and migrating to the semantic color system defined in `uno.config.ts`. The system follows a three-tier hierarchy: Brand Colors → Semantic Tokens → Utility Classes.

## Variables

MIGRATION_PROGRESS_DOC: docs/semantic-color-migration.md
COLOR_CONFIG: uno.config.ts
EXAMPLE_FILE: app/pages/index.vue

## Instructions

### Color System Architecture

The semantic color system is defined in `uno.config.ts`:

```
Brand Colors (petrol, teal, fog, etc.)
    └── Semantic Tokens (primary, accent, surface, etc.)
        └── Utility Classes (bg-primary, text-accent-foreground, etc.)
```

### Available Semantic Colors

**Core Colors:**

- `background` (#E0E0E0) - Page/app background → `bg-background`
- `surface` (#E9ECEC/fog) - Cards, panels → `bg-surface`
- `text` (#000000) - Primary body text → `text-text`
- `text-muted` (rgba(0,0,0,0.6)) - Secondary text → `text-text-muted`
- `primary` (#21484D/petrol) - Main brand color → `bg-primary`, `text-primary`
- `primary-foreground` (#FFFFFF) - Text on primary → `text-primary-foreground`
- `secondary` (#5b567d/comet) - Supporting actions → `bg-secondary`, `text-secondary`
- `secondary-foreground` (#FFFFFF) - Text on secondary → `text-secondary-foreground`
- `accent` (#3AC5D4/teal) - Highlights, CTA → `bg-accent`, `text-accent`
- `accent-foreground` (#21484D/petrol) - Text on accent → `text-accent-foreground`
- `border` (rgba(0,0,0,.12)) - Dividers → `b-border`, `border-border`
- `focus` (#3AC5D4/teal) - Focus rings → `ring-focus`
- `selection` (rgba(58,197,212,0.3)) - Selected content → `bg-selection`

**State Colors:**

- `success` / `success-foreground` - Positive actions → `bg-success`, `text-success-foreground`
- `warning` / `warning-foreground` - Caution alerts → `bg-warning`, `text-warning-foreground`
- `error` / `error-foreground` - Errors, danger → `bg-error`, `text-error-foreground`
- `info` / `info-foreground` - Informational → `bg-info`, `text-info-foreground`

### Migration Mapping Table

| Old Pattern                                  | New Pattern       | Context               |
| -------------------------------------------- | ----------------- | --------------------- |
| `text-gray-5`, `text-gray-800`, `text-black` | `text-text`       | Body text             |
| `text-gray-4`, `text-gray-6`                 | `text-text-muted` | Secondary text        |
| `text-petrol` (not headings)                 | `text-primary`    | Brand color text      |
| `bg-white`, `bg-fog`                         | `bg-surface`      | Cards, panels         |
| `bg-background`, `bg-gray-1`                 | `bg-background`   | Page background       |
| `bg-teal`                                    | `bg-accent`       | Accent backgrounds    |
| `bg-petrol`                                  | `bg-primary`      | Primary backgrounds   |
| `bg-comet`                                   | `bg-secondary`    | Secondary backgrounds |
| `b-gray-3`, `b-gray-4`, `border-gray-3`      | `b-border`        | Borders               |
| `text-success`, `text-green-500`             | `text-success`    | Success state         |
| `text-error`, `text-red-500`                 | `text-error`      | Error state           |
| `text-warning`, `text-yellow-500`            | `text-warning`    | Warning state         |
| `text-info`, `text-blue-500`                 | `text-info`       | Info state            |

### General CSS/Tailwind/Uno Guidelines

- **Pill Shapes over Slightly Rounded Corners:** Always prefer pill shapes (`rounded-full`) over standard slightly rounded edges for buttons, badges, chips, single-line input field containers (text/select), progress bars, toggle switch tracks/knobs, and other compact interactive/static components.
- **Card Border Radius:** Cards and large structurally prominent panels must have a border radius of `rounded-3xl` (`rounded-24px`).
- **Intermediate Containers:** Multi-line textareas, sidebars, and larger details pages use `rounded-2xl` where perfect pill shapes are structurally impossible.
- **Minor Containers:** Small utility overlays like tooltips use `rounded-lg` with contextual compact sizing.
- **Interactive States & Transitions:** Standardize transitions for interactive hover and focus actions using `transition-colors duration-150` or `transition-all duration-200`.

## Workflow

> Execute the following steps in order, top to bottom:

1. **Check migration progress**: Read `docs/semantic-color-migration.md` to see what's been migrated
2. **Identify hardcoded colors**: Look for `text-petrol`, `bg-teal`, `text-gray-5`, hex colors, opacity modifiers
3. **Map to semantic tokens**: Use the mapping table above
4. **Apply foreground pairs**: Always pair colored backgrounds with foreground colors (e.g., `bg-primary text-primary-foreground`)
5. **Handle special cases**: Borders, opacity variants, focus states
6. **Test visually**: Ensure colors look correct
7. **Update progress doc**: Mark the file as completed in `docs/semantic-color-migration.md`

## Cookbook

### Buttons

BAD

```vue
<button class="bg-petrol text-white">Submit</button>
<button class="bg-teal text-black">Cancel</button>
```

GOOD

```vue
<button class="bg-primary text-primary-foreground">Submit</button>
<button class="bg-accent text-accent-foreground">Cancel</button>
```

### Cards

BAD

```vue
<div class="b-1 b-solid b-gray-3 b-opacity-40 bg-white">
  <h3 class="text-petrol">Title</h3>
  <p class="text-gray-5">Body text</p>
</div>
```

GOOD

```vue
<div class="bg-surface b-1 b-solid b-border">
  <h3 class="text-primary">Title</h3>
  <p class="text-text">Body text</p>
</div>
```

### Alerts

BAD

```vue
<div class="bg-green-500 text-white">Success!</div>
<div class="bg-red-500 text-white">Error!</div>
```

GOOD

```vue
<div class="bg-success text-success-foreground">Success!</div>
<div class="bg-error text-error-foreground">Error!</div>
```

### Tables

BAD

```vue
<table class="bg-white">
  <thead class="bg-teal text-petrol">
    <tr><th>Column</th></tr>
  </thead>
  <tbody>
    <tr class="b-t-1 b-solid b-gray-3 b-opacity-30 text-gray-5">
      <td class="text-gray-800">Data</td>
    </tr>
  </tbody>
</table>
```

GOOD

```vue
<table class="bg-surface">
  <thead class="bg-accent text-accent-foreground">
    <tr><th>Column</th></tr>
  </thead>
  <tbody>
    <tr class="b-t-1 b-solid b-border text-text-muted">
      <td class="text-text">Data</td>
    </tr>
  </tbody>
</table>
```

### Borders

BAD

```vue
<div class="b-1 b-solid b-gray-3 b-opacity-40">Content</div>
```

GOOD

```vue
<div class="b-1 b-solid b-border">Content</div>
```

### Focus States

BAD

```vue
<input class="ring-teal focus:ring-2" />
```

GOOD

```vue
<input class="ring-focus focus:ring-2" />
```

### Opacity Variants

BAD

```vue
<div class="bg-teal bg-opacity-10">Light background</div>
```

GOOD

```vue
<div class="bg-accent bg-opacity-10">Light background</div>
```

- IF: You're creating a new component
- THEN: Use semantic tokens from the start, never hardcoded colors
- EXAMPLES:
  - Button: `bg-primary text-primary-foreground`
  - Card: `bg-surface b-border`
  - Alert: `bg-success text-success-foreground`

- IF: You're migrating an existing component
- THEN: Follow the workflow above and update the progress doc
- EXAMPLES:
  - See `app/pages/index.vue` for a fully migrated example
  - Check `docs/semantic-color-migration.md` for completed files

- IF: A colored background is used for interactive elements
- THEN: Always pair with the foreground color for proper contrast
- EXAMPLES:
  - `bg-primary` → `bg-primary text-primary-foreground`
  - `bg-accent` → `bg-accent text-accent-foreground`
  - `bg-error` → `bg-error text-error-foreground`

- IF: You need to show status or state
- THEN: Use state colors (success, warning, error, info)
- EXAMPLES:
  - Success message: `bg-success text-success-foreground`
  - Error alert: `bg-error text-error-foreground`
  - Warning banner: `bg-warning text-warning-foreground`
