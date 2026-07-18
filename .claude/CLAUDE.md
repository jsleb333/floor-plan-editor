# Floor Plan Editor

Interactive web editor for residential floor plans and their electrical
layout — walls, electrical devices, and colour-coded circuits. Plans are
editable, layer-based, and exportable (SVG / PNG / JSON). See `REQUIREMENTS.md`
for the full requirements and user stories.

## Stack

- **Backend**: Python 3.13+, FastAPI, Pydantic
- **Frontend**: Vue 3 SPA (Vite, TypeScript)

## Architecture

Hexagonal architecture, ports and adapters style.

```
backend/
  api/           # FastAPI routes (thin) + Pydantic schemas
  core/          # Core business logic (services, orchestrators, etc.)
  interfaces/    # ABC interfaces (ports)
  models/        # Pydantic models (domain + persistence)
  infra/         # Client, repositories (adapters)
  container.py   # Wires infra -> services via Dishka
  main.py        # App factory (serves the built SPA in prod)

frontend/src/
  api/           # Centralized fetch client, one module per domain
  types/         # Shared TypeScript domain types
  pages/         # Route-level components
  components/    # Editor + panel components
  composables/   # Editor logic (viewport, history, export)
  stores/        # Pinia stores (plans, editor)
```

## Commands

```bash
uv sync --group dev          # install dependencies
poe api --dev                # backend
poe ui                       # frontend
poe check                    # lint + typecheck + test
poe lint                     # ruff check
poe format                   # ruff format
poe typecheck                # ty check
poe test                     # pytest
```

## Backend conventions

### Key rules

- `pyproject.toml` is the single source of truth for Python version, tooling config.
- Never delete the data from database, except if explicitely asked. Always plan a migration.
- Pydantic v2 models for data structures
- Async throughout
- Use Python 3.13+ syntax. This means typing with `X | None` not `Optional[X]`, `list[str]` not `List[str]`, `tuple[...]` not `Tuple[...]`
- Never import packages inside functions or methods — all imports go at the top of the file
- Aim for one class per file, with the filename matching the class name (e.g. `SearchService` in `search_service.py`). Don't mix classes with free functions in the same file; either use static methods or put the functions in a separate utility file.
- Use ABC classes for interfaces, and use interfaces for all infra (clients, connectors, repositories) or for services that have multiple implementations. Services that have only one implementation can be concrete classes without interfaces.
- Use Object-Oriented Programming: business logic should be organized in classes. Free functions are only allowed for utilities that are truly stateless and don't belong to any class.
- Don't add reference comments pointing to docs (e.g. `Reference: docs/...`) in source code
- Keep separator comments (e.g. `# ----------`) minimal — class and function structure should speak for itself
- Use dependency injection for all dependencies, and never instantiate dependencies directly in classes. This ensures loose coupling and makes testing easier. The container should be responsible for wiring everything together. Use `dishka` for dependency injection and wiring in the container.
- Use `pydantic-settings` for configuration management, and load configuration from environment variables. The container should be responsible for loading the configuration and providing it to services that need it.
- Log important events using `loguru`, and log at appropriate levels (e.g. `info` for high-level events, `debug` for detailed info useful in debugging, `error` for exceptions and errors)
- Use `pathlib` for all file path manipulations, avoid `os.path` unless necessary for specific functions that `pathlib` doesn't cover.
- Constants are defined in ALL_CAPS with underscores, and can either be defined at the *top* (right after imports) of a module file if the constant is only relevant to that module, or defined in a `constants.py` file if they are shared across multiple modules. Constants are always better than magic values as they are self-explanatory. Be considerate about whether a constant is a true constant (e.g. `PI = 3.14159`) or a configuration value that should be injected.

### Code style

Classes should follow this style:

```python
from typing import ClassVar  # Imports are always at the top of the file, grouped by standard library, third-party, and local imports, sorted alphabetically within each group.


MY_CONSTANT = 42  # Example of a module-level constant. Notice there are 2 blank lines above and below, and it's in ALL_CAPS with underscores.


class MyService:
    """Google docstring describing the service and its dependencies.

    Role:
        Brief description of the service's responsibility in the system. This should be a high-level overview of what the service does, not how it does it, so that future maintainers and AI assistants can quickly decide if this is the right service to look at for a given task.
    """

    class_var: ClassVar[int] = 0  # Example of a class variable with type hint

    def __init__(self, repo: SomeRepository, other: OtherService) -> None:
    """Everything is type hinted. Google docstring describing the service and its dependencies.

    Args:
        repo: Description of the repo dependency.
        other: Description of the other dependency. No need to describe the types here since they are in the type hints, but do describe what the dependency is for and any important details about how it's used.
    """
        self._repo = repo
        self._other = other

    async def some_method(self, param: str) -> int:
        """Google docstring describing the method's behavior, inputs, and outputs.

        Args:
            param: Description of the parameter and any important details about its expected format or meaning.

        Returns:
            Description of what the method returns and any important details about the output.
        """
        ...
        return MY_CONSTANT * self.class_var  # Example of using a constant and a class variable
```

