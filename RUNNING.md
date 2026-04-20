# Running artifacts-lee-skills

Setup, secrets, and production notes. The main [README](./README.md) covers the pattern.

## Prerequisites

- Cloudflare account with Artifacts access
- API token with `Artifacts:Read` + `Artifacts:Write` scopes (dashboard; OAuth tokens from `wrangler login` don't carry these scopes yet)
- Bun

## Secrets

```bash
bun install

wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put AGENT_TOKEN              # any random string
wrangler secret put TEAM_DATABASE_TOKEN
wrangler secret put TEAM_NETWORK_TOKEN
wrangler secret put TEAM_SECURITY_TOKEN
```

## Local dev

```bash
wrangler dev
```

Then in another terminal:

```bash
bun run demo
```

The simulator:
1. Bootstraps the three team repos
2. Pushes a skill file from each team
3. Mints read tokens, clones all three repos, prints the consolidated skills

## Deploy

```bash
wrangler deploy
```

## What changes in production

The demo leans on shared bearer tokens per team. A real deployment would replace them with:

- Cloudflare Access in front of team endpoints, so only members of a team's Access group can mint a write token for that team's namespace
- A service binding or mTLS between the agent and the Worker for `/agent/read-tokens`
- A signed JWT or Workers Secret for the agent's shared secret

Features this PoC skips that a real deployment probably wants:

- KV cache of the consolidated skills with a short TTL, so the agent isn't re-cloning on every request
- A webhook from Artifacts (when available) that busts the cache on push
- Per-file access control inside a namespace
- Signed commits, verified before the agent loads the skills

## Swap path to native binding

When `wrangler` adds the Artifacts binding to its config schema, swap `src/artifacts-client.ts` for native `env.ARTIFACTS` calls. The Worker's routes and business logic stay the same.

## Why this works well on Artifacts

- Per-repo isolation — one team's push can't touch another team's repo
- Repo-scoped tokens with configurable TTL — small blast radius
- Standard git protocol — teams use whatever editor they already use
- Durable + replicated — no git server to operate
- Fork primitive — teams can propose changes via fork + patch repo
