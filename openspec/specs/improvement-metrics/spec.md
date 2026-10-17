# improvement-metrics Specification

## Purpose
Quantifies whether self-reflection improved answers and at what cost, through per-iteration events, per-task and suite metrics, and a human-readable report.

## Requirements

### Requirement: Per-iteration event log
Each run SHALL append one JSON object per line to `events.jsonl` in a run-specific directory, with a timestamp and type, covering run start, generation, judging, critique, constraint merge, task end, errors, and run end.

#### Scenario: Judged event content
- **WHEN** an attempt is judged
- **THEN** a `judged` event records task id, iteration, effective score, judge score, per-criterion scores, reasoning flaws, hard-check failures, and pass status

### Requirement: Per-task improvement metrics
Each task run SHALL report initial score, final (best) score, absolute and relative gain, gap closed toward 10 as (best − initial)/(10 − initial), iterations used, iterations to pass (or none), pass status initially and finally, regression count, per-criterion gain, constraints accumulated, total tokens, total latency, and the score trajectory.

#### Scenario: Gap closed
- **WHEN** the initial score is 6 and the best is 8
- **THEN** gap closed is 50%

#### Scenario: Regression counted
- **WHEN** the trajectory is 6.65, 5.35, 10
- **THEN** the regression count is 1

### Requirement: Suite summary
A suite run SHALL report task count, pass rate for first drafts and final answers, mean initial and final score, mean gain, mean gap closed, mean iterations, tasks improved, tasks with net regression, total tokens, tokens per score point gained (or none when nothing was gained), and a histogram of stop reasons.

#### Scenario: Net regression is impossible
- **WHEN** any suite completes
- **THEN** the count of tasks with net regression is 0

### Requirement: Persisted artifacts
At the end of a run the system SHALL write `runs.json` (all attempts), `summary.json` (config and suite summary) and `report.md` (summary table, per-task trajectories, per-criterion gains, final answers) next to the event log.

#### Scenario: Report files exist
- **WHEN** a run completes
- **THEN** the run directory contains `events.jsonl`, `runs.json`, `summary.json` and `report.md`
