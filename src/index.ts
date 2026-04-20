/**
 * artifacts-lee-skills — team-editable skills for Lee-style agents.
 *
 * Pattern:
 *   - One Artifacts namespace per team (database, network, security, ...)
 *   - One Artifacts repo per team's skills bundle (named "skills")
 *   - Team members mint short-lived write tokens via /team/:slug/write-token
 *     (gated by a team-shared bearer in demo; swap to Access / OIDC in prod)
 *   - Team pushes markdown files via standard `git push` with Bearer auth
 *   - Agent mints read tokens via /agent/read-tokens
 *     (gated by the AGENT_TOKEN shared secret)
 *   - Agent clones all team repos in parallel, merges skills into context
 *
 * What you get: teams edit prompts/skills/rubrics in their own editor, push,
 * agent picks up on next read. No PR to the agent's main repo. No deploy.
 *
 * This is the proof-of-concept for "Git as memory" + Artifacts as the substrate.
 *
 * Talks to Cloudflare via the Artifacts REST API (the Workers binding isn't in
 * wrangler@4.83 yet). When it lands, swap src/artifacts-client.ts for native binding calls.
 */

import { ArtifactsClient } from "./artifacts-client.js";

interface Env {
	DEMO_MODE: string;
	NAMESPACE_DATABASE: string;
	NAMESPACE_NETWORK: string;
	NAMESPACE_SECURITY: string;
	CLOUDFLARE_ACCOUNT_ID: string;
	CLOUDFLARE_API_TOKEN: string;
	AGENT_TOKEN?: string;
	TEAM_DATABASE_TOKEN?: string;
	TEAM_NETWORK_TOKEN?: string;
	TEAM_SECURITY_TOKEN?: string;
}

// ---- Team configuration ----

const TEAMS = {
	database: { namespaceVar: "NAMESPACE_DATABASE" as const, secretVar: "TEAM_DATABASE_TOKEN" as const },
	network: { namespaceVar: "NAMESPACE_NETWORK" as const, secretVar: "TEAM_NETWORK_TOKEN" as const },
	security: { namespaceVar: "NAMESPACE_SECURITY" as const, secretVar: "TEAM_SECURITY_TOKEN" as const },
} as const;

type TeamSlug = keyof typeof TEAMS;

const SKILLS_REPO_NAME = "skills";

// ---- Helpers ----

function json(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body, null, 2), {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers || {}) },
	});
}

function isTeam(slug: string): slug is TeamSlug {
	return slug in TEAMS;
}

function clientForTeam(env: Env, slug: TeamSlug): ArtifactsClient {
	const namespace = env[TEAMS[slug].namespaceVar];
	return new ArtifactsClient({
		accountId: env.CLOUDFLARE_ACCOUNT_ID,
		apiToken: env.CLOUDFLARE_API_TOKEN,
		namespace,
	});
}

function requireBearer(request: Request, expected: string | undefined): Response | null {
	if (!expected) {
		return json({ error: "server not configured (missing shared secret)" }, { status: 500 });
	}
	const auth = request.headers.get("authorization") ?? "";
	const match = auth.match(/^Bearer\s+(.+)$/i);
	if (!match || match[1] !== expected) {
		return json({ error: "unauthorized" }, { status: 401 });
	}
	return null;
}

function requireAccountConfigured(env: Env): Response | null {
	if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
		return json(
			{
				error: "server not configured",
				hint: "Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN via `wrangler secret put`",
			},
			{ status: 500 },
		);
	}
	return null;
}

// ---- Core operations ----

async function ensureTeamRepo(env: Env, slug: TeamSlug) {
	const client = clientForTeam(env, slug);
	return client.ensureRepo(SKILLS_REPO_NAME, `Lee skills bundle for team: ${slug}`);
}

async function mintWriteToken(env: Env, slug: TeamSlug) {
	const client = clientForTeam(env, slug);
	const info = await client.ensureRepo(SKILLS_REPO_NAME, `Lee skills bundle for team: ${slug}`);
	const tokenResult = await client.createToken({
		repo: SKILLS_REPO_NAME,
		scope: "write",
		ttl: 3600,
	});
	const remote = info.remote ?? "";
	return {
		team: slug,
		repo: SKILLS_REPO_NAME,
		remote,
		token: tokenResult.plaintext,
		expiresAt: tokenResult.expires_at,
		pushHint: remote
			? `git -c http.extraHeader="Authorization: Bearer ${tokenResult.plaintext}" push ${remote} HEAD:main`
			: null,
	};
}

