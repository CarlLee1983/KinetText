# Key secret-setting fingerprints to an installation-local secret

Secret-setting fingerprints are HMAC-SHA256 over the setting's name and value, keyed by a random 32-byte secret held per installation, truncated to 16 hex characters. The key comes from an environment variable when set, otherwise from a local key file that is generated on first use and excluded from version control.

A plain truncated hash is not sufficient. The values KinetiText fingerprints — an rclone remote name, a short token, a boolean-ish setting — are drawn from small enough spaces that an unkeyed digest is recoverable by dictionary in seconds. Diagnostic output is designed to be pasted into a bug report or handed to someone else, so a fingerprint in it must not be a disguised copy of the secret.

Including the setting name in the HMAC input separates domains: the same value used for two different settings does not produce the same fingerprint, so one setting's fingerprint says nothing about another.

Fingerprints are therefore comparable only within one installation. That matches what ADR-0001 asks of them — detecting whether relevant configuration has changed between runs of the same installation — and nothing else relies on cross-machine equality.

## Considered Options

- Truncated unkeyed SHA-256 of the value.
- A constant salt compiled into the source.
- Recording only whether the setting is present, without distinguishing values.

## Consequences

Every fingerprint depends on the installation key. Losing or rotating that key invalidates comparisons against previously recorded provenance, which will show as stages needing regeneration rather than as silent reuse. Setting the environment variable makes fingerprints reproducible across machines when that is deliberately wanted, such as in CI.

Generating the key writes one file on first use. This is the only write performed by the diagnostic path, and it happens in the evaluation layer rather than during probing, so the probe layer's no-side-effects contract is unaffected.

**Falsified if:** the set of settings KinetiText fingerprints comes to consist only of high-entropy values, at which point an unkeyed digest would be equally safe and the key management would be unearned complexity. Checkable against `src/diagnostics/secrets.ts`, `src/diagnostics/profiles.ts` and `src/diagnostics/types.ts`, where the fingerprinted settings are declared.
