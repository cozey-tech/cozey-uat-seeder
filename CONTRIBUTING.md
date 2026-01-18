# Contributing Guide

**Last Updated:** 2025-01-17

## Purpose

This guide outlines how to contribute to the Cozey UAT Seeder project. It covers branch naming, commit conventions, local development setup, and PR requirements.

## Branch Naming Conventions

Use the following branch naming patterns:

- `feat/<description>` - New features
- `fix/<description>` - Bug fixes
- `chore/<description>` - Maintenance tasks, refactoring, documentation
- `docs/<description>` - Documentation-only changes
- `test/<description>` - Test-related changes

**Examples:**
- `feat/add-retry-logic`
- `fix/shopify-rate-limiting`
- `chore/update-dependencies`
- `docs/add-runbook`

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

<body (optional)>

<footer (optional)>
```

### Commit Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Test additions or changes
- `chore`: Maintenance tasks, dependency updates
- `perf`: Performance improvements

### Examples

```
feat(shopify): add retry logic for API calls

fix(repository): handle Prisma P2002 errors correctly

docs: add data model documentation

chore: update dependencies to latest versions
```

### Commit Message Guidelines

- Use present tense ("add" not "added")
- Use imperative mood ("fix bug" not "fixes bug")
- Keep subject line under 72 characters
- Capitalize first letter of subject
- No period at end of subject line
- Reference issue/PR numbers in footer if applicable

## Local Development Setup

### Prerequisites

- **Node.js 20.13.0** (use nvm - see below)
- **PostgreSQL** access to staging database
- **Shopify** staging store with Admin API access
- **Git** for version control

### Node Version Management

This project requires Node.js 20.13.0. Use [nvm](https://github.com/nvm-sh/nvm) to manage versions:

```bash
# Install nvm (if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node 20.13.0
nvm install 20.13.0
nvm use

# Or set as default
nvm alias default 20.13.0
```

The project includes an `.nvmrc` file, so running `nvm use` in the project directory will automatically switch to the correct version.

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/cozey-tech/cozey-uat-seeder.git
   cd cozey-uat-seeder
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your staging credentials
   ```

4. **Generate Prisma Client:**
   ```bash
   npm run prisma:generate
   ```

5. **Verify setup:**
   ```bash
   npm run typecheck
   npm run lint
   npm run test
   ```

### Required Environment Variables

See `.env.example` for all required variables. Minimum required:

- `DATABASE_URL` - PostgreSQL connection string (staging only)
- `SHOPIFY_STORE_DOMAIN` - Shopify store domain (staging only)
- `SHOPIFY_ACCESS_TOKEN` - Shopify Admin API access token

**Important:** Never commit `.env` files. They are gitignored.

## Development Workflow

### Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes:**
   - Follow coding conventions (see [AGENTS.md](AGENTS.md))
   - Write tests for new functionality
   - Update documentation if needed

3. **Run quality checks:**
   ```bash
   npm run typecheck  # Type checking
   npm run lint       # Linting
   npm run test       # Tests
   npm run format     # Format code (if needed)
   ```

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: your feature description"
   ```

5. **Push and create PR:**
   ```bash
   git push origin feat/your-feature-name
   # Create PR on GitHub
   ```

### Code Quality Requirements

Before submitting a PR, ensure:

- [ ] All tests pass (`npm run test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Linting passes (`npm run lint`)
- [ ] Code is formatted (`npm run format`)
- [ ] No secrets or sensitive data in code
- [ ] Documentation updated if needed
- [ ] Commit messages follow Conventional Commits

### Testing Requirements

- **Unit tests:** Required for new business logic
- **Integration tests:** Required for new workflows
- **Test coverage:** Maintain or improve coverage thresholds
  - Current thresholds: 50% lines, 60% functions, 40% branches, 50% statements
  - Run `npm run test:coverage` to check

### Pull Request Process

1. **Create PR from feature branch to `main`**
2. **PR Title:** Follow Conventional Commits format
3. **PR Description:** Include:
   - Summary of changes
   - Why the change is needed
   - How to test
   - Any breaking changes
   - Related issues/PRs

4. **Wait for review:**
   - Address review feedback
   - Update PR as needed
   - Ensure CI checks pass

5. **Merge:**
   - Squash and merge (preferred) or merge commit
   - Delete feature branch after merge

## Coding Conventions

See [AGENTS.md](AGENTS.md) for detailed coding conventions. Key points:

- **TypeScript:** Use TypeScript for all code
- **Validation:** Use Zod for runtime validation
- **Error Handling:** Use typed error classes
- **Naming:** Clear, descriptive names
- **Enums:** Use enums for string comparisons
- **Functions:** Keep small and single-purpose
- **Async:** Use `for...of` or `Promise.all`, not `forEach` with async

## Project Structure

```
src/
├── business/          # Business logic (handlers, use cases)
├── config/            # Configuration (env, staging guardrails)
├── repositories/      # Data access layer (Prisma)
├── services/          # External integrations (Shopify, WMS)
├── shared/            # Shared types, enums, validation
├── utils/             # Utilities (file reader, logger)
└── cli.ts             # CLI entry point
```

## Documentation

When adding new features:

- Update relevant documentation files
- Add examples if applicable
- Update README.md if user-facing changes
- Update AGENTS.md if conventions change
- Add to runbook if operational changes

## Staging Safety

**Critical:** This tool is staging-only. All changes must:

- Maintain staging guardrails
- Never remove or weaken safety checks
- Test in staging before any production consideration
- Document any new safety requirements

## Getting Help

- Check [README.md](README.md) for usage
- Check [AGENTS.md](AGENTS.md) for conventions
- Check [docs/](docs/) for architecture and design docs
- Ask questions in PR comments or team channels

## Related Documentation

- [README.md](README.md) - Quickstart and usage
- [AGENTS.md](AGENTS.md) - Engineering conventions and agent instructions
- [docs/architecture.md](docs/architecture.md) - System architecture
- [docs/runbook.md](docs/runbook.md) - Operations and troubleshooting
