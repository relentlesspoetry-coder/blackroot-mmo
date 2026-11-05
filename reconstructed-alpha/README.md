# Blackroot reconstructed alpha package source

**Reconstructed on 2026-11-04 from the tested original DEB payloads.**
The original packaging worktree and build manifest were not recovered. This tree
must not be described or tagged as that original source.

The `game/`, launcher, asset and vendor files are recovered source and dependencies.
The newly written offline recipe is `packaging/deb/build.py`. Its complete recovered
file inventory is `packaging/deb/recovered-files.json`; original installer hashes,
the base game revision and the exact additional HOST patch are recorded under
`packaging/deb/provenance.json` and `evidence/`.

Build without installing or publishing:

```sh
python3 packaging/deb/build.py --output /tmp/blackroot-reconstructed-output
```

Requires Python 3 and the installed `dpkg-deb` with xz support. Builds use a fixed
timestamp, root archive ownership and one compression thread. Output paths are
never silently overwritten. A second build in a different empty directory can
be compared using the generated SHA256SUMS.

The version is `0.1.0~alpha.1+reconstructed.1`. Only packaging metadata and added
provenance documents should differ from the original payload; the game, Node,
ws, launcher code, desktop entries and icons should remain byte-identical.

Independent package comparison and the original lifecycle/smoke harness are
under `validation/`. Results are kept separately from source. The lifecycle
suite uses a fake child to test the supervisor; the extracted-package smoke
runs the real bundled Node game server using temporary XDG paths and an ephemeral
loopback port, then stops only its own supervisor. Execute those network tests
only with the environment's required listening permission.

No installation, publication, Git pushes, merges, deployment, save migration or
security changes are part of this reconstruction.
