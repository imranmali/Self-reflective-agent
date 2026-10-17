# reflection-loop Specification

## Purpose
Drives repeated attempts at a task — draft, evaluate, critique, revise — and decides when to stop and which attempt to return, so reflection can only improve the delivered answer.

## Requirements

### Requirement: First draft without constraints
The system SHALL produce the first attempt for a task from the task prompt alone, with no constraints and no prior attempt.

#### Scenario: Initial attempt
- **WHEN** a task run starts
- **THEN** the first generation request contains the task prompt and no constraints or previous-attempt section

### Requirement: Revision from the best attempt
Every attempt after the first SHALL be generated from the highest-scoring attempt so far, the critique diagnosis, and the full current constraint ledger, and SHALL be a complete answer rather than a diff.

#### Scenario: Revision after a regression
- **WHEN** attempt 1 scores lower than attempt 0
- **THEN** attempt 2 is generated from attempt 0's output, not attempt 1's

#### Scenario: Revision carries constraints
- **WHEN** a revision is generated
- **THEN** its request contains the previous best attempt and every constraint in the ledger

### Requirement: Stop when passed
The system SHALL stop iterating as soon as an attempt passes evaluation.

#### Scenario: Pass on revision
- **WHEN** attempt 2 passes
- **THEN** no attempt 3 is generated and the stop reason is `passed`

### Requirement: Stop on plateau
The system SHALL stop when the configured number of consecutive revisions (patience) fail to beat the best score by at least the configured minimum delta.

#### Scenario: No meaningful improvement
- **WHEN** patience is 2 and two consecutive revisions do not improve the best score by the minimum delta
- **THEN** the run stops with stop reason `plateau`

### Requirement: Iteration budget
The system SHALL never generate more attempts than the configured maximum, including the first draft.

#### Scenario: Budget of one
- **WHEN** maximum iterations is 1 and the first attempt fails
- **THEN** exactly one attempt exists and the stop reason is `max_iterations`

### Requirement: Return the best attempt
The system SHALL return the highest-scoring attempt as the run's answer, so the returned score is never lower than the first attempt's score.

#### Scenario: Plateau after improvement
- **WHEN** scores are 6, 7, 7, 7 and the run stops on plateau
- **THEN** the returned attempt is the one that scored 7 first (iteration 1)

### Requirement: Failure isolation
If a model call fails after at least one attempt has been scored, the system SHALL stop with stop reason `error` and return the best attempt so far; if no attempt exists it SHALL surface the error.

#### Scenario: Judge outage mid-run
- **WHEN** the judge call fails on iteration 2 after iterations 0 and 1 were scored
- **THEN** the run ends with stop reason `error` and returns the better of attempts 0 and 1
