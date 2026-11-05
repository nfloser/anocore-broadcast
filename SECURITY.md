# Security policy

The project is pre-release and does not currently accept production credentials or host public network services.

Please report suspected vulnerabilities privately to the repository maintainer using GitHub's private vulnerability reporting if enabled; otherwise contact the maintainer privately. Do not publish tokens, Steam credentials, server RCON passwords, or exploit details in a public issue.

Future network endpoints must default to loopback or authenticated access, restrict CORS, rate-limit input, protect write actions with role-based authorization and maintain audit logs. A broadcast overlay is read-only and must not contain privileged data.
