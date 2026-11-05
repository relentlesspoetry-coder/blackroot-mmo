# Blackroot desktop alpha packages

Two **Ubuntu / Zorin OS amd64** packages provide application-menu launchers:

- **Blackroot Server**: native GTK control window, local server, bundled Node.js 24.
- **Blackroot Client**: native GTK launcher that opens the game in your default
  web browser. This is not a new embedded renderer. Use a WebGL-capable browser.

The full game assets are included. Browser dependencies still load from their
existing CDN, so this alpha requires internet access. Node.js and npm do not need
separate installation. There is no system service, boot autostart, firewall
change, or automatic migration of existing saves.

## Build (does not install)

Requires Python 3, `curl`, and `dpkg-deb` on the build machine:

```sh
python3 packaging/deb/build.py --output /tmp/blackroot-debs
```

The build downloads the pinned official Node.js 24.22.2 amd64 binary, checks the
pinned SHA-256 against Node's HTTPS checksum listing and the downloaded bytes,
and preserves the Node license / third-party notices. It downloads only `ws`
from the lockfile's npm registry URL and verifies its SHA-512 integrity. No
unverified host Node executable or development `node_modules` are packaged.

Output includes both `.deb` files and `manifest.json` with package checksums.
No packages are installed and no files are uploaded by the build.

## Install and launch

Install **both packages together**, for example from the output directory:

```sh
sudo apt install ./blackroot-server_0.1.0~alpha.1_amd64.deb ./blackroot-client_0.1.0~alpha.1_amd64.deb
```

The desktop's graphical installer can also install the server package first,
then the client package. Distro GTK/Python dependencies may require internet to
install. Open **Blackroot Server** and **Blackroot Client** from the application
menu. Keep existing manually launched game servers separate; the desktop alpha
uses its own per-user data directory and loopback port 8282.

Closing the control window leaves the server running for that login session.
Use **Stop** in Blackroot Server before logging out; if startup fails, inspect
the displayed error, then use **Stop** followed by **Start** after correcting it.
The packaged world editor is disabled; editing requires a separate source checkout.

Per-user locations (respecting XDG overrides):
- Saves and accounts: `~/.local/share/blackroot/`
- Logs and supervisor state: `~/.local/state/blackroot/`
- Settings: `~/.config/blackroot/settings.json` (optional `{"port": 8282}`)

Save storage is outside `/usr/lib`, so package upgrades do not overwrite saves.
Stop the desktop server before upgrading or removing packages and before making
a backup. Uninstalling packages does not delete user data. Existing manual game
characters are not imported automatically.

## Boundaries and licenses

The packages are for local alpha testing, not a publicly exposed MMO server.
Only amd64 is packaged. A successful package build is not evidence of successful
GPU rendering on a target computer; a real desktop launch and gameplay smoke
check are still required.

The game repository does not include an explicit license grant for its source
or assets. These owner-requested local packages do not assert redistribution
rights. Node and `ws` licenses are included in server package documentation.