### Architecture and code structure

- Data models and interfaces define contracts.
- Repositories, clients and connectors implement interfaces and contain all external interaction logic.
- Services contain business logic surrounding domain entities, and use injected repositories and clients to perform operations. Services can never depend on each other services, only on repositories and clients. This ensures a clear separation of concerns and prevents tight coupling between services. Favor more services or orchestrators rather than having services depend on each other.
- Complex flows that involve multiple services are defined in `Orchestrator` classes in the `core/orchestrators/` directory. These are the only classes that accept services as injected dependencies, and they are responsible for coordinating the calls to multiple services to perform complex operations. Orchestrators can never be called by services or other orchestrators, they can only be called by the API routes.
- A container wires everything together, with repositories and clients depending on interfaces, services depending on repositories and clients, and orchestrators depending on services.
- API routes are thin and only responsible for handling HTTP requests, validating input with Pydantic schemas, calling the appropriate service or orchestrator, handling exceptions, and returning HTTP responses. They should never contain business logic or interact directly with the database or external services.

### Linting & types

- **Ruff**: strict. No noqa comments except if authorized by user.
- **ty**: strict. No `# type: ignore` except if authorized by user.
- Run formating, linting, typechecking and tests before considering work done.

### Testing conventions

- Tests go under `tests/` and should mirror the source layout (e.g. `app/services/search/` -> `tests/services/search/`)
- Tests should use `pytest` with async support (`pytest-asyncio`)
- Tests are run with `uv run pytest`
- Gather tests by classes named `Test<ClassName>`
- Test method names follow the pattern `test_<method_name>__when_<condition>__<expected_behavior>`
- Use fixtures for setup, with descriptive names and docstrings
- Type hint tests and fixtures with the real types they provide, not mocks or fakes. If a fixture returns a mock, use the type that the mock is standing in for.
- Focus on quality and coverage of tests rather than quantity. It's better to have fewer, well-designed tests that cover important behaviors than many superficial tests.
- Test observable behavior and results. Avoid testing implementation details that could change without affecting the correctness of the code.

Here's a template for a test class following these conventions:

```python
import pytest
from unittest import AsyncMock

class Test<ClassName>:

    @pytest.fixture
    def <fixture_name>(self) -> <FixtureType>:
        """Brief description of what the fixture provides. The type hint should be as specific as possible, and NEVER use mocks or fakes in the return type. If the fixture returns a mock, use the real type that the mock is standing in for."""
        return AsyncMock(...)

    @pytest.mark.asyncio
    async def test_<method_name>__when_<condition>__<expected_behavior>(self, <fixture_name>: <FixtureType>) -> None:
    """Brief description of the test case avoiding just restating the test name. The test should not test implementation details, but rather the observable behavior or results of the method under test. Less tests but quality tests are better."""
    ...
    assert ...
```

## Frontend conventions

### Stack

- **Vue 3** with Composition API (`<script setup>` exclusively — no Options API)
- **TypeScript** for all `.vue` and `.ts` files — no `.js` source files
- **Pinia** (Composition API syntax) for shared state
- **Vue Router 4** with lazy-loaded route components
- **Tailwind CSS 4** with custom theme in `style.css`
- **Vite** for dev server and builds

### Key rules

- `package.json` is the single source of truth for frontend dependencies and scripts.
- All components use `<script setup lang="ts">` — no `<script>` blocks, no Options API.
- Use TypeScript strict mode. Avoid `any` — use `unknown` and narrow, or define proper types.
- Never use `@ts-ignore` or `as any` except if authorized by user.
- All imports at the top of the file — no dynamic imports inside functions (except for router lazy-loading).
- One component per file. Filename matches the component name in PascalCase (e.g. `FilterBar.vue`).
- Don't add comments that restate what the code does — Vue's declarative template syntax should speak for itself.

### Project structure

```
frontend/src/
  main.ts              # App entry — mounts app, registers plugins
  App.vue              # Root layout (nav, router-view)
  router.ts            # Route definitions (lazy-loaded pages)
  api/                 # API client modules, one per domain
  types/               # Shared TypeScript interfaces and types
  pages/               # Route-level components (one per route)
  components/          # Reusable UI components
  composables/         # Shared composition functions (use*.ts)
  stores/              # Pinia stores (one per domain)
  utils/               # Pure utility functions
  style.css            # Tailwind theme and global styles
```

### Component anatomy

Components follow this order within `<script setup lang="ts">`:

1. Imports
2. Props (`defineProps`) and emits (`defineEmits`) with full type annotations
3. Store and router access
4. Reactive state (`ref`, `reactive`, `computed`)
5. Functions (event handlers, helpers)
6. Lifecycle hooks (`onMounted`, `watch`)

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePeriodStore } from '@/stores/periods'
import type { Period } from '@/types/period'

