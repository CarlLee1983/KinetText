# Use provenance manifests to resume workflow stages

KinetiText will record each stage artifact's relevant inputs, configuration, and producer version, and will reuse the artifact only when that recorded provenance matches the requested work. File existence or basic structural validity alone is insufficient because it can silently reuse output made from stale sources or settings.

Each work's provenance is held in one work-local workflow-state manifest, which is the single source of truth for that work's resumable stages.

The workflow-state manifest is versioned, human-readable JSON and is written atomically.

Provenance uses content hashes, normalized relevant configuration, applicable external-tool versions, and a version for each stage producer. A change invalidates that stage and its downstream artifacts, rather than every artifact for an unrelated application change.

Secrets are never stored in provenance manifests or diagnostic output. A non-reversible secret-setting fingerprint may be recorded solely to detect relevant changes.

## Considered Options

- Reuse any existing output file.
- Validate only file existence, size, and basic readability.

## Consequences

Existing artifacts without provenance are retained as legacy artifacts but are not automatically reused. Re-running the relevant stage creates a new artifact with verifiable provenance.

Stages publish their output and update the workflow-state manifest only after successful validation, so interrupted work cannot be resumed as a valid artifact.
