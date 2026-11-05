# Security policy

The project is pre-release and does not currently accept production credentials or host public network services.

Please report suspected vulnerabilities privately to the repository maintainer using GitHub's private vulnerability reporting if enabled; otherwise contact the maintainer privately. Do not publish tokens, Steam credentials, server RCON passwords, or exploit details in a public issue.

Future network endpoints must default to loopback or authenticated access, restrict CORS, rate-limit input, protect write actions with role-based authorization and maintain audit logs. A broadcast overlay is read-only and must not contain privileged data.

## Local Windows observer key storage
The desktop application keeps the authenticated CS2 observer GSI key in its Electron main process and writes only a versioned encrypted ciphertext record under the user's application data directory, using Windows Electron safeStorage/DPAPI. There is no plaintext fallback if OS encryption is unavailable. Saved keys are reused across normal Live restarts; corrupt/undecryptable records abort Live startup until the operator explicitly resets the saved key in Demo mode. A reset invalidates previously exported game CFGs; the user must export and replace them deliberately. The CS2 GSI CFG itself necessarily contains the plaintext key and should be treated as a credential: do not share it, back it up to public locations, or upload it to GitHub. This preview is not yet verified on a clean Windows observer installation.
