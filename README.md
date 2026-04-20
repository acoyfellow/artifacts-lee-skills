# artifacts-lee-skills

Team-editable agent skills, stored as [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repos.

Each team gets their own namespace. They push skills with `git push`. The agent reads them with `git clone`. No PR, no deploy, no coordination through the agent maintainer.

## The pattern

```
     database          network          security
        │                 │                 │
        │ git push        │ git push        │ git push
        ▼                 ▼                 ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │  repo   │       │  repo   │       │  repo   │
   │(db ns)  │       │(net ns) │       │(sec ns) │
   └────┬────┘       └────┬────┘       └────┬────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          │
                       git clone
                    (read tokens)
                          │
                          ▼
                        agent
```

- One Artifacts namespace per team.
- One repo per team, named `skills`, containing markdown files.
- Write tokens are minted per push, 1-hour TTL.
- Read tokens are minted per agent read, 15-minute TTL.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | — | Route index |
| GET | `/status` | — | List team repos + remotes |
| POST | `/bootstrap` | — (demo; add auth in prod) | Create all team repos (idempotent) |
| POST | `/team/:slug/write-token` | Bearer `TEAM_<SLUG>_TOKEN` | Mint a 1h write token for a team's repo |
| POST | `/agent/read-tokens` | Bearer `AGENT_TOKEN` | Mint 15m read tokens for every team |

## Status

Worker typechecks clean and runs locally. Live against Artifacts needs a real Cloudflare API token with `Artifacts:Read` + `Artifacts:Write` scopes (OAuth tokens from `wrangler login` don't include those scopes yet — create one in the dashboard).

Artifacts is beta. As of `wrangler@4.83`, the Workers binding (`env.ARTIFACTS`) isn't in the wrangler config schema, so this PoC uses the Artifacts REST API. When the binding ships, swap `src/artifacts-client.ts` for native binding calls — the rest of the Worker stays the same.

## Run

```bash
bun install

wrangler secret put CLOUDFLARE_ACCOUNT_ID    # your account id
wrangler secret put CLOUDFLARE_API_TOKEN     # token with Artifacts scopes
wrangler secret put AGENT_TOKEN              # any random string
wrangler secret put TEAM_DATABASE_TOKEN
wrangler secret put TEAM_NETWORK_TOKEN
wrangler secret put TEAM_SECURITY_TOKEN

wrangler dev
```

In another terminal:

```bash
bun run demo
```

The simulator:

1. Bootstraps the three team repos
2. Pushes a skill file from each team using a freshly-minted write token
3. Mints read tokens, clones all three repos, and prints the consolidated skills the agent would see

## What changes in production

The demo leans on shared bearer tokens per team because it's the simplest thing that works. A production version would replace them with:

- Cloudflare Access in front of team endpoints, so only members of a team's Access group can mint a write token for that team's namespace
- A service binding or mTLS between the agent and the Worker for `/agent/read-tokens`
- A signed JWT or Workers Secret for the agent's shared secret

A few features this PoC skips that a real deployment probably wants:

- KV cache of the consolidated skills with a short TTL, so the agent isn't re-cloning on every request
- A webhook from Artifacts (when available) that busts the cache on push
- Per-file access control inside a namespace
- Signed commits, verified before the agent loads the skills

## Why this works well on Artifacts

- Per-repo isolation — one team's push can't touch another team's repo
- Repo-scoped tokens with configurable TTL — small blast radius
- Standard git protocol — teams use whatever editor they already use
- Durable + replicated — no git server to operate
- Fork primitive — teams can propose changes to each other's skills via fork + "patch" repo

## License

MIT
