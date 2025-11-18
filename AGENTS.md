## Testing instructions

- Follow the Arrange, Act, Assert structure when writing unit tests.
- When writing unit tests, create individual unit tests that cover each logical branching in the code.
- For the happy path, can we have a single unit test where all the top level if conditions are executed? This might help with reducing the number of total unit tests created and still give same test coverage.
- For the tests for edge cases do not create separate describe blocks, keep the hierarchy flat.
- For the tests for edge cases, do not skip assertions, its still worth adding all assertions similar to the happy paths tests.
- Use only jest for writing test cases and refer existing unit test under the /src folder.
- Do not create code comments for any changes.

