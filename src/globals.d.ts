declare module "resource:///org/gnome/shell/extensions/extension.js" {
    export class Extension {
        uuid: string;
        getSettings(): any;
        openPreferences(): void;
    }
    export function gettext(str: string): string;
}

declare module "resource:///org/gnome/shell/ui/main.js" {
    export const panel: {
        addToStatusArea(uuid: string, indicator: any): void;
    };
}

declare module "resource:///org/gnome/shell/ui/panelMenu.js" {
    export class Button {
        _init(align: number, name: string): void;
        menu: any;
        add_child(actor: any): void;
        destroy(): void;
    }
}

declare module "resource:///org/gnome/shell/ui/popupMenu.js" {
    export class PopupMenu {
        removeAll(): void;
        addMenuItem(item: any): void;
        close(): void;
        connect(sig: string, cb: (menu: any, open: boolean) => void): void;
    }
    export class PopupMenuItem {
        constructor(text: string);
        connect(sig: string, cb: () => void): void;
    }
    export class PopupBaseMenuItem {
        constructor(params: any);
        activate: () => void;
        add_style_class_name(cls: string): void;
        add_child(actor: any): void;
    }
    export class PopupSeparatorMenuItem {
        constructor();
    }
}

declare module "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js" {
    export class ExtensionPreferences {
        getSettings(): any;
        fillPreferencesWindow(window: any): void;
    }
    export function gettext(str: string): string;
}
