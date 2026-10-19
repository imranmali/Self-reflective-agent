# eval-runner Specification

## Purpose
Provides the command-line entry point that loads a task suite, selects a model provider, runs the reflective agent over each task, and prints a summary.

## Requirements

### Requirement: Task suite format
The runner SHALL load a JSON array of tasks, each with an id, prompt, non-empty weighted rubric, optional reference shown only to the judge, optional hard checks, optional pass threshold, and optional offline fixtures, and SHALL reject an invalid suite before any model call.

#### Scenario: Invalid suite
- **WHEN** a task has an empty rubric
- **THEN** the runner exits with a validation error and makes no model calls

### Requirement: Provider selection
The runner SHALL support an `anthropic` provider and a deterministic `offline` provider, defaulting to `anthropic` when an API key is present and `offline` otherwise, and SHALL reject unknown provider names.

#### Scenario: No API key
- **WHEN** no `ANTHROPIC_API_KEY` is set and no provider flag is given
- **THEN** the offline provider is used

#### Scenario: Unknown provider
- **WHEN** `--provider bogus` is passed
- **THEN** the runner fails with an "unknown --provider" error

### Requirement: Separate judge model
With the `anthropic` provider, the generator model and the judge/critic model SHALL be independently configurable by flag or environment variable.

#### Scenario: Custom judge model
- **WHEN** `--judge-model X` is passed
- **THEN** judge and critic requests use model X and generator requests use the generator model

### Requirement: Deterministic offline mode
The offline provider SHALL produce identical results for identical inputs, require no network access, and choose revisions based on the constraints it receives.

#### Scenario: Repeat offline run
- **WHEN** the offline demo runs twice on the same suite
- **THEN** both runs produce the same score trajectories

### Requirement: Run configuration flags
The runner SHALL accept flags for task file, task subset, maximum iterations, pass threshold, patience, minimum delta, judge samples, output directory, and quiet mode, and SHALL print a per-task summary table and the artifact location on completion.

#### Scenario: Subset run
- **WHEN** `--only capacity-math` is passed
- **THEN** only that task is run and summarised

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
