# Copilot Instructions

## Project Overview

This is a GitHub Action (`tediousjs/setup-sqlserver`) that installs SQL Server on Windows-based GitHub Action runners. It's built as a native ESM TypeScript module, bundled with [Rollup](https://rollupjs.org/), and runs on Node.js 24.

## Local Development

Use `nvm` to ensure you're running the correct Node.js version. The required version is pinned in `.nvmrc`:

```sh
nvm use
```

## Build, Test & Lint

```sh
npm run build         # rollup bundles src/ to lib/main/index.js + auto-generates README usage section from action.yml
npm run test          # mocha (using Node 24's native TypeScript type-stripping)
npm run test:coverage # tests with c8 coverage
npm run lint          # eslint across src/, misc/, test/
npm run lint:fix      # eslint with auto-fix
```

Run a single test file:

```sh
npx mocha './test/utils.ts'
```

Run a single test by name:

```sh
npx mocha './test/**/**.ts' --grep 'correctly returns for windows-2019'
```

TypeScript is executed directly by Node 24 via native type-stripping — no transpiler (no `ts-node`, no `tsx`) is needed to run `.ts` files. This is why test runs are very fast and imports use `.ts` extensions.

The build step (`npm run build`) also runs `npm run docs`, which regenerates the usage section in `README.md` from `action.yml` via `misc/generate-docs.ts`. If you change `action.yml` inputs, rebuild to keep the README in sync.

## Architecture

**Entry point:** `src/main.ts` → calls `install()` from `src/install.ts`, which orchestrates the full flow:

1. Reads action inputs via `gatherInputs()` from `src/utils.ts`
2. Validates OS compatibility using version config from `src/versions.ts`
3. Optionally installs SQL Native Client (`src/install-native-client.ts`) and ODBC driver (`src/install-odbc.ts`)
4. Downloads or cache-hits the SQL Server installer (box+exe, standalone exe, or SSEI bootstrapper)
5. Optionally downloads cumulative updates
6. Runs the installer via `@actions/exec`
7. Waits for the database to be ready (exponential backoff)

**Installer abstraction:** `src/installers/` contains a base `Installer` class and `MsiInstaller` subclass used by the native client and ODBC installations. SQL Server itself uses direct exe/box download logic or the SSEI bootstrapper (for 2025+) in `src/utils.ts`.

**Version registry:** `src/versions.ts` defines a `Map<string, VersionConfig>` with download URLs (exe/box or SSEI), optional update URLs, and OS compatibility constraints for each supported SQL Server version (2008–2025). SQL Server 2025+ uses the SSEI bootstrapper model (`sseiUrl`) instead of direct exe/box downloads.

**Build output:** Rollup (config in `rollup.config.mjs`) bundles everything into `lib/main/index.js` as a minified ESM module, which is what `action.yml` references. The `lib/` directory is committed to the repository. **Every commit must include up-to-date build output** — CI checks this by rebuilding and running `git diff-files --quiet`. Always run `npm run build` and commit the resulting changes to `lib/` and `README.md` before pushing.

**ESM module format:** The package is published as ESM (`"type": "module"` in `package.json`). Consequences for contributors:

- Relative imports must use explicit file extensions. In this codebase we use `.ts` extensions (e.g., `import { foo } from './bar.ts'`), which Node 24 resolves directly via native type-stripping, and Rollup resolves via `@rollup/plugin-typescript`. TypeScript is configured with `allowImportingTsExtensions: true` and `rewriteRelativeImportExtensions: true` so the emitted types remain valid.
- For runtime values that need to be stubbable in tests, modules export a default object (e.g., `src/utils.ts` ends with `export default { ... }`) and call-sites use `import utils from './utils.ts'; utils.foo()`. This pattern is required because **ES module named-export bindings cannot be rebound** — sinon can only mutate properties on a shared object, not rebind a module-level binding.
- The `@actions/*` packages are native ESM from v3 onwards, which means their exports are also non-configurable. `src/actions.ts` re-exports each `@actions/*` package as a plain, mutable object (`{ ...coreNs, ... }` typed back to the original module type). Both source code and tests import from `src/actions.ts` (e.g., `import { core, tc } from '../src/actions.ts'`) so sinon has a single shared object to stub.

## Conventions

- **Testing:** Mocha + Chai + Sinon, run under Node 24's native TypeScript type-stripping (no transpiler). Tests stub `@actions/*` packages and module-level dependencies using `sinon.stub()` on default-imported objects (see the "ESM module format" note above). Each test file mirrors its source file (e.g., `test/install.ts` tests `src/install.ts`).
- **Commit messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint. Semantic-release uses these to generate automated releases and changelogs, so correct commit types are critical.
  - `fix` — Bug fixes or behavioural corrections that don't change public interfaces. Triggers a **patch** release.
  - `feat` — New backwards-compatible functionality (e.g., adding a new input, method, or option without removing anything). Triggers a **minor** release.
  - `feat!` (or any type with `!`) — Breaking changes where consumers would need to update their code (removed/renamed inputs, changed default behaviour). Triggers a **major** release.
  - `chore` — Dependency updates, tooling changes, or housekeeping that doesn't affect project code. **Does not trigger a release.**
  - `ci` — Changes to CI pipelines or workflow configuration. **Does not trigger a release.**
  - `style` — Refactoring or stylistic changes that do not change functionality. **Does not trigger a release.**
  - `test` — Changes that only touch test files. **Does not trigger a release.**
  - Only `fix` and `feat` trigger releases. If a change doesn't neatly fit `fix` or `feat` but still needs to be released, use whichever is most appropriate to ensure a release is created.
- **Commits and merges:**
  - Commits should be atomic and ideally deployable in isolation — all tests, linting, and commitlinting should pass on each individual commit.
  - PRs are merged using a **merge commit** (no squash-merge or rebase-merge). Each commit in the PR history is preserved.
  - To keep branches up to date with the base branch, **rebase** onto it rather than merging it in.
  - All changes must go through a **pull request** — no direct commits to master.
- **Node version:** Pinned to 24 via `.nvmrc`. The action runs using `node24` (set in `action.yml`).
- **Imports:** Use the `type` keyword for type-only imports (e.g., `import type { Foo } from './bar'`). When importing both types and values from the same module, use a single import with inline `type` (e.g., `import { type Foo, bar } from './baz'`). Imports are ordered alphabetically by module path, grouped as: `node:` built-ins first, then external packages, then local file imports.
- **ESLint rules:** Trailing commas required on multiline, semicolons required, no variable shadowing. `@typescript-eslint/no-explicit-any` is disabled in test files.
- **README updates:** The usage block in `README.md` between `<!-- start usage -->` and `<!-- end usage -->` is auto-generated. Edit `action.yml` inputs, not the README directly.
- **Keeping this file up to date:** If a change affects the architecture, conventions, build process, or any other information documented here, update this file as part of the same PR.
