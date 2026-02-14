# SeamJS — Project Rules

## Communication

- Speak Chinese with the user, keep technical terms in English (e.g. procedure, manifest, codegen)
- All file content (code, comments, docs, commit messages) must be concise declarative English
- No emoji

## Decision Making

- Discuss uncertain matters with the user before proceeding
- Enter plan mode when a single request contains more than 3 tasks

## Version Control

- Run `git commit` after each plan mode phase completes, do not push
- Commit messages: concise English describing the change

## Monorepo Structure

- The project uses monorepo layout; plan package boundaries upfront
- Each package has a single responsibility with clear boundaries

## Naming Convention

- Default: lowercase + hyphen (kebab-case) for file names, directory names, npm package names
- Rust code follows Rust convention: lowercase + underscore (snake_case)
- No uppercase-initial directory or file names unless forced by framework conventions

## Directory Structure

- `src/` uses nested layout organized by functional modules
- Nesting depth must not exceed 4 levels from `src/`
- Use directories to express module boundaries

## Comments

- Write comments, but never state the obvious
- Comments explain why, not what
- During refactoring, do not delete existing comments without first evaluating whether they remain relevant after the refactor

## Long-running Tasks

- Use tmux sessions for long-running tasks (builds, tests, server processes)
- Do not block the main terminal
