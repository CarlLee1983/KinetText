# Use the Go duration helper as the authoritative duration source

KinetiText has two independent ways to measure audio duration: the `kinetitext-duration` Go helper and the music-metadata library. Both are currently reachable, and callers receive a bare number that does not say which one produced it.

The Go duration helper is the authoritative source whenever it is available. music-metadata is the fallback path, used only when the helper cannot be resolved. Duration is no longer returned as a bare number: every result carries the value, the path that produced it, and that path's tool version.

A stage artifact produced by the fallback path is not equivalent to one produced by the authoritative path. The path marker is part of the provenance fingerprint, so installing the helper later invalidates durations previously measured by the fallback, and re-running the stage produces an artifact with authoritative provenance.

The Go helper is chosen as authoritative because ADR-0001 already requires recording applicable external-tool versions, and the helper is the component whose version that clause describes. Performance is the reason the Go layer exists at all, and duration extraction is the operation that benefits from it.

## Considered Options

- Make music-metadata authoritative and treat the Go helper as an accelerator.
- Treat the two measurements as interchangeable when they agree within the merge tolerance.

## Consequences

The duration service's public interface returns a structured result rather than a number. Three downstream consumers — M4B chapter markers, MP4 conversion, and the YouTube pipeline — adapt to it. This is a deliberate breaking change: making the source impossible to ignore at the type level is more reliable than trusting each caller to record it.

Work carried out on a machine without the Go helper still completes, but its duration artifacts are marked as fallback-produced and will be regenerated once the helper is present. This is the intended cost of a single authoritative source; the alternative silently mixes two measurements inside one audiobook.

The existing merge tolerance keeps its current meaning and behaviour. It now compares two numbers that each carry a source, and a comparison across differing sources is noted in the logs.

**Falsified if:** the two implementations are shown to agree, across the supported inputs, to within a margin smaller than the merge tolerance — at which point the source distinction is unobservable in any output and the added provenance is pure overhead. Checkable against `src/core/services/DurationService.ts`, `src/core/services/DurationGoWrapper.ts`, `src/config/DurationGoConfig.ts` and `src/config/goBinaryPaths.ts`.
