# Reconstructed alpha packaging

This is **0.1.0~alpha.1+reconstructed.1**, built from a newly reconstructed
recipe. It is not the missing original packaging source or a new gameplay revision.

The game and launchers were recovered from the two hash-verified original
0.1.0~alpha.1 installers. The game matches commit
`8e8c7dccb2f86bacf816fc768bf6b98884996eba` with the documented HOST listener patch.
Recovered files are checked against a complete SHA256 inventory before building.
The build uses the recovered Node 24.22.2 and ws 8.21.3 files. Dependency verification
against the official Node distribution and lockfile-pinned npm archive is a
separate validation step; its outcome is recorded in the validation evidence.

This recipe is offline and only creates archives. It does not install packages,
publish files, start services, change firewall settings, or migrate saves.
The original package README is preserved as historical documentation; its sample
installer filenames refer to the original build. The new filenames contain
`0.1.0~alpha.1+reconstructed.1`.

The client opens the default web browser. It is not an embedded renderer.
GTK controls, default-browser routing and system installation have not been fully
verified. Runtime checks do not establish desktop interaction or GPU behavior.
Existing per-user save locations and port settings are unchanged. No saves or
accounts are included in these archives.
