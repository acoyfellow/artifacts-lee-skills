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

## Status

Local Worker works. Live against Artifacts needs an API token with Artifacts scopes (see [`RUNNING.md`](./RUNNING.md)). Artifacts is beta — this PoC uses the REST API because the Workers binding isn't in wrangler yet.

## License

MIT
