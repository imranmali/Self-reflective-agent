# Spec Delta

## Purpose

Turns an evaluated attempt into a root-cause diagnosis and specific, checkable constraints, and keeps those constraints enforced across later revisions.

## ADDED Requirements

### Requirement: Critique of every non-final attempt
After each attempt that does not end the run, the system SHALL produce a critique containing a diagnosis, a list of reasoning issues, and at least one constraint typed as `must`, `must_not`, `format`, or `reasoning`.

#### Scenario: Failed revision is critiqued
- **WHEN** a revision scores below the best attempt and the run continues
- **THEN** that revision is critiqued and its constraints are added to the ledger

### Requirement: Critic sees existing constraints
The critique request SHALL include the task, rubric, attempt, the judge verdict with hard-check failures, and the constraints already in force, and SHALL ask only for new constraints.

#### Scenario: Ledger in critique prompt
- **WHEN** the ledger holds two constraints
- **THEN** both appear in the critique request under constraints already in force

### Requirement: Hard-check failures become constraints
Each hard-check failure SHALL be converted to a constraint with stable wording that is identical across iterations and never contains the expected final answer.

#### Scenario: Wrong final answer
- **WHEN** the final-answer check fails against an expected answer of 5
- **THEN** the added constraint asks to re-derive and verify the result and does not contain "5"

### Requirement: Accumulating, deduplicated ledger
Constraints SHALL persist across iterations, be deduplicated by case- and punctuation-insensitive text, and when exceeding the configured cap the oldest SHALL be dropped.

#### Scenario: Duplicate constraint
- **WHEN** the ledger has "Cover X." and the critic proposes "cover x"
- **THEN** the ledger still holds one such constraint

#### Scenario: Cap exceeded
- **WHEN** the cap is 2, the ledger holds [A, B], and C is added
- **THEN** the ledger is [B, C]
