---
description: Real SQLite not mocks, assert known values, break code to validate tests
type: rule
triggers: [writing tests, reviewing tests, adding test coverage, debugging test failures]
related: [protocol-verify-before-done]
---

# Test Quality — What AI Gets Wrong

AI-generated tests routinely mock everything and test nothing. The `solid-refactor` branch deleted 186 lines of tautological tests and rewrote 7 more. These rules exist because the failure mode is proven and recurring.

## The 5 rules

### 1. Use real SQLite

Import `createTestDb()` from `tests/test-db.ts`. Never mock database calls with `vi.fn()` chains.

**Why:** Mocking hides real SQL bugs. A mocked query always returns what you told it to return — it can't catch a typo in a column name, a missing join condition, or a schema mismatch. The test passes, the production code breaks.

### 2. Assert against known values

Not "is truthy". Not "is a string". Not "has length > 0". Use exact expected values or verified reference outputs.

**Why:** Weak assertions pass when the code is wrong. `expect(result).toBeTruthy()` passes for `"error"`, `[undefined]`, and `{}` — none of which are correct results.

Good: `expect(hash).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')`
Bad: `expect(hash).toBeDefined()`

### 3. Break the code to verify the test

Before committing a test, introduce a deliberate bug in the code under test. If the test still passes, the test is worthless — delete it and write one that fails.

**Why:** A test that can't detect a bug isn't testing anything. It's a false safety signal that's worse than no test at all.

### 4. Don't test TypeScript's job

Never write `expect(typeof x).toBe('function')` or `expect(x).toBeInstanceOf(Array)` when the compiler already guarantees the type.

**Why:** These assertions are tautological. TypeScript already verifies types at compile time. Writing runtime assertions for compile-time guarantees wastes test budget and clutters the test file.

### 5. Don't test mock behavior

If your test mocks a function and then asserts the mock was called with certain arguments, you're testing the mock, not the code.

**Why:** Mock-call assertions verify that your test setup works. They don't verify that the application does the right thing. A test that asserts `mockFn.toHaveBeenCalledWith('x')` will pass even if the real function with input `'x'` throws an error.

Test observable outcomes: database state after an operation, file contents after a write, response body from an endpoint.

## Running tests

```sh
make test          # vitest unit tests
make test-e2e      # build (CITY=demo) + playwright screenshot tests
make test-admin    # admin E2E tests (save flow, community editing)
make full          # build + validate + unit + all E2E
```

## When a test fails

Investigate why it fails. Do not write code to make it pass without understanding the failure. The test failure is a signal to understand, not a problem to suppress. This is the "make it pass" substitution pattern — answering "how do I make it stop?" when the real question is "why does this happen?"
