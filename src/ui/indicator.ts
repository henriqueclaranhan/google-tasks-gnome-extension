import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import GoogleTasksAPI, { GoogleTask, GoogleTaskList } from "../lib/api.js";

export class _TasksIndicator extends PanelMenu.Button {
	declare api: GoogleTasksAPI;
	declare onOpenPreferences: () => void;
	declare taskLists: GoogleTaskList[];
	declare activeListId: string | null;
	declare taskCountLabel: St.Label;
	declare tabsBox: St.BoxLayout;
	declare newTaskEntry: St.Entry;
	declare tasksBox: St.BoxLayout;
	declare private isDisposed: boolean;
	declare private taskLoadVersion: number;
	declare private refreshPromise: Promise<void> | null;
	declare private refreshRequested: boolean;

	private get popupMenu(): PopupMenu.PopupMenu {
		return this.menu as PopupMenu.PopupMenu;
	}

	// @ts-expect-error GNOME Shell's GObject-style constructor uses a custom _init signature
	_init(api: GoogleTasksAPI, onOpenPreferences: () => void) {
		super._init(0.5, _("Google Tasks"));
		this.api = api;
		this.onOpenPreferences = onOpenPreferences;
		this.taskLists = [];
		this.activeListId = null;
		this.isDisposed = false;
		this.taskLoadVersion = 0;
		this.refreshPromise = null;
		this.refreshRequested = false;

		let layout = new St.BoxLayout();
		layout.add_child(
			new St.Icon({
				icon_name: "object-select-symbolic",
				style_class: "system-status-icon",
			}),
		);
		this.taskCountLabel = new St.Label({
			text: "...",
			y_align: Clutter.ActorAlign.CENTER,
			style_class: "gtasks-task-count-label",
		});
		layout.add_child(this.taskCountLabel);

		this.add_child(layout);

		this._buildMenu();

		this.popupMenu.connect("open-state-changed", (_menu, open) => {
			if (open) {
				void this.refresh();
			}
		});

		GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
			void this.refresh();
			return GLib.SOURCE_REMOVE;
		});
	}

	_buildMenu() {
		this.popupMenu.removeAll();

		if (!this.api.isAuthenticated()) {
			this.tabsBox = undefined as any;
			this.tasksBox = undefined as any;

			let item = new PopupMenu.PopupMenuItem(_("Please authenticate in Extension Preferences."));
			item.connect("activate", () => {
				if (!this.isDisposed) {
					GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
						this.onOpenPreferences();
						return GLib.SOURCE_REMOVE;
					});
				}
			});
			this.popupMenu.addMenuItem(item);
			return;
		}

		this.tabsBox = new St.BoxLayout({
			style_class: "gtasks-tabs-box",
			x_expand: true,
		});
		this.tabsBox.add_child(
			new St.Label({
				text: _("Loading task lists..."),
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
			}),
		);
		let tabsMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
		tabsMenuItem.activate = () => {};
		tabsMenuItem.add_style_class_name("gtasks-no-hover-menu-item");
		tabsMenuItem.add_child(this.tabsBox);
		this.popupMenu.addMenuItem(tabsMenuItem);

		this.popupMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		this.newTaskEntry = new St.Entry({
			hint_text: _("New Task..."),
			style_class: "gtasks-new-task-entry",
			x_expand: true,
			can_focus: true,
		});
		this.newTaskEntry.clutter_text.connect("activate", () => {
			void this._createNewTask(this.newTaskEntry.get_text());
		});

		let entryMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
		entryMenuItem.activate = () => {};
		entryMenuItem.add_style_class_name("gtasks-no-hover-menu-item");
		entryMenuItem.add_child(this.newTaskEntry);
		this.popupMenu.addMenuItem(entryMenuItem);

		this.popupMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

		this.tasksBox = new St.BoxLayout({
			style_class: "gtasks-tasks-box",
			vertical: true,
			x_expand: true,
		});
		this.tasksBox.add_child(
			new St.Label({
				text: _("Loading tasks..."),
				x_expand: true,
				x_align: Clutter.ActorAlign.CENTER,
			}),
		);
		let tasksMenuItem = new PopupMenu.PopupBaseMenuItem({ reactive: true, can_focus: false });
		tasksMenuItem.activate = () => {};
		tasksMenuItem.add_style_class_name("gtasks-no-hover-menu-item");
		tasksMenuItem.add_child(this.tasksBox);
		this.popupMenu.addMenuItem(tasksMenuItem);
	}

	async refresh() {
		try {
			if (!this.api.isAuthenticated()) {
				this.taskLists = [];
				this.activeListId = null;
				this.refreshRequested = false;
				this._buildMenu();
				return;
			}

			this.refreshRequested = true;
			if (this.refreshPromise) return this.refreshPromise;

			const refreshPromise = (async () => {
				while (this.refreshRequested && !this.isDisposed) {
					this.refreshRequested = false;
					await this._refresh();
				}
			})();
			this.refreshPromise = refreshPromise;
			try {
				await refreshPromise;
			} finally {
				if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
			}
		} catch (e) {
			console.error("CRITICAL ERROR IN REFRESH:", e);
			try {
				if (this.tabsBox) this.tabsBox.destroy_all_children();
				if (this.tasksBox) {
					this.tasksBox.destroy_all_children();
					let errorLabel = new St.Label({
						text: "CRITICAL UI ERROR: " + (e instanceof Error ? e.message : "Unknown error"),
						x_expand: true,
					});
					errorLabel.clutter_text.line_wrap = true;
					this.tasksBox.add_child(errorLabel);
				}
			} catch (innerE) {
				console.error("Failed to clear UI:", innerE);
			}
		}
	}

	private async _refresh() {
		if (this.isDisposed) return;

		if (!this.api.isAuthenticated()) {
			this.taskLists = [];
			this.activeListId = null;
			this._buildMenu();
			return;
		}

		if (!this.tabsBox) {
			this._buildMenu();
		}

		try {
			if (this.taskLists.length === 0) {
				let listsRes = await this.api.getTaskLists();
				this.taskLists = listsRes.items ?? [];
				if (this.taskLists.length > 0 && !this.activeListId) {
					this.activeListId = this.taskLists[0].id;
				}
			}

			this._updateTabs();

			if (!this.isDisposed && this.activeListId) {
				await this._loadTasks(this.activeListId);
			}
		} catch (e) {
			console.error("Failed to refresh tasks:", e);
			if (!this.isDisposed) {
				try {
					this.taskCountLabel.set_text("!");
					this.tabsBox.destroy_all_children();
					this.tasksBox.destroy_all_children();

					let errorText = e instanceof Error ? e.message : _("Error loading");
					if (errorText.includes("Tasks API has not been used") || errorText.includes("403")) {
						errorText = _(
							"The Google Tasks API is not enabled in your Google Cloud Project. Please enable it.",
						);
					} else if (errorText.includes("401") || errorText.includes("refresh_token")) {
						errorText = _(
							"Your session expired or the token is invalid. Please authenticate again in Preferences.",
						);
					}

					let errorLabel = new St.Label({
						text: errorText,
						x_expand: true,
					});
					errorLabel.clutter_text.line_wrap = true;
					this.tasksBox.add_child(errorLabel);
				} catch (innerE) {
					console.error("Failed to display error in UI:", innerE);
				}
			}
		}
	}

	_updateTabs() {
		this.tabsBox.destroy_all_children();

		if (this.taskLists.length === 0) {
			this.tabsBox.add_child(
				new St.Label({
					text: _("No task lists found"),
					x_expand: true,
					x_align: Clutter.ActorAlign.CENTER,
				}),
			);
			this.taskCountLabel.set_text("0");
			this.tasksBox.destroy_all_children();
			this.tasksBox.add_child(
				new St.Label({ text: _("No tasks"), x_expand: true, x_align: Clutter.ActorAlign.CENTER }),
			);
			return;
		}

		for (let list of this.taskLists) {
			let is_active = list.id === this.activeListId;
			let tab = new St.Button({
				label: list.title,
				style_class: is_active ? "gtasks-tab active" : "gtasks-tab",
			});

			tab.connect("clicked", () => {
				this.activeListId = list.id;
				this._updateTabs();
				if (this.activeListId) {
					void this._loadTasks(this.activeListId);
				}
			});

			this.tabsBox.add_child(tab);
		}
	}

	async _loadTasks(listId: string) {
		const loadVersion = ++this.taskLoadVersion;
		this.tasksBox.destroy_all_children();

		let loadingLabel = new St.Label({ text: _("Loading..."), x_expand: true, x_align: Clutter.ActorAlign.CENTER });
		this.tasksBox.add_child(loadingLabel);

		try {
			let res = await this.api.getTasks(listId);
			const tasks = res.items ?? [];
			if (this.isDisposed || loadVersion !== this.taskLoadVersion || listId !== this.activeListId) return;

			this.tasksBox.destroy_all_children();

			let activeTasks = tasks.filter((t) => t.status === "needsAction");
			let completedTasks = tasks.filter((t) => t.status === "completed");

			this.taskCountLabel.set_text(activeTasks.length.toString());

			if (tasks.length === 0) {
				this.tasksBox.add_child(
					new St.Label({ text: _("No tasks"), x_expand: true, x_align: Clutter.ActorAlign.CENTER }),
				);
				return;
			}

			const sortByPosition = (a: GoogleTask, b: GoogleTask) => {
				if (a.position && b.position) return a.position.localeCompare(b.position);
				return 0;
			};

			let activeTopLevel = activeTasks.filter((t) => !t.parent || !activeTasks.some((p) => p.id === t.parent));
			let activeSubTasks = activeTasks.filter((t) => t.parent && activeTasks.some((p) => p.id === t.parent));
			activeTopLevel.sort(sortByPosition);

			for (let task of activeTopLevel) {
				this._addTaskItem(task, false, this.tasksBox);
				let children = activeSubTasks.filter((t) => t.parent === task.id);
				children.sort(sortByPosition);
				for (let child of children) {
					this._addTaskItem(child, true, this.tasksBox);
				}
			}

			if (completedTasks.length > 0) {
				let accordionBox = new St.BoxLayout({ vertical: true, x_expand: true });

				let accordionButton = new St.Button({
					style_class: "gtasks-accordion-button",
					x_expand: true,
					reactive: true,
					can_focus: true,
				});
				let accordionButtonLayout = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });

				let accordionIcon = new St.Icon({
					icon_name: "pan-end-symbolic",
					icon_size: 12,
				});
				let accordionLabel = new St.Label({
					text: `Concluídas (${completedTasks.length})`,
					style_class: "gtasks-accordion-label",
					y_align: Clutter.ActorAlign.CENTER,
				});
				accordionButtonLayout.add_child(accordionIcon);
				accordionButtonLayout.add_child(accordionLabel);
				accordionButton.child = accordionButtonLayout;

				let completedTasksBox = new St.BoxLayout({ vertical: true, x_expand: true, visible: false });

				accordionButton.connect("clicked", () => {
					let isVisible = completedTasksBox.visible;
					completedTasksBox.visible = !isVisible;
					accordionIcon.icon_name = isVisible ? "pan-end-symbolic" : "pan-down-symbolic";
				});

				accordionBox.add_child(accordionButton);
				accordionBox.add_child(completedTasksBox);

				let completedTopLevel = completedTasks.filter(
					(t) => !t.parent || !completedTasks.some((p) => p.id === t.parent),
				);
				let completedSubTasks = completedTasks.filter(
					(t) => t.parent && completedTasks.some((p) => p.id === t.parent),
				);
				// Sort completed tasks by 'updated' date descending
				completedTopLevel.sort((a, b) => {
					let d1 = a.updated ? new Date(a.updated).getTime() : 0;
					let d2 = b.updated ? new Date(b.updated).getTime() : 0;
					return d2 - d1;
				});

				for (let task of completedTopLevel) {
					this._addTaskItem(task, false, completedTasksBox);
					let children = completedSubTasks.filter((t) => t.parent === task.id);
					children.sort(sortByPosition);
					for (let child of children) {
						this._addTaskItem(child, true, completedTasksBox);
					}
				}

				this.tasksBox.add_child(accordionBox);
			}
		} catch (e) {
			console.error("Failed to load tasks:", e);
			if (!this.isDisposed && loadVersion === this.taskLoadVersion) {
				this.tasksBox.destroy_all_children();

				let errorText = e instanceof Error ? e.message : _("Error loading");
				let errorLabel = new St.Label({
					text: errorText,
					x_expand: true,
				});
				errorLabel.clutter_text.line_wrap = true;
				this.tasksBox.add_child(errorLabel);
			}
		}
	}

	_addTaskItem(task: GoogleTask, isSubtask: boolean = false, container: St.BoxLayout = this.tasksBox) {
		let taskLayout = new St.BoxLayout({
			x_expand: true,
			y_align: Clutter.ActorAlign.CENTER,
			reactive: true,
			style_class: "gtasks-task-item" + (isSubtask ? " gtasks-subtask-item" : ""),
		});

		let isCompleted = task.status === "completed";
		let checkButton = new St.Button({
			child: new St.Icon({ icon_name: isCompleted ? "object-select-symbolic" : "radio-symbolic", icon_size: 16 }),
			style_class: "gtasks-action-button gtasks-check-button",
		});
		checkButton.connect("clicked", () => {
			if (isCompleted) {
				void this._uncompleteTask(task, taskLayout);
			} else {
				void this._completeTask(task, taskLayout);
			}
		});
		taskLayout.add_child(checkButton);

		let textsLayout = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER });

		let titleLabel = new St.Label({ text: task.title, x_expand: true, y_align: Clutter.ActorAlign.CENTER });
		let titleEntry = new St.Entry({
			text: task.title,
			x_expand: true,
			visible: false,
			y_align: Clutter.ActorAlign.CENTER,
		});
		textsLayout.add_child(titleLabel);
		textsLayout.add_child(titleEntry);

		if (task.due) {
			let datePart = task.due.split("T")[0];
			let [y, m, d] = datePart.split("-");
			let dueLabel = new St.Label({
				text: `${_("Due:")} ${d}/${m}/${y}`,
				style_class: "dim-label gtasks-due-label",
			});
			textsLayout.add_child(dueLabel);
		}

		taskLayout.add_child(textsLayout);

		let actionsBox = new St.BoxLayout({
			visible: false,
			style_class: "gtasks-actions-box",
			y_align: Clutter.ActorAlign.CENTER,
		});

		let moreButton = new St.Button({
			child: new St.Icon({ icon_name: "view-more-symbolic", icon_size: 14 }),
			style_class: "gtasks-action-button gtasks-more-button",
		});

		let editButton = new St.Button({
			child: new St.Icon({ icon_name: "document-edit-symbolic", icon_size: 16 }),
			style_class: "gtasks-action-button",
		});

		let deleteButton = new St.Button({
			child: new St.Icon({ icon_name: "user-trash-symbolic", icon_size: 16 }),
			style_class: "gtasks-action-button",
		});

		let closeActionsButton = new St.Button({
			child: new St.Icon({ icon_name: "window-close-symbolic", icon_size: 16 }),
			style_class: "gtasks-action-button",
		});

		actionsBox.add_child(editButton);
		actionsBox.add_child(deleteButton);
		actionsBox.add_child(closeActionsButton);

		taskLayout.add_child(actionsBox);
		taskLayout.add_child(moreButton);

		moreButton.connect("clicked", () => {
			moreButton.hide();
			actionsBox.show();
		});

		closeActionsButton.connect("clicked", () => {
			actionsBox.hide();
			moreButton.show();
			titleLabel.show();
			titleEntry.hide();
		});

		editButton.connect("clicked", () => {
			titleLabel.hide();
			titleEntry.show();
			titleEntry.grab_key_focus();
			actionsBox.hide();
			moreButton.show();
		});

		deleteButton.connect("clicked", () => void this._deleteTask(task, taskLayout));

		titleEntry.clutter_text.connect("activate", () => {
			void this._updateTaskTitle(task, taskLayout, titleEntry.get_text());
		});

		container.add_child(taskLayout);
	}

	async _createNewTask(title: string) {
		if (!title.trim() || !this.activeListId) return;

		this.newTaskEntry.set_text("");
		try {
			await this.api.insertTask(this.activeListId, title);
			await this._loadTasks(this.activeListId);
		} catch (e) {
			console.error("Failed to create task:", e);
		}
	}

	private async _updateTaskTitle(task: GoogleTask, taskLayout: St.BoxLayout, newTitle: string): Promise<void> {
		const listId = this.activeListId;
		if (!listId || !task.id || !newTitle.trim()) return;

		try {
			await this.api.updateTask(listId, task, newTitle);
			if (!this.isDisposed && this.activeListId === listId) void this._loadTasks(listId);
		} catch (error) {
			console.error("Failed to update task:", error);
		}
	}

	private async _uncompleteTask(task: GoogleTask, taskLayout: St.BoxLayout): Promise<void> {
		const listId = this.activeListId;

		if (!listId) return;

		taskLayout.hide();

		try {
			await this.api.uncompleteTask(listId, task);

			if (!this.isDisposed && this.activeListId === listId) void this._loadTasks(listId);
		} catch (error) {
			console.error("Failed to uncomplete task:", error);

			if (!this.isDisposed) taskLayout.show();
		}
	}

	private async _completeTask(task: GoogleTask, taskLayout: St.BoxLayout): Promise<void> {
		const listId = this.activeListId;
		if (!listId) return;

		taskLayout.hide();
		try {
			await this.api.completeTask(listId, task);
			if (!this.isDisposed && this.activeListId === listId) void this._loadTasks(listId);
		} catch (error) {
			console.error("Failed to complete task:", error);
			if (!this.isDisposed) taskLayout.show();
		}
	}

	private async _deleteTask(task: GoogleTask, taskLayout: St.BoxLayout): Promise<void> {
		const listId = this.activeListId;
		if (!listId || !task.id) return;

		taskLayout.hide();
		try {
			await this.api.deleteTask(listId, task.id);
			if (!this.isDisposed && this.activeListId === listId) void this._loadTasks(listId);
		} catch (error) {
			console.error("Failed to delete task:", error);
			if (!this.isDisposed) taskLayout.show();
		}
	}

	destroy() {
		this.isDisposed = true;
		this.taskLoadVersion++;
		super.destroy();
	}
}

export const TasksIndicator = GObject.registerClass(_TasksIndicator);
