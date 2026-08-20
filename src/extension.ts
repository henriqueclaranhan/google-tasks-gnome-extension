import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import type { Button as PanelMenuButton } from "resource:///org/gnome/shell/ui/panelMenu.js";

import GoogleTasksAPI from "./lib/api.js";
import { TasksIndicator, _TasksIndicator } from "./ui/indicator.js";

import Gio from "gi://Gio";

export default class GTasksExtension extends Extension {
	settings: Gio.Settings | null = null;
	api: GoogleTasksAPI | null = null;
	_indicator: _TasksIndicator | null = null;
	private _authenticationChangedId: number | null = null;
	enable() {
		this.settings! = this.getSettings();
		this.api = new GoogleTasksAPI(this.settings!);
		this._indicator = new TasksIndicator(this.api, () => this.openPreferences());
		this._authenticationChangedId = this.settings!.connect("changed::refresh-token", () => {
			if (this._indicator) {
				void this._indicator?.refresh();
			}
		});
		this.settings!.connect("changed::access-token", () => {
			if (this._indicator) {
				void this._indicator?.refresh();
			}
		});

		Main.panel.addToStatusArea(this.uuid, this._indicator as unknown as PanelMenuButton);
	}

	disable() {
		if (this.settings! && this._authenticationChangedId !== null) {
			this.settings!.disconnect(this._authenticationChangedId);
			this._authenticationChangedId = null;
		}
		this._indicator?.destroy();
		this._indicator = null;
		this.api = null;
		this.settings = null;
	}
}
