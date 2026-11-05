First Linux amd64 alpha of the Blackroot Server and Client launchers, using **explicitly reconstructed packaging**. This is an experimental pre-release.

### Known unverified desktop behavior

The actual GTK Start/Stop buttons, repeated clicks, visible status/log updates, and the client's routing into the desktop default browser have **not been interactively verified**. System installation, uninstall and upgrade behavior have **not been tested**. The owner requested publication as an alpha with these limitations disclosed.

The client is a launcher for a WebGL-capable default browser, not an embedded renderer. Browser dependencies still require internet access. The package targets Ubuntu/Zorin-style amd64 systems; other desktop or distribution combinations are not validated.

### Downloads

Use both `blackroot-server_0.1.0-alpha.1-reconstructed.1_amd64.deb` and `blackroot-client_0.1.0-alpha.1-reconstructed.1_amd64.deb`. The client depends on this exact server package version. `SHA256SUMS`, `build-manifest.json` and `validation-report.json` accompany the packages.

The server uses per-user XDG data/state/config directories and defaults to loopback port 8282. No system service, boot autostart, firewall change or automatic save migration is provided. Existing manually launched servers and saves remain separate. Closing a launcher window is intended to leave its local server running; Stop is intended to save and shut it down. Those intended UI actions still require desktop testing.

### Source and provenance

The original packaging worktree and build manifest were missing. This is a new reconstruction from the hash-verified original alpha payload, versioned **`0.1.0~alpha.1+reconstructed.1`**, rather than a claim to have recovered that original recipe.

The game is commit `8e8c7dccb2f86bacf816fc768bf6b98884996eba` plus the recorded HOST bind-address patch. Every shared payload file retains the original contents; changes are reconstruction/provenance documents, package metadata, and executable permissions on the two Python launcher files.

The release branch contains the game revision and reconstructed source under `reconstructed-alpha/`. For a complete offline build tree, use **`blackroot-reconstructed-source_0.1.0-alpha.1-reconstructed.1.tar.gz`**. That bundle includes the exact verified upstream Node binary, which is omitted from Git because it exceeds the normal file-size limit. GitHub's automatically generated source ZIP/tarball therefore is not the complete offline build context. Node and ws license notices are preserved.

After extracting the complete source bundle:

```sh
cd blackroot-reconstructed-source
python3 packaging/deb/build.py --output /tmp/blackroot-rebuilt
```

The recipe builds archives offline; it does not install, publish or start the game.

### Completed automated validation

- Two independent builds produced byte-identical DEBs and manifests.
- The recovered Node 24.22.2 binary/license matched the official upstream archive; all 19 ws files matched the lockfile-pinned npm archive.
- Archive ownership/permissions, exact client dependency, all 348 GLBs, absence of saves/accounts and maintainer scripts, and unchanged original payload bytes passed independent comparison.
- Five supervisor lifecycle tests passed using the new package's runtime with a fake child.
- Real bundled-Node tests passed HTTP, WebSocket upgrade, loopback-only binding, five concurrent starts producing one server, repeat start, graceful checkpoint Stop and refusal to interfere with a disposable foreign listener.

Tests used extracted files, ephemeral loopback ports and disposable XDG data. They are not installation or interactive desktop validation. No existing player saves or running game servers were used.

Verify downloaded assets with:

```sh
sha256sum -c SHA256SUMS
```

Public download filenames use GitHub-safe hyphens; the Debian package version remains `0.1.0~alpha.1+reconstructed.1`. `build-manifest.json` and `BUILD-SHA256SUMS` preserve the original build filenames. Use `SHA256SUMS` to verify the public download filenames; `release-assets.json` records their mapping.
