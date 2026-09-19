# Provider configuration audit, 2026-09-19

One pass over every configured provider, against its own published
documentation rather than against this repository's assumptions. Append-only:
each provider keeps the reading it was given on the date it was read.

For each: where the documentation is, whether it publishes a usage or account
endpoint CCR can consume, whether the access this repository configured is the
one the provider recommends, and anything the provider expects that is not
being sent.

Status vocabulary:

- `wired` a usage connector now reports for it
- `no endpoint` the documentation names none, or none carries consumption
- `needs account action` documented, but gated behind something only James can obtain
- `access changed` the configured base url, protocol or model ids were corrected
- `as documented` configuration already matches what the provider asks for

## Inventory at the start of the pass

56 providers enabled, 18 reporting usage. Reachability from
`node scripts/provider-sweep.mjs --passes 2`: 43 of 56.

## Findings

