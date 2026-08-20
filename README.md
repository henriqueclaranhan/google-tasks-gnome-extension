# Google Tasks GNOME Extension

Manage your Google Tasks directly from Gnome the top panel.

## Supported Versions

* GNOME 49
* GNOME 50

## Installation

### Manual Installation

1. Clone or download this repository.
2. Ensure you have the necessary build dependencies (Node.js, TypeScript, and `make`).
3. Compile the extension:
   ```bash
   npm install
   make
   ```
4. Create a symlink to your GNOME extensions folder:
   ```bash
   ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/gtasks-gnome-extension@henrique.claranhan
   ```
5. Restart GNOME Shell (press `Alt+F2`, type `r` and press Enter on X11, or log out and log back in on Wayland).
6. Enable the extension using the "Extensions" app (GNOME Extensions).

## Configuration (API Credentials)

To use this extension, you need to set up your own Google Cloud API credentials:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project and enable the **Google Tasks API**.
3. Configure the OAuth Consent Screen.
4. Create **OAuth 2.0 Client ID** credentials (Application type: *Desktop app*).
5. Copy your **Client ID** and **Client Secret**.
6. Open the extension Preferences in GNOME and enter the keys.
7. Click Authorize to finish logging in.

## Disclaimer

This project is an unofficial extension and is not affiliated with, endorsed by, or associated with Google LLC in any way. "Google Tasks" and "Google" are trademarks of Google LLC.
