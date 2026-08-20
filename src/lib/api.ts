import Gio from "gi://Gio";
import Soup from "gi://Soup?version=3.0";
import GLib from "gi://GLib";

import GoogleOAuthClient from "./auth.js";
import type {
	GoogleTask,
	GoogleTaskList,
	GoogleTaskListsResponse,
	GoogleTasksResponse,
	GoogleUserInfo,
} from "../types/google-tasks.js";



export type { GoogleTask, GoogleTaskList } from "../types/google-tasks.js";

export default class GoogleTasksAPI {
	private static readonly REQUEST_TIMEOUT_SECONDS = 20;
	private _settings: Gio.Settings;
	private _session: Soup.Session;
	private readonly _baseUrl = "https://tasks.googleapis.com/tasks/v1";
	private readonly _userInfoUrl = "https://openidconnect.googleapis.com/v1/userinfo";
	private readonly _oauth = new GoogleOAuthClient();

	constructor(settings: Gio.Settings) {
		this._settings = settings;
		// Without an explicit timeout a stalled DNS, proxy, or TLS connection can leave the panel showing its loading state indefinitely
		this._session = new Soup.Session({ timeout: GoogleTasksAPI.REQUEST_TIMEOUT_SECONDS });
	}

	get clientId() {
		return this._settings.get_string("client-id").trim();
	}

	get clientSecret() {
		return this._settings.get_string("client-secret").trim();
	}

	get accessToken() {
		return this._settings.get_string("access-token");
	}

	set accessToken(val: string) {
		this._settings.set_string("access-token", val);
	}

	get refreshToken() {
		return this._settings.get_string("refresh-token");
	}

	set refreshToken(val: string) {
		this._settings.set_string("refresh-token", val);
	}

	isConfigured() {
		return this.clientId !== "" && this.clientSecret !== "";
	}

	isAuthenticated() {
		return this.refreshToken !== "" || this.accessToken !== "";
	}

	private async _request<T>(method: string, url: string, body: object | null = null): Promise<T> {
		if (!this.isAuthenticated()) {
			throw new Error("Not authenticated");
		}

		if (this.accessToken === "") {
			await this.refreshAccessToken();
		}

		let msg = this._createRequest(method, url, body);

		const executeRequest = () => new Promise<GLib.Bytes>((resolve, reject) => {
			let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
				timeoutId = 0;
				reject(new Error("Request timed out after 15 seconds"));
				return GLib.SOURCE_REMOVE;
			});
			this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, res) => {
				if (timeoutId) GLib.source_remove(timeoutId);
				try {
					resolve(session!.send_and_read_finish(res));
				} catch (e) {
					reject(e);
				}
			});
		});

		let bytes = await executeRequest();

		if (msg.get_status() === 401) {
			await this.refreshAccessToken();
			msg = this._createRequest(method, url, body);
			bytes = await executeRequest();
		}

		const responseString = new TextDecoder().decode(bytes.get_data()!);
		if (msg.get_status() < 200 || msg.get_status() >= 300) {
			let detail = "";
			try {
				const response = JSON.parse(responseString) as { error?: { message?: string } };
				detail = response.error?.message ?? "";
			} catch {
				// The API does not always return JSON (for example on a proxy error)
			}
			throw new Error(`Google API request failed (${msg.get_status()})${detail ? `: ${detail}` : ""}`);
		}

		return (responseString ? JSON.parse(responseString) : null) as T;
	}

	private _createRequest(method: string, url: string, body: object | null): Soup.Message {
		const message = Soup.Message.new(method, url);
		message.request_headers.append("Authorization", `Bearer ${this.accessToken}`);

		if (body !== null) {
			message.set_request_body_from_bytes("application/json", new GLib.Bytes(JSON.stringify(body)));
		}

		return message;
	}

	private async refreshAccessToken(): Promise<void> {
		const response = await this._oauth.refreshAccessToken(this.clientId, this.clientSecret, this.refreshToken);
		if (!response.access_token) {
			throw new Error("OAuth refresh response did not include an access token.");
		}

		this.accessToken = response.access_token;
	}

	async getTaskLists(): Promise<GoogleTaskListsResponse> {
		return this._request("GET", `${this._baseUrl}/users/@me/lists`);
	}

	async getUserInfo(): Promise<GoogleUserInfo> {
		return this._request("GET", this._userInfoUrl);
	}

	async getTasks(listId: string): Promise<GoogleTasksResponse> {
		return this._request("GET", `${this._baseUrl}/lists/${encodeURIComponent(listId)}/tasks?showCompleted=false`);
	}

	async insertTask(listId: string, title: string): Promise<GoogleTask> {
		return this._request("POST", `${this._baseUrl}/lists/${encodeURIComponent(listId)}/tasks`, { title });
	}

	async completeTask(listId: string, task: GoogleTask): Promise<GoogleTask> {
		if (!task.id) {
			throw new Error("Cannot complete a task without an ID.");
		}

		return this._request(
			"PUT",
			`${this._baseUrl}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(task.id)}`,
			{
				...task,
				status: "completed",
			},
		);
	}

	async deleteTask(listId: string, taskId: string): Promise<void> {
		await this._request<null>(
			"DELETE",
			`${this._baseUrl}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
		);
	}
}
