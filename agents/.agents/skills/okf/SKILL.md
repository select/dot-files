---
name: okf
description: "Guide for writing Open Knowledge Format (OKF) v0.1 documents. Use this skill when: 'write okf' 'okf document' 'knowledge bundle' 'okf spec' 'create concept'"
---

# Purpose

This skill guides the creation, modification, and validation of individual Open Knowledge Format (OKF) v0.1 concept documents.

## Decision Tree

- **IF** the user is asking about the OKF bundle structure, directory organization, reserved files (`index.md`, `log.md`), or bundle management:
  - **THEN**: Read and reference [resource/bundle.md](resource/bundle.md).
- **IF** the user is asking to create, edit, or understand an individual OKF concept document:
  - **THEN**: Follow the instructions below.

## Instructions

### 1. Concept Document Format
Each OKF concept is a UTF-8 `.md` file consisting of:
1. **YAML Frontmatter** (delimited by `---` on its own line at the start and end).
2. **Markdown Body** containing structured markdown.

#### Frontmatter Fields
- `type` (**REQUIRED**): A short string describing the category of the concept (e.g., `BigQuery Table`, `API Endpoint`, `Metric`, `Playbook`, `Reference`).
- `title` (Recommended): Human-readable display name.
- `description` (Recommended): A single-sentence summary.
- `resource` (Recommended): Canonical URI identifying the underlying asset (if applicable).
- `tags` (Recommended): YAML array of cross-cutting categorization strings.
- `timestamp` (Recommended): ISO 8601 datetime of the last meaningful change.

#### Body Conventions
Producers should favor structural markdown (headings, lists, tables, fenced code blocks). Conventional headings can include, but are not limited to:
- `# Schema` — Column/field definitions.
- `# Examples` — Code/usage examples.
- `# Citations` — External source material links.

### 2. Cross-linking Semantics
All links between concepts must use standard Markdown link syntax `[Label](path)`. Two path forms are supported:
- **Absolute (bundle-relative)** (RECOMMENDED): Starts with `/` relative to the bundle root, e.g., `[Customers](/tables/customers.md)`. This remains stable if the current document is moved.
- **Relative**: Uses standard relative paths, e.g., `[Neighbor](./other.md)` or `[Parent](../parent.md)`.
- Broken links are tolerated by consumers and do not violate conformance.

### 3. Conformance
An individual concept document is conformant if:
1. It contains a parseable YAML frontmatter block.
2. The frontmatter block contains a non-empty `type` field.

---

## Workflow

> Execute the following steps in order, top to bottom:

1. **Check Scope**: Determine if the user is asking about the bundle layout. If so, refer to [resource/bundle.md](resource/bundle.md).
2. **Determine File Path**: Choose a location for the concept document within the bundle (e.g., `tables/orders.md`).
3. **Write Frontmatter**: Ensure the YAML frontmatter includes `type` and recommended fields (`title`, `description`, etc.).
4. **Author Body**: Write structured, clear markdown using standard headers (e.g., `# Schema`, `# Examples`).
5. **Cross-link**: Link to other concepts using bundle-relative paths (e.g., `[customers](/tables/customers.md)`).

---

## Cookbook

### Concept File Example

```markdown
---
type: BigQuery Table
title: Users Table
description: Store details for all registered users.
resource: https://console.cloud.google.com/bigquery?p=acme&d=core&t=users
tags: [core, users]
timestamp: 2026-06-25T12:00:00Z
---

# Schema

| Column    | Type   | Description |
|-----------|--------|-------------|
| `user_id` | STRING | Unique user identifier. |
| `email`   | STRING | User's primary email address. |

# Examples
...

# Citations

...
```
