## Testing instructions

- Follow the Arrange, Act, Assert structure when writing unit tests.
- When writing unit tests, create individual unit tests that cover each logical branching in the code.
- For the happy path, can we have a single unit test where in the all the top level if conditions are executed? Maybe this might help with reducing the number of total unit tests created and still give same test coverage.
- For the tests for edge cases do not create separate describe blocks, keep the hierarchy flat.
- For the tests for edge cases, do not skip assertions, its still worth adding all assertions similar to the happy paths tests.

