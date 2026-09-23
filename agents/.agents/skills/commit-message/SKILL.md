---
name: commit-message
description: 'Guide for creating commit messages and PR comments. Use this skill when: commit, git commit, create commit, commit message, PR comment, pull request comment, code review, review comment, reply to PR feedback'
---

# Purpose

Create consistent, well-formatted commit messages using Conventional Commits and PR comments using [Conventional Comments](https://conventionalcomments.org/). Always identify agent-generated PR comments and replies with the `[agent]` prefix.

## Commit Message Instructions

Follow the Conventional Commits format with the conventions below. These rules apply to commit messages, not PR comments.

**Format**: `<type>(<scope>): <subject>`

- Max 120 characters total
- Lowercase subject, no trailing period
- Present tense, imperative mood: "add feature" not "added feature"
- scope must be a jira issue or empty

**Types**:

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, no code change
- `refactor` - Code restructuring without behavior change
- `perf` - Performance improvement
- `test` - Adding/updating tests
- `build` - Build system or dependencies
- `ci` - CI configuration
- `chore` - Maintenance tasks, dependency updates

**Scopes** (common examples):

- Jira ticket: `EN-1234` (preferred when applicable)
- No scope if we are not on a branch for an issue

**Get Jira issue ID from branch**:

```bash
git branch --show-current | grep -oE '^[A-Z]+-[0-9]+'
```

Branch names follow the pattern `XXXX-1234-description` (e.g., `EN-1234-fix-bug`), so the Jira issue ID can be extracted from the current branch name.

**Body** (optional):

- Add blank line after subject
- Explain what/why, not how
- Max 120 chars per line

**Footer**:

- Breaking changes: `BREAKING CHANGE: description`

## Commit Message Workflow

> Execute the following steps in order, top to bottom:

1. Identify the type of change (feat, fix, chore, etc.)
2. Determine scope - use Jira ticket ID if available
3. Write concise subject in imperative mood
4. Add body only if change needs explanation
5. Add footer for breaking changes

## Commit Message Cookbook

BAD

```
fix: Fixed the bug in the component.
```

GOOD

```
fix(EN-1234): use consistent confidence score labels
```

BAD

```
Updated dependencies
```

GOOD

```
chore: update dependency @types/node to v24.10.11
```

BAD

```
feat: Add new feature for users to do things
```

GOOD

```
feat(EN-1234): add analysis job storage
```

- IF: Change relates to a Jira ticket
- THEN: Use ticket ID as scope
- EXAMPLES:
  - `fix(EN-1234): watch job output paths for progress updates`
  - `feat(EN-1235): support an additional identity provider`

## PR Comment Instructions

Apply these rules to every agent-generated PR comment, including inline review comments, review summaries, and replies to existing threads.

- Always start the comment with the literal `[agent]` prefix, including short answers and acknowledgments.
- Follow the prefix with a Conventional Comments label, optional decorations in parentheses, a colon, and a concise subject.
- Use this format (omit the parentheses when there are no decorations):

```text
[agent] <label> (<decorations>): <subject>

<optional discussion>
```

**Labels**:

- `praise` - Highlight something genuinely positive.
- `nitpick` - Trivial, preference-based feedback; non-blocking.
- `suggestion` - Propose an improvement and explain why it helps.
- `issue` - Identify a concrete problem and suggest a resolution where possible.
- `todo` - Request a small but necessary change.
- `question` - Ask for clarification or investigation when uncertain.
- `thought` - Share a non-blocking idea for consideration.
- `chore` - Request a required process or housekeeping task.
- `note` - Share non-blocking information, status updates, answers, or acknowledgments.
- Optional labels: `typo` for spelling corrections, `polish` for quality improvements, and `quibble` for trivial preferences.

**Decorations** (optional, comma-separated):

- `blocking` - Must be resolved before acceptance.
- `non-blocking` - Does not prevent acceptance.
- `if-minor` - Address only if the change is minor or trivial.
- Add context such as `security`, `test`, or `ux` when helpful.
- Make blocking intent explicit when relevant; do not mark inherently non-blocking labels as blocking.

**Discussion** (optional):

- Separate supporting details from the subject with a blank line.
- Explain the concern, reasoning, and actionable next steps.
- Keep feedback constructive and specific; use `question` rather than asserting an uncertain issue.
- Use `note` for replies reporting completed work, and only claim changes or verification actually performed.

## PR Comment Examples

```text
[agent] issue (blocking): This lookup can return undefined before the property is accessed.

Please guard the result before accessing its properties to avoid a runtime error.
```

```text
[agent] suggestion (test,non-blocking): Add coverage for an empty response.

This would help catch regressions in the fallback behavior.
```

```text
[agent] question: Should this also handle archived projects?
```

```text
[agent] note: Added the guard and verified the existing tests pass.
```

```text
[agent] note: Agreed; no change needed here.
```
