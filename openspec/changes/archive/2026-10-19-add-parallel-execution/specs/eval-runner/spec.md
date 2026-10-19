# Spec Delta

## ADDED Requirements

### Requirement: Bounded concurrent task execution
The runner SHALL accept `--concurrency N` (default 1, also read from the `CONCURRENCY` environment variable) and SHALL run at most N tasks at a time, reporting results in suite order. A value that is not a positive integer SHALL be rejected with exit code 2 before any model call. The chosen concurrency SHALL be recorded in the run configuration. Running tasks concurrently SHALL NOT change any task's result, and every event log line SHALL remain a complete JSON object carrying its task id.

#### Scenario: Default is sequential
- **WHEN** no concurrency flag or environment variable is given
- **THEN** tasks run one at a time and the run configuration records concurrency 1

#### Scenario: Parallel run matches sequential run
- **WHEN** the offline suite runs with `--concurrency 4`
- **THEN** each task's score trajectory, best attempt and stop reason equal those of a sequential run, and the summary lists tasks in suite order

#### Scenario: Concurrency cap
- **WHEN** a suite of 8 tasks runs with `--concurrency 3`
- **THEN** no more than 3 tasks are in progress at any moment

#### Scenario: Invalid concurrency
- **WHEN** `--concurrency 0` is passed
- **THEN** the runner exits with code 2 and an `error:` message, without running any task

#### Scenario: Interleaved event log
- **WHEN** several tasks run concurrently
- **THEN** every line of `events.jsonl` parses as JSON, and each task's events appear in iteration order

### Requirement: API retry and timeout
With the `anthropic` provider, the runner SHALL configure SDK-level retries with backoff for rate-limit and server errors (default 4, `--api-retries N`) and a per-request timeout (default 120000 ms, `--api-timeout-ms N`), independent of the schema-validation retry limit.

#### Scenario: Rate limited under load
- **WHEN** a request receives HTTP 429 and retries remain
- **THEN** the request is retried after a backoff instead of failing the attempt
