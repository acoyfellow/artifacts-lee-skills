/**
 * Thin client for the Cloudflare Artifacts REST API.
 *
 * We use REST (not the Workers binding) because the binding is not yet in
 * wrangler@4.83. When wrangler ships the `artifacts` config schema, swap these
 * calls for `env.ARTIFACTS.create(...)` etc. — behavior is identical.
 *
 * Base URL:
 *   https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/artifacts/namespaces/<NAMESPACE>
 */

export interface ArtifactsClientOpts {
	accountId: string;
	apiToken: string;
	namespace: string;
}

export interface RepoInfo {
	id: string;
	name: string;
	description: string | null;
	default_branch: string;
	created_at: string;
	updated_at: string;
	last_push_at: string | null;
	source: string | null;
	read_only: boolean;
	remote?: string;
}

export interface CreateRepoResult {
	id: string;
	name: string;
	description: string | null;
	default_branch: string;
	remote: string;
	token: string;
}

export interface CreateTokenResult {
	id: string;
	plaintext: string;
	scope: "read" | "write";
	expires_at: string;
}

interface ApiEnvelope<T> {
	result: T | null;
	success: boolean;
	errors: Array<{ code: number; message: string }>;
	messages: Array<{ code: number; message: string }>;
}

export class ArtifactsClient {
	private readonly base: string;
	private readonly auth: string;

	constructor(private readonly opts: ArtifactsClientOpts) {
		this.base = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/artifacts/namespaces/${opts.namespace}`;
		this.auth = `Bearer ${opts.apiToken}`;
	}

	private async call<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const r = await fetch(`${this.base}${path}`, {
			method,
			headers: {
				Authorization: this.auth,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		const env = (await r.json()) as ApiEnvelope<T>;
		if (!env.success || env.result === null) {
			const first = env.errors?.[0];
			throw new Error(
				`Artifacts ${method} ${path} → ${r.status}: ${first?.message ?? "unknown error"} (code ${first?.code ?? "?"})`,
			);
		}
		return env.result;
	}

	async createRepo(params: {
		name: string;
		description?: string;
		default_branch?: string;
		read_only?: boolean;
	}): Promise<CreateRepoResult> {
		return this.call<CreateRepoResult>("POST", "/repos", params);
	}

	async getRepo(name: string): Promise<RepoInfo> {
		return this.call<RepoInfo>("GET", `/repos/${encodeURIComponent(name)}`);
	}

	async createToken(params: {
		repo: string;
		scope?: "read" | "write";
		ttl?: number;
	}): Promise<CreateTokenResult> {
		return this.call<CreateTokenResult>("POST", "/tokens", params);
	}

	/** Idempotent: get or create a repo with the given name. */
	async ensureRepo(name: string, description?: string): Promise<RepoInfo> {
		try {
			return await this.getRepo(name);
		} catch (e) {
			const msg = String((e as Error).message).toLowerCase();
			// 404 / not found path — create
			if (msg.includes("404") || msg.includes("not found") || msg.includes("does not exist")) {
				const created = await this.createRepo({
					name,
					...(description ? { description } : {}),
					default_branch: "main",
				});
				// createRepo result doesn't include all RepoInfo fields; fetch to normalize
				return await this.getRepo(name);
			}
			throw e;
		}
	}
}
