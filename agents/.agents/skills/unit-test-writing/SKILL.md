---
name: unit-test-writing
description: This explains how to write unit test for this project. When a user asks to write unit test, you MUST read this before writing the tests.
---

# UI Testing Rules and Patterns

This document outlines the common patterns, conventions, and best practices found in the UI test files.

## Import Patterns

### Core Testing Imports for Components

```typescript
import { mountSuspended } from '@nuxt/test-utils/runtime';
```

### Component Imports

```typescript
// ui/app/components/ App components - use #components alias
import { ComponentName } from '#components';

// ui/layers/base/components Base layer - use relative imports
import ComponentName from '../ComponentName.vue';
```

## Test Structure Patterns

### Describe Block Naming

```typescript
// For all components
describe('~/components/ComponentName.vue', () => {

// For stores
describe('~/store/useStoreName', () => {
```

### Setup Patterns

```typescript
// Time mocking (when needed)
const date = new Date(2025, 6, 1, 13);
vi.setSystemTime(date);
```

### Mock Hoisting Pattern

- Use `vi.hoisted()` for mocks that need to have different values in multiple tests
- Reset hoisted mocks in `beforeEach` when needed

```typescript
// API request mocking
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
mockNuxtImport('request', () => requestMock);

describe('~/components/Component.vue', () => {
	// Reset hoisted mocks in beforeEach
    beforeEach(() => {
        requestMock.mockReset();
    });

	it('test something', async () => {
		requestMock.mockReturnValueOnce({ data: {});
		// mountSuspended and assertions...
	})

	it('test other thing', async () => {
		requestMock.mockReturnValueOnce({ error: {});
		// mountSuspended and assertions...
	})
```

```typescript
// Navigation mocking
const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }));
mockNuxtImport('navigateTo', () => navigateToMock);
```

### Mock Non-hoisting for Static Global Nuxt Functions

```typescript
// Runtime configuration mocking
mockNuxtImport('useRuntimeConfig', () => {
	return () => ({
		public: { APHERIS_API_URL: 'http://test.url' },
	});
});
```

## Component Testing Patterns

### Basic Rendering Test

```typescript
it('renders the component', async () => {
	const wrapper = await mountSuspended(ComponentName, {
		props: {
			modelValue: 'test value',
			label: 'test label',
			hint: 'test hint',
		},
	});
	await expect(wrapper.html()).toMatchFileSnapshot(
		'./__snapshots__/ComponentName.html',
	);
});
```

### Props Testing

```typescript
// Test with various prop combinations
it('renders with custom props', async () => {
	const wrapper = await mountSuspended(ComponentName, {
		props: {
			modelValue: 'test value',
			label: 'test label',
			hint: 'test hint',
		},
	});
	// assertions...
});

// Test default props
it('renders with default values', async () => {
	const wrapper = await mountSuspended(ComponentName);
	// assertions...
});
```

### Event Testing

```typescript
it('emits event when clicked', async () => {
	const wrapper = await mountSuspended(ComponentName, {
		props: { show: true },
	});

	await wrapper.find('[data-test="close-button"]').trigger('click');

	expect(wrapper.emitted('close')).toBeTruthy();
	expect(wrapper.emitted('close')?.length).toBe(1);
});
```

## Pinia Store Testing Patterns

### Store Method Testing

```typescript
it('fetchModels', async () => {
	requestMock.mockReturnValueOnce({
		data: { data: testData },
	});

	await store.fetchModels();

	expect(store.storeModels[testData[0]!.id]).toStrictEqual(testData[0]);
	expect(requestMock.mock.calls[0]).toMatchInlineSnapshot(
		`["/api/v1/endpoint"]`,
	);
});
```

### Store Action with Side Effects

