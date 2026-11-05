# Reconstructed source export

This source is the tested reconstruction, not the missing original packaging
worktree. The complete release source bundle includes the recovered and
independently verified Node binary, so its offline build recipe can run as-is.

The GitHub branch keeps this tree under `reconstructed-alpha/`. It omits only
`packaging/deb/vendor/node/bin/node`, a 126,881,248-byte upstream executable that
exceeds GitHub's normal file size limit. The full source-bundle release asset
contains that exact file. Its checksum is pinned in `recovered-files.json` and
the provenance record; Node's license is preserved. Use the complete source bundle
for an offline rebuild rather than GitHub's automatic source ZIP/tarball.

The source recipe and recovered payload are unchanged from the two independently
reproduced and tested reconstructed DEBs. `results/`, caches, Python bytecode,
local paths and the original uninstalled DEBs are excluded from this export.

GTK button/status behavior, desktop browser routing and package installation
remain unverified. Those limits are disclosed in the alpha release notes.
