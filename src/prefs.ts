import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import GoogleOAuthClient, { GoogleOAuthCallbackServer } from "./lib/auth.js";
import GoogleTasksAPI from "./lib/api.js";

type PreferencesHost = Parameters<ExtensionPreferences["fillPreferencesWindow"]>[0];

export default class GTasksPreferences extends ExtensionPreferences {
	async fillPreferencesWindow(window: PreferencesHost) {
		const settings = this.getSettings();

		const page = new Adw.PreferencesPage();
		window.add(page);

		const group = new Adw.PreferencesGroup({
			title: _("Google API Credentials"),
			description: _(
				"You need to create a project in Google Cloud Console, enable the Tasks API, and create Desktop App OAuth credentials.",
			),
		});
		page.add(group);

		const clientIdRow = new Adw.EntryRow({
			title: _("Client ID"),
		});
		group.add(clientIdRow);
		settings.bind("client-id", clientIdRow, "text", Gio.SettingsBindFlags.DEFAULT);

		const clientSecretRow = new Adw.EntryRow({
			title: _("Client Secret"),
		});
		group.add(clientSecretRow);
		settings.bind("client-secret", clientSecretRow, "text", Gio.SettingsBindFlags.DEFAULT);

		const loginGroup = new Adw.PreferencesGroup({
			title: _("Authentication"),
		});
		page.add(loginGroup);

		const accountRow = new Adw.ActionRow({
			title: _("Google account"),
		});
		loginGroup.add(accountRow);

		const loginRow = new Adw.ActionRow({
			title: _("Login with Google"),
			subtitle: _("Start authorization flow"),
		});
		const loginButton = new Gtk.Button({
			label: _("Authenticate"),
			valign: Gtk.Align.CENTER,
			has_frame: true,
		});
		loginRow.add_suffix(loginButton);
		loginGroup.add(loginRow);

		const logoutRow = new Adw.ActionRow({
			title: _("Logout"),
			subtitle: _("Remove the saved Google authorization from this extension"),
		});
		const logoutButton = new Gtk.Button({
			label: _("Logout"),
			valign: Gtk.Align.CENTER,
			has_frame: true,
		});
		logoutButton.add_css_class("destructive-action");
		logoutRow.add_suffix(logoutButton);
		loginGroup.add(logoutRow);

		const updateAuthenticationState = async () => {
			const authenticated = settings.get_string("refresh-token") !== "" || settings.get_string("access-token") !== "";
			loginButton.set_label(authenticated ? _("Reconnect") : _("Authenticate"));
			logoutRow.visible = authenticated;

			if (!authenticated) {
				accountRow.subtitle = _("Not connected");
				return;
			}

			accountRow.subtitle = _("Connected to Google");
			try {
				const user = await new GoogleTasksAPI(settings).getUserInfo();
				if (settings.get_string("access-token") === "") return;
				accountRow.subtitle = user.name && user.email ? `${user.name} <${user.email}>` : user.email ?? user.name ?? _("Connected to Google");
			} catch (error) {
				console.warn("Could not retrieve Google account information:", error);
			}
		};

		loginButton.connect("clicked", () => {
			void this._startAuthFlow(window, settings);
		});
		logoutButton.connect("clicked", () => {
			settings.set_string("access-token", "");
			settings.set_string("refresh-token", "");
			void updateAuthenticationState();
		});
		settings.connect("changed::access-token", () => void updateAuthenticationState());
		settings.connect("changed::refresh-token", () => void updateAuthenticationState());
		void updateAuthenticationState();
	}

	async _startAuthFlow(window: PreferencesHost, settings: Gio.Settings) {
		const clientId = settings.get_string("client-id").trim();
		const clientSecret = settings.get_string("client-secret").trim();

		if (!clientId || !clientSecret) {
			this._showDialog(window, _("Error"), _("Please enter Client ID and Client Secret."));
			return;
		}

		let callbackServer: GoogleOAuthCallbackServer | null = null;
		let dialog: Adw.AlertDialog | null = null;
		let responseSignalId: number | null = null;

		try {
			const oauth = new GoogleOAuthClient();
			callbackServer = new GoogleOAuthCallbackServer();
			dialog = new Adw.AlertDialog({
				heading: _("Google Authorization"),
				body: _("Please complete the authentication in your browser.\n\nWaiting for authorization..."),
			});
			dialog.add_response("cancel", _("Cancel"));
			dialog.close_response = "cancel";

			responseSignalId = dialog.connect("response", () => callbackServer!.cancel());
			dialog.present(window);
			Gio.AppInfo.launch_default_for_uri(oauth.getAuthorizationUrl(clientId, callbackServer.redirectUri), null);
			const code = await callbackServer.waitForCode();

			if (code) {
				const tokenRes = await oauth.exchangeAuthorizationCode(
					clientId,
					clientSecret,
					code,
					callbackServer.redirectUri,
				);

				// Google may omit refresh_token when this account had already granted access to the same OAuth client
				// Keep a previously saved one in that case instead of treating an otherwise successful login as a failure
				const refreshToken = tokenRes.refresh_token || settings.get_string("refresh-token");
				if (tokenRes.access_token) {
					settings.set_string("access-token", tokenRes.access_token);
					if (refreshToken) {
						settings.set_string("refresh-token", refreshToken);
					}
					this._showDialog(window, _("Success"), _("Successfully authenticated with Google Tasks!"));
				} else {
					this._showDialog(
						window,
						_("Error"),
						tokenRes.error_description || tokenRes.error || "Unknown error exchanging token",
					);
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._showDialog(window, _("Error"), message);
		} finally {
			if (responseSignalId !== null) dialog?.disconnect(responseSignalId);
			callbackServer?.close();
			dialog?.close();
		}
	}

	_showDialog(window: PreferencesHost, heading: string, body: string) {
		const dialog = new Adw.AlertDialog({
			heading: heading,
			body: body,
		});
		dialog.add_response("ok", _("OK"));
		dialog.close_response = "ok";
		dialog.present(window);
	}
}