```typescript
it('installApplication shows success message', async () => {
	requestMock.mockReturnValueOnce({ data: { status: 'success' } });
	const showMessageMock = vi.fn();
	useMessageStore().showMessage = showMessageMock;

	await store.installApplication('app-id', 'v1.0.0');

	expect(showMessageMock).toHaveBeenCalledWith({
		type: 'success',
		body: 'Application app-id installed successfully.',
	});
});
```

## Mocking Patterns

### Component Mocking

```typescript
import { mockComponent } from '@nuxt/test-utils/runtime';
mockComponent('ChildComponent', {
	template: '<div>ChildComponent</div>',
});
```

### Nuxt Composable Mocking

```typescript
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
mockNuxtImport('useRuntimeConfig', () => {
	return () => ({
		public: { APHERIS_API_URL: 'http://test.url' },
	});
});
```

### Pinia State Mocking

```typescript
it('renders with pinia state', async () => {
	useStore().someState = true;
	useStore().otherState = { foo: 'bar' };

	const wrapper = await mountSuspended(ComponentName);
	// assertions...
});
```

```typescript
// Using beforeEach for shared state setup
describe('with pinia state', () => {
	beforeEach(() => {
		useStore().someState = true;
		useStore().otherState = { foo: 'bar' };
	});

	it('renders correctly with state', async () => {
		const wrapper = await mountSuspended(ComponentName);
		// assertions...
	});

	it('handles state changes', async () => {
		const wrapper = await mountSuspended(ComponentName);
		// additional assertions...
	});
});
```

### Pinia Store Method Mocking

```typescript
const mockMethod = vi.fn();
useStore().methodName = mockMethod;

// Test the mock was called correctly
expect(mockMethod.mock.calls[0]).toMatchInlineSnapshot(
	`["expected", "params"]`,
);
```

## Assertion Patterns

### Snapshot Testing

```typescript
// File snapshots (preferred for full component HTML)
// IMPORTANT: Always use .html suffix for component snapshots, NOT .snap
await expect(wrapper.html()).toMatchFileSnapshot(
	'./__snapshots__/ComponentName.html',
);

// Inline snapshots (for specific content like function calls or small strings)
expect(element.html()).toMatchInlineSnapshot(`"expected html content"`);
expect(mockFunction.mock.calls[0]).toMatchInlineSnapshot(
	`["param1", "param2"]`,
);
```

### Element Testing

```typescript
// Using data-test attributes (preferred)
const element = wrapper.find('[data-test="element-name"]');
expect(element.exists()).toBe(true);
expect(element.text()).toBe('expected text');

// Multiple elements
const elements = wrapper.findAll('[data-test="list-item"]');
expect(elements.map((el) => el.text())).toMatchInlineSnapshot(`[...]`);
```

### Conditional Rendering

```typescript
// Test element doesn't exist
const element = wrapper.find('[data-test="conditional-element"]');
expect(element.exists()).toBe(false);

// Test v-if comment
expect(wrapper.html()).toBe('<!--v-if-->');
```

## File Organization

### Directory Structure

```
ui/
├── app/components/__tests__/
├── layers/base/components/__tests__/
├── app/stores/__tests__/
└── tests/assets/           # Shared test data
```

### Snapshot Files

```
__tests__/
├── ComponentName.spec.ts
└── __snapshots__/
    └── ComponentName.html    # Always use .html suffix for component snapshots
```

**Important:** Component snapshot files must use `.html` suffix, NOT `.snap` suffix. This makes them easier to view and diff in code editors.

### Test Data Files

```typescript
// Keep shared test data in tests/assets/
~/tests/aessst / models.json; // Models metadata and configs
~/tests/aessst / installedModels.json; // Installed models states
~/tests/aessst / requests.json; // Request/job data for testing
~/tests/aessst / inputs.json; // Input data for requests
~/tests/aessst / output.json; // Output data for results
~/tests/aessst / swagger.json; // API documentation data

// Import examples:
import testModels from '~/tests/assets/models.json';
import testInstalledModels from '~/tests/assets/installedModels.json';
import testRequests from '~/tests/assets/requests.json';
import testInputs from '~/tests/assets/inputs.json';
import testOutput from '~/tests/assets/output.json';
import testApi from '~/tests/assets/swagger.json';
```

