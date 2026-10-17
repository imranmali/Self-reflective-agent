# Spec Delta

## Purpose

Provides the command-line entry point that loads a task suite, selects a model provider, runs the reflective agent over each task, and prints a summary.

## ADDED Requirements

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
