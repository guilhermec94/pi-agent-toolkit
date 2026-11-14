# Secret Guard

`secret-guard.ts` keeps secret values out of the conversation context — which means out
of the LLM provider, the on-disk session files (`~/.pi/agent/sessions/*.jsonl`), and any
compaction/summary pi generates.

## Why

Every command the agent runs and every result a tool returns is stored in the session
and sent to the model. If a password, token, or key appears in a command or in output,
it has leaked — to the provider and to disk.

Env vars are the right way for the agent to *reference* secrets (`$TOKEN` is safe,
`TOKEN=sk-...` is not), but they don't stop secrets from appearing in *output* (e.g.
`terraform output`, `cat .env`, verbose `curl`). Secret Guard closes both holes.

## The three layers

### 1. Block inline secrets in commands

A `bash` command that inlines a secret is rejected before it runs, with a reason that
tells the agent to use `$VAR`:

```
TOKEN=sk-... ./run              → blocked (secret-assignment)
curl -u admin:hunter2 https://  → blocked (curl-basic-auth)
--password hunter2 ./deploy     → blocked (password-flag)
Authorization: Bearer <literal> → blocked (authorization-header)
```

Referencing an env var is allowed and encouraged:

```
TOKEN="$TOKEN" ./run
curl -u "$CRED" https://...
--password "$PASSWORD" ./deploy
```

### 2. Redact secrets from tool output

Every tool result is scanned and matching secrets are replaced before the result is
stored or sent:

```
the password is hunter2  →  the password is [REDACTED]
```

This covers both the values listed in your `secrets.env` and common secret *patterns*
(AWS keys, GitHub tokens, Stripe keys, JWTs, private keys, basic-auth URLs, bearer
headers).

### 3. Redact known secrets from the message list

Before each model call, your known secrets are scrubbed from the entire message list.
This is a final net for anything that slipped through layers 1–2 (e.g. a secret typed
directly into a message).

## Configuration

Secrets live in `~/.pi/agent/secrets.env`:

```
# comment
GITHUB_TOKEN=ghp_...
DATABASE_URL=postgres://user:hunter2@host/db
```

- One `KEY=VALUE` per line; `#` starts a comment.
- The *value* (8+ chars) is what gets redacted anywhere it appears.
- Run `/secrets` in pi to reload the file and show the current count.

See `secrets.env.example` in the repo root for a template.

## Built-in patterns

| label | matches |
|---|---|
| `private-key` | PEM private key blocks |
| `aws-access-key` | `AKIA...` access key IDs |
| `github-token` | `ghp_` / `gho_` / `ghs_` / `ghu_` / `ghr_` tokens |
| `slack-token` | `xox...` tokens |
| `stripe-key` | `sk_live_` / `sk_test_` / `pk_...` keys |
| `api-key` | `sk-...` (OpenAI/Anthropic-style) |
| `jwt` | `eyJ...` JSON web tokens |
| `basic-auth-url` | `https://user:pass@host` |
| `auth-header` | `Bearer <token>` / `Basic <token>` |

## Caveats

- **Fill in `secrets.env` with your real secrets.** The pattern list is a generic net;
  exact-value redaction (layers 2 and 3) only applies to what you list.
- **The model can still reason about a secret it has seen.** Blocking stops the command,
  but if a value was already in context, the model can derive or echo it (e.g. base64-
  encode a credential in its explanation). Don't put real secrets into a chat at all.
- **Layer 3 redacts what is *sent*, not what was already *persisted*.** A secret typed
  into a message is stored on disk before layer 3 runs. Layers 1–2 prevent the common
  paths; layer 3 is a safety net for the provider, not a disk scrub.
- **False positives are possible** on the generic patterns. If the guard blocks
  something legitimate, reword the command to reference an env var.
