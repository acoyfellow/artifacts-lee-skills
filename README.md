# artifacts-lee-skills

Team-editable agent skills, stored as [Cloudflare Artifacts](https://developers.cloudflare.com/artifacts/) repos.

Each team gets their own namespace. Push skills with `git push`. Agent reads with `git clone`. No PR, no deploy, no bottleneck through the agent maintainer.

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

One namespace per team. One `skills` repo per team, containing markdown. Write tokens live 1 hour. Read tokens live 15 minutes.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | — | Route index |
| `GET` | `/status` | — | List team repos + remotes |
| `POST` | `/bootstrap` | — | Create all team repos (idempotent) |
| `POST` | `/team/:slug/write-token` | `TEAM_<SLUG>_TOKEN` | 1h write token for a team's repo |
| `POST` | `/agent/read-tokens` | `AGENT_TOKEN` | 15m read tokens for every team |

## Run

```bash
bun install
bun run demo  # simulates 3 teams pushing + agent reading
```

Setup + deployment: see [`RUNNING.md`](./RUNNING.md).

Live Worker: [`artifacts-lee-skills.cloudflare-support-chat.workers.dev`](https://artifacts-lee-skills.cloudflare-support-chat.workers.dev) (returns `server not configured` until secrets are set).

## Status

Live and working against Artifacts. Demo run 2026-04-20 pushed + cloned real skill files through three Artifacts namespaces.

[Artifacts is in private beta](https://blog.cloudflare.com/artifacts-git-for-agents-beta/) as of 2026-04-16; public beta targeted for early May 2026. The Workers binding (`env.ARTIFACTS`) exists on the Cloudflare runtime per the announcement blog, but `wrangler@4.83` silently drops the `artifacts:` config block, so `env.ARTIFACTS` is `undefined` at runtime. Until wrangler catches up, this PoC uses the REST API — `src/artifacts-client.ts`. Swap it for native binding calls when the config plumbing ships.

## License

MIT
