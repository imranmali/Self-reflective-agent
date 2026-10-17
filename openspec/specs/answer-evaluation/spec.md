# answer-evaluation Specification

## Purpose
Scores a candidate answer against a task's weighted rubric using an LLM judge and deterministic hard checks, and decides whether the answer passes.

## Requirements

### Requirement: Structured rubric verdict
The judge SHALL return, for every rubric criterion, a score from 0 to 10 with an evidence-based rationale, plus a list of reasoning flaws and a one-sentence summary; output that does not match this structure SHALL be rejected and re-requested.

#### Scenario: Invalid judge output
- **WHEN** the judge returns a score outside 0–10 or omits the scores list
- **THEN** the system re-requests the verdict with the validation error, up to the retry limit, and fails the call if still invalid

### Requirement: No skipped criteria
A rubric criterion that the judge omits SHALL be scored 0, and scores for ids not in the rubric SHALL be ignored.

#### Scenario: Judge skips a criterion
- **WHEN** the rubric has criteria A and B and the judge scores only A
- **THEN** B is recorded with score 0 and rationale stating it was omitted

### Requirement: Weighted score
The judge score SHALL be the weight-normalised average of criterion scores.

#### Scenario: Weighted average
- **WHEN** criterion weights are 3 and 2 with scores 10 and 5
- **THEN** the judge score is 8

### Requirement: Deterministic hard checks
The system SHALL check, in code and without the LLM, a task's maximum word count, required terms, forbidden terms, and exact final answer (from a `Final answer:` line), case-insensitively.

#### Scenario: Wrong final answer
- **WHEN** the expected final answer is 5 and the answer ends with `Final answer: 4`
- **THEN** a hard-check failure is recorded for the final answer

#### Scenario: Missing final answer line
- **WHEN** a final answer is expected and the answer has no `Final answer:` line
- **THEN** a hard-check failure is recorded

### Requirement: Hard checks gate passing
Each hard-check failure SHALL reduce the effective score by 1.5 (floored at 0), and an attempt SHALL pass only if its effective score meets the threshold and it has no hard-check failures.

#### Scenario: High judge score with failed check
- **WHEN** the judge score is 9 and one hard check fails with threshold 7
- **THEN** the effective score is 7.5 and the attempt does not pass

### Requirement: Blind judging
The judge request SHALL NOT reveal the iteration number, prior scores, or that the answer is a revision.

#### Scenario: Judging a revision
- **WHEN** iteration 3 is judged
- **THEN** the judge prompt contains no iteration number, previous attempt, or revision wording

### Requirement: Multi-sample judging
When configured with N > 1 judge samples, the system SHALL request N verdicts and use the per-criterion mean score and the union of reasoning flaws.

#### Scenario: Two samples
- **WHEN** two verdicts score a criterion 10 and 6
- **THEN** the recorded score for that criterion is 8