const props = defineProps<{
  periodId: string
}>()

const emit = defineEmits<{
  close: [periodId: string]
}>()

const router = useRouter()
const periodStore = usePeriodStore()

const loading = ref(false)
const error = ref<string | null>(null)

const period = computed(() =>
  periodStore.periods.find(p => p.id === props.periodId)
)

async function handleClose() {
  loading.value = true
  try {
    await periodStore.close(props.periodId)
    emit('close', props.periodId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unexpected error'
  } finally {
    loading.value = false
  }
}

onMounted(() => periodStore.load())
</script>

<template>
  <!-- Template here -->
</template>
```

### Types

- Define domain types in `types/` as TypeScript interfaces matching backend Pydantic schemas.
- Props and emits must use TypeScript generics (`defineProps<{...}>()`) — no runtime prop declarations.
- API response types should be explicit — never trust `any` from fetch.
- Use discriminated unions for state that can be in multiple modes (e.g. `{ status: 'loading' } | { status: 'error', message: string } | { status: 'ok', data: T }`).

### API client

- Organized in `api/` with one module per domain (e.g. `api/periods.ts`, `api/transactions.ts`).
- All functions are named exports — no default exports.
- Every function has explicit parameter and return types.
- Use a shared `request()` helper in `api/client.ts` for fetch + error handling. The helper should throw typed errors, not return raw responses.
- Query parameters should be built from typed objects, not string concatenation.

### Pinia stores

- Use Composition API syntax (`defineStore('name', () => { ... })`).
- One store per domain entity (plans, editor).
- Stores own the API calls for their domain — components should not call the API client directly for CRUD operations. Components may call the API client directly for one-off queries that don't need shared state.
- Keep stores thin: fetch, cache, and expose data. Business logic beyond simple derived state should live in composables.
- Always return promises from actions so callers can await and handle errors.

### Composables

- Named `use<Purpose>.ts` (e.g. `useKeyboardNav.ts`, `useFilters.ts`).
- Must be pure composition functions — no side effects on import.
- Accept reactive inputs via refs or props, return refs and functions.
- Document parameters and return values with JSDoc when the interface isn't obvious.

### Accessibility & semantic HTML

- Use semantic HTML elements (`section`, `nav`, `header`, `article`) instead of generic `div` for page landmarks and meaningful content areas.
- Add `aria-label` on semantic elements that don't have a visible heading to describe their purpose (e.g. `<section aria-label="Transactions">`). This improves screen reader support, makes the DOM self-documenting in DevTools, and makes it easier for developers to reference the correct element when adding features or debugging.
- Component root elements should use the most appropriate semantic element — e.g. a transaction table wrapper is a `section`, a filter toolbar is a `nav` or `search` role, navigation links are `nav`.
- Don't add `aria-label` on elements that already have a visible heading (`h1`–`h6`) as their first child — the heading already serves as the accessible name.

### Styling

- Use Tailwind utility classes in templates — no scoped `<style>` blocks except for complex animations or third-party overrides.
- Custom theme tokens (colors, shadows, animations) are defined in `style.css` via `@theme`.
- Never use inline `style` attributes for things Tailwind can handle.
- Use consistent spacing, border-radius, and color tokens from the theme — don't hardcode hex values.
- Component-level visual variants should use computed classes, not ternary soup in templates. Extract to a `const classes = computed(...)` when conditional logic has more than two branches.

### Routing

- All page components are lazy-loaded (`() => import('./pages/SomePage.vue')`).
- Route names are kebab-case (`'period-detail'`).
- Use typed route params — avoid casting `route.params.id as string` repeatedly.
- Navigation uses `router.push({ name: '...' })` — not raw paths.

### Error handling

- Async operations in components must be wrapped in try/catch.
- Errors are surfaced to users via local `error` refs — no silent failures.
- The API client throws on non-2xx responses with a meaningful message.
- Never swallow errors in `.catch(() => {})`.

### Linting & formatting

- **ESLint 9** flat config with `eslint-plugin-vue` and `@vue/eslint-config-typescript`. Strict rules, no `eslint-disable` except if authorized by user.
- **Prettier** with `prettier-plugin-vue` for formatting. No style debates — Prettier decides.
- Run linting and formatting before considering work done.

### Testing

- **Vitest** for unit and integration tests, **Vue Test Utils** for component tests.
- Tests go under `frontend/tests/` mirroring the source layout.
- Test files named `<ComponentName>.test.ts` or `<module>.test.ts`.
- Focus on testing composables, stores, and utility functions. Component tests should verify user-visible behavior (rendered text, emitted events), not internal state.
- Use `vi.mock()` for API calls — never hit the real backend in unit tests.
- Run tests before considering work done.