## Best Practices

### Component Mounting

- Use `mountSuspended` from `@nuxt/test-utils/runtime` instead of `mount` from `@vue/test-utils`
- `mountSuspended` properly handles Nuxt's async setup and SSR context

### Data Test Attributes

- Use `data-test="element-name"` for test element selection
- Prefer data-test over class or id selectors
- suggest to edit the component if data-test is not present
- Use kebab-case for data-test values

### Async Testing

- Always `await` async operations like `mountSuspended`
- Use `await` when triggering events that might cause async updates

### Test Organization and Combining Tests

**Combine tests when possible** to reduce redundancy and improve test suite performance:

#### When to Combine Tests

1. **Related assertions on the same component state**

   ```typescript
   // ✅ GOOD - Combined related checks
   it('renders correctly and matches snapshot', async () => {
   	const wrapper = await mountSuspended(ComponentName, {
   		props: { value: 'test' },
   	});

   	// Check basic rendering
   	expect(wrapper.find('[data-test="input"]').exists()).toBe(true);
   	expect(wrapper.find('[data-test="label"]').text()).toBe('Test Label');

   	// Snapshot captures full state
   	await expect(wrapper.html()).toMatchFileSnapshot(
   		'./__snapshots__/ComponentName.html',
   	);
   });

   // ❌ BAD - Separate tests for things that could be combined
   it('renders input element', async () => {
   	const wrapper = await mountSuspended(ComponentName);
   	expect(wrapper.find('[data-test="input"]').exists()).toBe(true);
   });

   it('renders label', async () => {
   	const wrapper = await mountSuspended(ComponentName);
   	expect(wrapper.find('[data-test="label"]').text()).toBe('Test Label');
   });

   it('matches snapshot', async () => {
   	const wrapper = await mountSuspended(ComponentName);
   	await expect(wrapper.html()).toMatchFileSnapshot('./snapshot.html');
   });
   ```

2. **Sequential user interactions in a single flow**

   ```typescript
   // ✅ GOOD - Test complete user flow
   it('handles form submission flow', async () => {
   	const wrapper = await mountSuspended(FormComponent);

   	// Fill form
   	await wrapper.find('[data-test="name-input"]').setValue('John');
   	await wrapper
   		.find('[data-test="email-input"]')
   		.setValue('john@example.com');

   	// Submit
   	await wrapper.find('[data-test="submit-button"]').trigger('click');
   	await nextTick();

   	// Verify results
   	expect(mockSubmit).toHaveBeenCalledWith({
   		name: 'John',
   		email: 'john@example.com',
   	});
   	expect(wrapper.find('[data-test="success-message"]').exists()).toBe(true);
   });

   // ❌ BAD - Splitting a natural flow into separate tests
   it('fills name field', async () => {
   	/* ... */
   });
   it('fills email field', async () => {
   	/* ... */
   });
   it('submits form', async () => {
   	/* ... */
   });
   it('shows success message', async () => {
   	/* ... */
   });
   ```

3. **Multiple checks on the same mock/spy**

   ```typescript
   // ✅ GOOD - Check all aspects of the mock call together
   it('calls API with correct parameters and handles response', async () => {
   	requestMock.mockReturnValueOnce({ data: { id: '123' } });

   	await store.createItem('test-name');

   	// Check call parameters
   	expect(requestMock).toHaveBeenCalledTimes(1);
   	expect(requestMock).toHaveBeenCalledWith('/api/items', {
   		method: 'POST',
   		body: { name: 'test-name' },
   	});

   	// Check state update
   	expect(store.items).toHaveLength(1);
   	expect(store.items[0].id).toBe('123');
   });
   ```

#### When NOT to Combine Tests

