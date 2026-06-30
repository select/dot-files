# OKF Bundle Structure & Management

This resource describes the structure, organization, and reserved files of an Open Knowledge Format (OKF) v0.1 Knowledge Bundle.

## 1. Bundle Structure
An OKF **Knowledge Bundle** is a self-contained, hierarchical collection of knowledge documents. The directory tree is independent of the domain. To keep navigation simple and prevent cluttered structures, we avoid creating sub-directory `index.md` files; instead, we maintain a single, central `index.md` at the root of the bundle that links directly to all concepts across all subdirectories.

```
path/to/bundle/
├── index.md                      # Central index linking directly to all concepts.
├── log.md                        # Optional. Chronological history of updates.
├── <concept>.md                  # A concept at the bundle root.
└── <subdirectory>/               # Subdirectories organize concepts into groups.
    ├── <concept>.md
    └── <subdirectory>/
        └── …
```

Bundles can be distributed as:
- A git repository (recommended for history, attribution, diffs).
- A tarball or zip archive of the directory.
- A subdirectory within a larger repository.

---

## 2. Reserved Filenames
The following filenames have defined meanings at any level of the hierarchy and MUST NOT be used for concept documents:

| Filename | Purpose |
|---|---|
| `index.md` | Directory listing. No frontmatter. |
| `log.md` | Update history. No frontmatter. |

All other `.md` files are concept documents.

---

## 3. Index Files (`index.md`)
An `index.md` file resides at the root of the bundle. It lists contents to support progressive disclosure—letting users or agents browse available files before opening them.

> **CRITICAL**: Always link to files directly. Never link to a raw directory path (e.g., `[Subdir](subdir/)`). All links must point directly to actual concept `.md` files (e.g., `[Users Table](tables/users.md)`). This prevents Markdown viewers/editors like Obsidian from incorrectly creating blank new files.

- **Format**: No frontmatter. Uses one or more sections with headings.
- **Example**:
```markdown
# Tables Directory

* [Users Table](tables/users.md) - Store details for all registered users.
* [Orders Table](tables/orders.md) - One row per completed customer order.

# Playbooks

* [Incident Freshness Alert](playbooks/freshness.md) - Freshness triaging playbook.
```

---

## 4. Log Files (`log.md`)
A `log.md` file records the chronological history of changes to its directory scope.

- **Format**: No frontmatter. Flat list of date-grouped entries, newest first.
- **Example**:
```markdown
# Directory Update Log

## 2026-06-25
* **Creation**: Added [Users Table](/tables/users.md) to store core registry data.

## 2026-06-20
* **Initialization**: Setup directory structure and first datasets.
```
