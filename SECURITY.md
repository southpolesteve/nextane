# Security

Nextane is experimental software, but security reports are taken seriously.

## Supported versions

Only the latest npm release is supported. Security fixes are released as new
patch versions rather than backported to older releases.

## Report a vulnerability

Please use [GitHub private vulnerability
reporting](https://github.com/southpolesteve/nextane/security/advisories/new).
Do not open a public issue for a vulnerability that has not been fixed.

Include the affected version, deployment environment, reproduction steps,
impact, and any suggested mitigation. Reports involving a migrated application
should say which behavior comes from Nextane and which comes from application
code.

Nextane does not currently implement React Server Components, Server Actions,
the App Router, middleware, Preview Mode, or the Next.js image optimizer.
Reports about similarly named Next.js features should include a reproduction
against Nextane.

There is no formal response-time SLA for this experimental project. Please
allow time to reproduce and fix an issue before public disclosure.
