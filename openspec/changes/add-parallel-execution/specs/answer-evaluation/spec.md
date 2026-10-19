# Spec Delta

## MODIFIED Requirements

### Requirement: Multi-sample judging
When configured with N > 1 judge samples, the system SHALL request N verdicts concurrently and use the per-criterion mean score and the union of reasoning flaws. Aggregation SHALL follow sample order, not completion order, and token usage SHALL be the sum over all samples.

#### Scenario: Two samples
- **WHEN** two verdicts score a criterion 10 and 6
- **THEN** the recorded score for that criterion is 8

#### Scenario: Samples in flight together
- **WHEN** three judge samples are configured and each judge call is slow
- **THEN** all three calls are in flight at the same time, and the aggregated verdict is the same as if they had completed in order
