#!/usr/bin/env bun
/**
 * Demo simulator for artifacts-lee-skills.
 *
 * Runs against a LIVE deployed Worker (set BASE_URL) or a local `wrangler dev`
 * (default: http://127.0.0.1:8787).
 *
 * Story:
 *   1. Bootstrap all team repos (POST /bootstrap)
 *   2. Team "database" mints a write token + pushes a skill
 *   3. Team "network" mints a write token + pushes a skill
 *   4. "Agent" mints read tokens for all teams + clones each, prints consolidated skills
 *
 * Requirements: `git` on PATH, write access to `/tmp/`.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const AGENT_TOKEN = process.env.AGENT_TOKEN ?? "demo-agent-token";
const TEAM_DATABASE_TOKEN = process.env.TEAM_DATABASE_TOKEN ?? "demo-team-database-token";
const TEAM_NETWORK_TOKEN = process.env.TEAM_NETWORK_TOKEN ?? "demo-team-network-token";
const TEAM_SECURITY_TOKEN = process.env.TEAM_SECURITY_TOKEN ?? "demo-team-security-token";

const SCRATCH = resolve("/tmp/artifacts-lee-skills-demo");

function log(title: string, body: string | object) {
	console.log(`\n── ${title} ──`);
	console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): SpawnSyncReturns<string> {
	const result = spawnSync(cmd, args, {
		cwd: opts.cwd,
		env: { ...process.env, ...(opts.env ?? {}) },
		encoding: "utf8",
	});
	if (result.status !== 0) {
		console.error(`✗ ${cmd} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
	}
	return result;
}

async function fetchJson(path: string, init?: RequestInit) {
	const r = await fetch(`${BASE_URL}${path}`, init);
	const text = await r.text();
	try {
		return { status: r.status, body: JSON.parse(text) };
	} catch {
		return { status: r.status, body: text };
	}
}

async function bootstrap() {
	log("1. POST /bootstrap — ensure all team repos exist", "…");
	const res = await fetchJson("/bootstrap", { method: "POST" });
	log("bootstrap result", res.body);
	return res.body;
}

async function teamPush(slug: "database" | "network" | "security", skillFile: string, skillContent: string, teamToken: string) {
	log(`2. team "${slug}" → mint write token + git push ${skillFile}`, "…");
	const tokenRes = await fetchJson(`/team/${slug}/write-token`, {
		method: "POST",
		headers: { Authorization: `Bearer ${teamToken}` },
	});
	if (tokenRes.status !== 200) {
		log(`  ✗ failed to mint write token`, tokenRes.body);
		return;
	}
	const { remote, token } = tokenRes.body as { remote: string; token: string };
	log(`  ✓ got write token for ${remote}`, { tokenPrefix: token.slice(0, 24) + "…" });

	const workDir = resolve(SCRATCH, `push-${slug}`);
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(workDir, { recursive: true });

	run("git", ["init", "-b", "main"], { cwd: workDir });
	run("git", ["config", "user.email", `${slug}@lee.example`], { cwd: workDir });
	run("git", ["config", "user.name", `${slug}-team`], { cwd: workDir });

	writeFileSync(resolve(workDir, skillFile), skillContent);
	run("git", ["add", skillFile], { cwd: workDir });
	run("git", ["commit", "-m", `add ${skillFile}`], { cwd: workDir });

	// Use extraHeader for auth so the token never lives in the remote URL
	const pushResult = run(
		"git",
		[
			"-c",
			`http.extraHeader=Authorization: Bearer ${token}`,
			"push",
			"--force",
			remote,
			"HEAD:main",
		],
		{ cwd: workDir },
	);
	if (pushResult.status === 0) {
		log(`  ✓ pushed ${skillFile} to ${remote}`, pushResult.stdout || pushResult.stderr);
	} else {
		log(`  ✗ push failed`, pushResult.stderr);
	}
}

async function agentReadAll() {
	log("4. agent → mint read tokens for all teams + clone each", "…");
	const tokensRes = await fetchJson("/agent/read-tokens", {
		method: "POST",
		headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
	});
	if (tokensRes.status !== 200) {
		log(`  ✗ failed to mint read tokens`, tokensRes.body);
		return;
	}
	const { teams } = tokensRes.body as {
		teams: Array<{ slug: string; remote: string; token: string }>;
	};

	const skills: Record<string, string[]> = {};
	for (const t of teams) {
		const targetDir = resolve(SCRATCH, `agent-read-${t.slug}`);
		rmSync(targetDir, { recursive: true, force: true });
		const cloneResult = run(
			"git",
			[
				"-c",
				`http.extraHeader=Authorization: Bearer ${t.token}`,
				"clone",
				"--depth",
				"1",
				t.remote,
				targetDir,
			],
		);
		if (cloneResult.status !== 0) {
			skills[t.slug] = [`(clone failed: ${cloneResult.stderr.slice(0, 120).trim()})`];
			continue;
		}
		// Read every markdown skill in the cloned repo
		const { readdirSync, statSync } = await import("node:fs");
		const collected: string[] = [];
		const walk = (dir: string) => {
			if (!existsSync(dir)) return;
			for (const entry of readdirSync(dir)) {
				if (entry.startsWith(".git")) continue;
				const full = resolve(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else if (entry.endsWith(".md")) {
					collected.push(`### ${entry}\n${readFileSync(full, "utf8").trim()}`);
				}
			}
		};
		walk(targetDir);
		skills[t.slug] = collected.length ? collected : ["(no skill files found)"];
	}

	log("5. CONSOLIDATED SKILLS (agent's context on next run)", "");
	for (const [slug, entries] of Object.entries(skills)) {
		console.log(`\n## ${slug} team skills\n`);
		for (const entry of entries) console.log(entry, "\n");
	}
}

async function main() {
	console.log(`artifacts-lee-skills demo against ${BASE_URL}`);
	mkdirSync(SCRATCH, { recursive: true });

	await bootstrap();
	await teamPush(
		"database",
		"slow-query.md",
		`# Slow Query Triage

When a user reports a slow query, ask for:
- The exact query text
- The database size
- Whether EXPLAIN ANALYZE has been run

Then recommend indexing strategy based on WHERE clauses.
`,
		TEAM_DATABASE_TOKEN,
	);
	await teamPush(
		"network",
		"dns-resolution.md",
		`# DNS Resolution Issues

For DNS problems, check:
1. \`dig +trace\` output
2. Resolver chain (/etc/resolv.conf, systemd-resolved, etc.)
3. Whether the zone is authoritative locally
`,
		TEAM_NETWORK_TOKEN,
	);
	await teamPush(
		"security",
		"secrets-leaked.md",
		`# Secrets Leaked

If secrets are suspected leaked:
1. Rotate the secret immediately
2. Audit git log for when it was committed
3. Check access logs for unauthorized use
4. File incident ticket
`,
		TEAM_SECURITY_TOKEN,
	);

	await agentReadAll();

	console.log("\n✓ demo complete\n");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
