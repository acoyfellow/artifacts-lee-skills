# artifacts-lee-skills

**Team-editable agent skills, powered by Cloudflare Artifacts.**

> Each team owns their namespace.
> Teams push skills with `git push`.
> Agent reads skills with `git clone`.
> No PR. No deploy. No bottleneck.

This is a proof-of-concept for treating [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) as the substrate for "git as agent memory" — specifically the problem where many teams inside a company need to update an agent's system prompts / skills / rubrics without going through the agent maintainer.

## The pattern

```
  Database team       Network team       Security team
       │                    │                    │
       │  git push          │  git push          │  git push
       ▼                    ▼                    ▼
  Artifacts repo      Artifacts repo      Artifacts repo
  (lee-skills-         (lee-skills-        (lee-skills-
   database/skills)     network/skills)    security/skills)
       │                    │                    │
       └──────────┬─────────┴──────────┬─────────┘
                  │                    │
             git clone (read token)
                  │
                  ▼
              Lee agent
         (reads all team skills
          into context on boot)
```

- **Namespaces**: one per team. `lee-skills-database`, `lee-skills-network`, `lee-skills-security`
- **Repos**: one per team, named `skills`. Contains markdown files.
- **Write tokens**: minted per push by this Worker, 1-hour TTL. Teams authenticate with a per-team shared bearer (demo) or Access / OIDC (prod).
- **Read tokens**: minted per agent-read, 15-minute TTL. Agent authenticates with the `AGENT_TOKEN` shared secret.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | public | Route index |
| GET | `/status` | public | List team repos + remotes |
| POST | `/bootstrap` | public (demo only; add auth in prod) | Idempotently create all team repos |
| POST | `/team/:slug/write-token` | Bearer `TEAM_<SLUG>_TOKEN` | Mint 1h write token for team's skills repo |
| POST | `/agent/read-tokens` | Bearer `AGENT_TOKEN` | Mint 15min read tokens for all teams |

## Status — 2026-04-20

**Worker code is written and typechecks clean.** Live verification blocked on needing a real Cloudflare API token with Artifacts scopes.

Artifacts is beta. As of `wrangler@4.83`:
- The Workers **binding** (`env.ARTIFACTS`) isn't in the wrangler config schema yet → this PoC talks to Artifacts via **REST API** instead.
- **OAuth tokens from `wrangler login` don't include Artifacts scopes** → you need a real API token created in the dashboard with `Artifacts:Read + Artifacts:Write`.

When the binding ships: swap `src/artifacts-client.ts` REST calls for native binding calls. Worker code stays the same otherwise.

## Run locally

Prerequisites:
1. A Cloudflare API token with `Artifacts:Read` + `Artifacts:Write` scopes (create via dashboard)
2. Your account ID

```bash
bun install

# Required: Cloudflare API auth
wrangler secret put CLOUDFLARE_ACCOUNT_ID    # your account ID
wrangler secret put CLOUDFLARE_API_TOKEN     # API token with Artifacts scopes

# Demo: per-team bearers (swap for Access/OIDC in prod)
wrangler secret put AGENT_TOKEN              # e.g. "demo-agent-token"
wrangler secret put TEAM_DATABASE_TOKEN      # e.g. "demo-team-database-token"
wrangler secret put TEAM_NETWORK_TOKEN       # e.g. "demo-team-network-token"
wrangler secret put TEAM_SECURITY_TOKEN      # e.g. "demo-team-security-token"

wrangler dev
```

## Run the demo

In a second terminal:

```bash
bun run demo
```

The simulator will:

1. Bootstrap all 3 team repos (idempotent)
2. Simulate the database team pushing `slow-query.md`
3. Simulate the network team pushing `dns-resolution.md`
4. Simulate the security team pushing `secrets-leaked.md`
5. Mint read tokens for the agent
6. Clone all 3 repos in parallel
7. Print the consolidated skills the agent would load into context

## Real-world deployment

Replace the demo bearer tokens with:

- **Cloudflare Access** for the team endpoints — only users in the DB team's Access group can mint `team/database/write-token`
- **Service bindings** or **mTLS** between the agent runtime and this Worker for `/agent/read-tokens`
- **Scoped bearer or signed JWT** via Workers Secrets for the agent's shared secret

Production improvements (not in this PoC):

- Cache the agent's consolidated skills in KV with a short TTL (e.g. 60s) to avoid re-cloning on every request
- Expose a webhook from Artifacts (when available) so the agent invalidates cache on push
- Per-file access control (some skills are restricted even within the team namespace)
- Observability: log who pushed what, when
- Signed commits: teams push with signed tags/commits; agent verifies before loading skills

## What this demo proves

**The bottleneck problem is solved.** When the database team needs to update `slow-query.md`, they do not:

- Open a PR against the Lee main repo
- Wait for review by a Lee maintainer
- Wait for CI to pass
- Wait for deploy
- Coordinate with other teams

They do:

```bash
git -c http.extraHeader="Authorization: Bearer $TOKEN" \
  push https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/lee-skills-database/skills.git \
  HEAD:main
```

Lee picks it up on the next agent cycle.

## Why Artifacts is the right primitive for this

- **Per-repo isolation**: the database team's pushes cannot affect the network team's skills
- **Token scoping**: write tokens are per-repo, per-scope, per-TTL — no blast radius
- **Git protocol**: teams use the tools they already use
- **Workers binding**: the agent's read path stays on Cloudflare infra, no egress
- **Durable replication**: no ops burden to run a git server
- **Forkable**: if a team wants to propose a change to another team's skills, they fork and send a "patch" repo

## Status

v0.0.1. Not production. Written 2026-04-19 as a proof-of-concept. See `.context/CF-ARTIFACTS-PRIMITIVE.md` (in Jordan's personal context) for the thinking that produced this.

## License

MIT
