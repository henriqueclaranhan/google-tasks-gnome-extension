import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";

import type { OAuthTokenResponse } from "../types/google-tasks.js";



const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_SCOPE = ["https://www.googleapis.com/auth/tasks", "openid", "email", "profile"].join(" ");
const REQUEST_TIMEOUT_SECONDS = 20;

/**
 * GJS does not provide the browser's URLSearchParams global. OAuth uses the
 * application/x-www-form-urlencoded format for both query strings and token
 * request bodies, so keep its encoding and decoding in one small helper.
 */
function encodeFormParameters(parameters: Record<string, string>): string {
	return Object.entries(parameters)
		.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(/%20/g, "+")}`)
		.join("&");
}

function getQueryParameter(query: string, name: string): string | null {
	for (const parameter of query.split("&")) {
		const separator = parameter.indexOf("=");
		const rawKey = separator === -1 ? parameter : parameter.slice(0, separator);
		if (decodeURIComponent(rawKey.replace(/\+/g, " ")) !== name) {
			continue;
		}

		const rawValue = separator === -1 ? "" : parameter.slice(separator + 1);
		return decodeURIComponent(rawValue.replace(/\+/g, " "));
	}

	return null;
}

export class GoogleOAuthCallbackServer {
	private readonly server = new Soup.Server();
	private resolveCode: ((code: string | null) => void) | null = null;
	private completedCode: string | null | undefined;
	readonly redirectUri: string;

	constructor() {
		this.server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
		const uri = this.server.get_uris()[0];
		if (!uri) {
			this.server.disconnect();
			throw new Error("Could not start the local OAuth callback server.");
		}

		this.redirectUri = `http://127.0.0.1:${uri.get_port()}/`;
		this.server.add_handler("/", (_server, message) => {
			const code = getQueryParameter(message.get_uri().get_query() ?? "", "code");
			const succeeded = code !== null;
			message.set_status(succeeded ? 200 : 400, null);
			message
				.get_response_body()
				.append_bytes(
					new GLib.Bytes(
						succeeded
							? "Success! You can close this window and return to the extension settings."
							: "Failed to get authorization code.",
					),
				);
			this.finish(code);
		});
	}

	waitForCode(): Promise<string | null> {
		if (this.completedCode !== undefined) {
			return Promise.resolve(this.completedCode);
		}

		return new Promise((resolve) => {
			this.resolveCode = resolve;
		});
	}

	cancel(): void {
		this.finish(null);
	}

	close(): void {
		this.server.disconnect();
	}

	private finish(code: string | null): void {
		if (this.resolveCode) {
			this.resolveCode(code);
		} else {
			this.completedCode = code;
		}
		this.resolveCode = null;
	}
}

export default class GoogleOAuthClient {
	private readonly session = new Soup.Session({ timeout: REQUEST_TIMEOUT_SECONDS });

	getAuthorizationUrl(clientId: string, redirectUri: string): string {
		const parameters = encodeFormParameters({
			client_id: clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: OAUTH_SCOPE,
			access_type: "offline",
			prompt: "consent",
		});

		return `${OAUTH_AUTHORIZE_URL}?${parameters}`;
	}

	async exchangeAuthorizationCode(
		clientId: string,
		clientSecret: string,
		code: string,
		redirectUri: string,
	): Promise<OAuthTokenResponse> {
		return this.requestToken({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri,
			grant_type: "authorization_code",
		});
	}

	async refreshAccessToken(
		clientId: string,
		clientSecret: string,
		refreshToken: string,
	): Promise<OAuthTokenResponse> {
		return this.requestToken({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: "refresh_token",
		});
	}

	private async requestToken(parameters: Record<string, string>): Promise<OAuthTokenResponse> {
		const message = Soup.Message.new("POST", OAUTH_TOKEN_URL);
		const body = new GLib.Bytes(encodeFormParameters(parameters));
		message.set_request_body_from_bytes("application/x-www-form-urlencoded", body);

		const responseBytes = await new Promise<GLib.Bytes>((resolve, reject) => {
			let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
				timeoutId = 0;
				reject(new Error("Request timed out after 15 seconds"));
				return GLib.SOURCE_REMOVE;
			});
			this.session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, res) => {
				if (timeoutId) GLib.source_remove(timeoutId);
				try {
					const bytes = session!.send_and_read_finish(res);
					resolve(bytes);
				} catch (e) {
					reject(e);
				}
			});
		});
		const responseText = new TextDecoder().decode(responseBytes.get_data()!);
		const response = responseText ? (JSON.parse(responseText) as OAuthTokenResponse) : {};

		if (message.get_status() < 200 || message.get_status() >= 300) {
			throw new Error(
				response.error_description ?? response.error ?? `OAuth request failed: ${message.get_status()}`,
			);
		}

		return response;
	}
}
