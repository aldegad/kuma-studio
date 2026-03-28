# Security Policy

If you find a security issue in Kuma Picker, please do not open a public issue first.

## Report

Email: `aldegad@gmail.com`

Please include:

- a short description of the issue
- affected files or commands
- reproduction steps
- impact
- whether the issue requires a loaded extension, local daemon access, or a malicious page

## Scope notes

Kuma Picker runs a local daemon and a Chrome extension that can automate pages in the active browser session. Reports involving any of the following are especially valuable:

- privilege escalation through the extension bridge
- cross-origin or arbitrary-page message abuse
- script execution outside the intended `run` surface
- local state leakage from `~/.kuma-picker/`
- unsafe browser command routing or target confusion

## Response goals

- initial acknowledgment within 7 days
- status update after reproduction when possible
- coordinated public disclosure after a fix is available

## Supported state

Security review is best-effort right now. The most relevant target is the current default branch plus the current extension and daemon workflow described in [README.md](./README.md).