async function mintReadTokensForAgent(env: Env) {
	const results: Array<{
		slug: TeamSlug;
		remote: string;
		token: string;
		expiresAt: string;
		cloneHint: string;
	}> = [];

	for (const slug of Object.keys(TEAMS) as TeamSlug[]) {
		const client = clientForTeam(env, slug);
		const info = await client.ensureRepo(SKILLS_REPO_NAME, `Lee skills bundle for team: ${slug}`);
		const tokenResult = await client.createToken({
			repo: SKILLS_REPO_NAME,
			scope: "read",
			ttl: 900,
		});
		const remote = info.remote ?? "";
		results.push({
			slug,
			remote,
			token: tokenResult.plaintext,
			expiresAt: tokenResult.expires_at,
			cloneHint: remote
				? `git -c http.extraHeader="Authorization: Bearer ${tokenResult.plaintext}" clone --depth 1 ${remote} /tmp/${slug}`
				: "(no remote)",
		});
	}

	return { teams: results, mintedAt: new Date().toISOString() };
}

async function status(env: Env) {
	const out: Record<string, unknown> = {};
	for (const slug of Object.keys(TEAMS) as TeamSlug[]) {
		try {
			const info = await ensureTeamRepo(env, slug);
			out[slug] = info;
		} catch (e) {
			out[slug] = { error: String((e as Error).message) };
		}
	}
	return {
		namespaces: Object.fromEntries(
			(Object.keys(TEAMS) as TeamSlug[]).map((s) => [s, env[TEAMS[s].namespaceVar]]),
		),
		repos: out,
	};
}

// ---- Worker fetch handler ----

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method;
		const path = url.pathname;

		// GET / — index
		if (method === "GET" && path === "/") {
			return json({
				name: "artifacts-lee-skills",
				description: "Team-editable Lee skills via Cloudflare Artifacts",
				routes: [
					"GET  /                            — this page",
					"GET  /status                      — list team repos + remotes",
					"POST /team/:slug/write-token      — mint a 1h write token (Bearer: team secret)",
					"POST /agent/read-tokens           — mint 15min read tokens for all teams (Bearer: AGENT_TOKEN)",
					"POST /bootstrap                   — idempotently create all team repos",
				],
				teams: Object.keys(TEAMS),
				demo: env.DEMO_MODE === "true",
			});
		}

		// GET /status
		if (method === "GET" && path === "/status") {
			const err = requireAccountConfigured(env);
			if (err) return err;
			return json(await status(env));
		}

		// POST /bootstrap — ensure all team repos exist
		if (method === "POST" && path === "/bootstrap") {
			const err = requireAccountConfigured(env);
			if (err) return err;
			const results: Record<string, unknown> = {};
			for (const slug of Object.keys(TEAMS) as TeamSlug[]) {
				try {
					results[slug] = await ensureTeamRepo(env, slug);
				} catch (e) {
					results[slug] = { error: String((e as Error).message) };
				}
			}
			return json({ bootstrapped: results });
		}

		// POST /team/:slug/write-token
		const teamMatch = path.match(/^\/team\/([a-z0-9_-]+)\/write-token$/);
		if (method === "POST" && teamMatch) {
			const slug = teamMatch[1]!;
			if (!isTeam(slug)) {
				return json(
					{ error: `unknown team: ${slug}`, valid: Object.keys(TEAMS) },
					{ status: 404 },
				);
			}
			const err = requireAccountConfigured(env);
			if (err) return err;
			const teamSecret = env[TEAMS[slug].secretVar];
			const authError = requireBearer(request, teamSecret);
			if (authError) return authError;
			try {
				return json(await mintWriteToken(env, slug));
			} catch (e) {
				return json({ error: String((e as Error).message) }, { status: 500 });
			}
		}

		// POST /agent/read-tokens
		if (method === "POST" && path === "/agent/read-tokens") {
			const err = requireAccountConfigured(env);
			if (err) return err;
			const authError = requireBearer(request, env.AGENT_TOKEN);
			if (authError) return authError;
			try {
				return json(await mintReadTokensForAgent(env));
			} catch (e) {
				return json({ error: String((e as Error).message) }, { status: 500 });
			}
		}

		return json({ error: "not found" }, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