Keep tests separate when:

1. **Testing different component states or configurations**

   ```typescript
   // ✅ GOOD - Separate tests for distinct states
   it('renders in loading state', async () => {
   	/* ... */
   });
   it('renders in error state', async () => {
   	/* ... */
   });
   it('renders in success state', async () => {
   	/* ... */
   });
   ```

2. **Testing different error conditions**

   ```typescript
   // ✅ GOOD - Each error case is distinct
   it('handles network error', async () => {
   	/* ... */
   });
   it('handles validation error', async () => {
   	/* ... */
   });
   it('handles timeout error', async () => {
   	/* ... */
   });
   ```

3. **Testing independent features**

   ```typescript
   // ✅ GOOD - Unrelated features stay separate
   it('opens modal when button clicked', async () => {
   	/* ... */
   });
   it('filters list when search term entered', async () => {
   	/* ... */
   });
   it('sorts items when header clicked', async () => {
   	/* ... */
   });
   ```

4. **When test names would become unclear**

   ```typescript
   // ❌ BAD - Test name is too vague
   it('does multiple things', async () => {
   	/* ... */
   });

   // ✅ GOOD - Clear, focused test names
   it('validates email format', async () => {
   	/* ... */
   });
   it('shows error for duplicate email', async () => {
   	/* ... */
   });
   ```

#### Guidelines for Test Naming When Combining

- Use descriptive names that capture all aspects being tested
- Use "and" to connect related behaviors: `"renders form and validates input"`
- Focus on the user story or feature: `"handles complete checkout flow"`
- Be specific about what's being verified: `"submits form and shows success message"`

### Test Coverage

- Test basic rendering
- Test different prop combinations
- Test user interactions (clicks, form inputs)
- Test different states and conditions
- Test error states and edge cases
- Test loading states when applicable

## Running Tests with Coverage

### Coverage Commands

To check test coverage for specific files or the entire project:

```bash
# Run tests with coverage for a specific test file
TZ=UTC npx vitest run <test-name> --coverage.enabled --coverage.reporter=text

# Examples:
TZ=UTC npx vitest run useBenchmarkStore --coverage.enabled --coverage.reporter=text
TZ=UTC npx vitest run 2.results.global --coverage.enabled --coverage.reporter=text

# Run all tests with coverage
TZ=UTC pnpm test -- --coverage

# Run tests in watch mode with coverage
TZ=UTC pnpm test -- --coverage --watch
```

### Understanding Coverage Output

The coverage report shows four key metrics:

- **% Stmts (Statements)**: Percentage of statements executed
- **% Branch**: Percentage of conditional branches tested (if/else, switch, ternary)
- **% Funcs (Functions)**: Percentage of functions called
- **% Lines**: Percentage of lines executed
- **Uncovered Line #s**: Specific line numbers not covered by tests

Example coverage output:

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
useBenchmarkStore  |   96.63 |    92.85 |   94.44 |   96.63 | 193-199,451-461
2.results.global   |     100 |      100 |     100 |     100 |
-------------------|---------|----------|---------|---------|-------------------
```

### Coverage Goals

The project has the following coverage thresholds (defined in `vitest.config.mts`):

- **Lines**: 73%
- **Statements**: 73%
- **Functions**: 48%
- **Branches**: 75%

Aim to meet or exceed these thresholds when writing tests. For new code, strive for 100% coverage when practical.

### Tips for Improving Coverage

1. **Identify uncovered lines**: Look at the "Uncovered Line #s" column to see which lines need tests
2. **Test error paths**: Ensure both success and error cases are tested
3. **Test edge cases**: Include tests for empty arrays, null values, undefined, etc.
4. **Test all branches**: Cover all if/else paths, switch cases, and ternary operators
5. **Test private functions indirectly**: Test private functions through public API calls
6. **Use coverage to find gaps**: Run coverage after writing tests to identify missing test cases
