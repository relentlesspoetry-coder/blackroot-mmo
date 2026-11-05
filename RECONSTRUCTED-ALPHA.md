# Blackroot reconstructed Linux alpha

This release branch is based on game commit
`8e8c7dccb2f86bacf816fc768bf6b98884996eba` plus the HOST listener patch.
It does not merge or update master or the open pull request.

The tested reconstruction is under `reconstructed-alpha/`. The original
packaging worktree was not recovered. See its provenance record and the release
validation documents under `release/alpha.1-reconstructed.1/`.

The complete offline build context is the release asset
`blackroot-reconstructed-source_0.1.0-alpha.1-reconstructed.1.tar.gz`.
The repository excludes the 126,881,248-byte official Node executable; the source
bundle contains it, with its pinned checksum and preserved license. Use that
bundle for an offline rebuild rather than GitHub's automatic source archive.

GTK button/status interactions, default-browser routing and system installation
remain unverified. This is an experimental alpha, published with those limits
explicitly disclosed.
