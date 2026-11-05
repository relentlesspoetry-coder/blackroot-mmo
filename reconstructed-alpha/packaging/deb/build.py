#!/usr/bin/env python3
"""Reconstructed, offline DEB recipe. Does not install or publish anything."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tempfile

PROJECT = Path(__file__).resolve().parents[2]
PACKAGE = Path(__file__).resolve().parent
VERSION = '0.1.0~alpha.1+reconstructed.1'
EPOCH = 1793318400  # Fixed recovery baseline: 2026-10-30 00:00:00 UTC.
SOURCES = ('game', 'packaging/deb/launcher', 'packaging/deb/assets', 'packaging/deb/vendor')
EXECUTABLES = {'usr/bin/blackroot-server', 'usr/bin/blackroot-client',
               'usr/lib/blackroot/runtime.py', 'usr/lib/blackroot/ui.py',
               'usr/lib/blackroot/node/bin/node'}


def digest(path, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def verify_sources():
    expected = json.loads((PACKAGE / 'recovered-files.json').read_text())
    actual = set()
    for directory in SOURCES:
        for path in (PROJECT / directory).rglob('*'):
            if path.is_symlink():
                raise ValueError(f'Symlink in recovered source: {path}')
            if path.is_file():
                actual.add(path.relative_to(PROJECT).as_posix())
    if actual != set(expected):
        raise ValueError(f'Recovered file set changed: {actual ^ set(expected)}')
    for relative, sha in expected.items():
        rel = PurePosixPath(relative)
        if rel.is_absolute() or '..' in rel.parts:
            raise ValueError(f'Unsafe manifest path: {relative}')
        if digest(PROJECT / relative) != sha:
            raise ValueError(f'Recovered source checksum mismatch: {relative}')
    return expected


def copy_file(source, stage, destination):
    target = stage / destination
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def copy_tree(source, stage, destination):
    for path in sorted(source.rglob('*')):
        if path.is_file():
            copy_file(path, stage, str(Path(destination) / path.relative_to(source)))


def prepare_payload(stage, kind):
    assets = PACKAGE / 'assets'
    copy_file(assets / f'usr/bin/blackroot-{kind}', stage, f'usr/bin/blackroot-{kind}')
    for relative in (f'usr/share/applications/blackroot-{kind}.desktop',
                     f'usr/share/icons/hicolor/scalable/apps/blackroot-{kind}.svg'):
        copy_file(assets / relative, stage, relative)
    docs = f'usr/share/doc/blackroot-{kind}'
    copy_tree(assets / docs, stage, docs)
    copy_file(PACKAGE / 'RECONSTRUCTED.md', stage, docs + '/RECONSTRUCTED.md')
    copy_file(PACKAGE / 'provenance.json', stage, docs + '/reconstruction-provenance.json')
    if kind == 'server':
        copy_tree(PROJECT / 'game', stage, 'usr/lib/blackroot/game')
        copy_tree(PACKAGE / 'launcher', stage, 'usr/lib/blackroot')
        copy_tree(PACKAGE / 'vendor/node', stage, 'usr/lib/blackroot/node')
        copy_tree(PACKAGE / 'vendor/ws', stage, 'usr/lib/blackroot/game/server/node_modules/ws')
    for path in stage.rglob('*'):
        relative = path.relative_to(stage).as_posix()
        path.chmod(0o755 if path.is_dir() or relative in EXECUTABLES else 0o644)


def write_control(stage, kind):
    files = sorted(path for path in stage.rglob('*') if path.is_file())
    size = (sum(path.stat().st_size for path in files) + 1023) // 1024
    depends = ('python3 (>= 3.10), python3-gi, gir1.2-gtk-3.0, xdg-utils, '
               'libc6 (>= 2.28), libstdc++6 (>= 5), libgcc-s1') if kind == 'server' else f'blackroot-server (= {VERSION})'
    control = stage / 'DEBIAN'
    control.mkdir()
    (control / 'control').write_text(
        f'Package: blackroot-{kind}\nVersion: {VERSION}\nSection: games\nPriority: optional\n'
        f'Architecture: amd64\nMaintainer: Blackroot Project <noreply@localhost>\nInstalled-Size: {size}\n'
        f'Depends: {depends}\nDescription: Blackroot {kind} launcher - reconstructed alpha packaging\n'
        ' Reconstructed from the hash-verified alpha payload; not the original build recipe.\n')
    (control / 'md5sums').write_text(''.join(
        f'{digest(path, "md5")}  {path.relative_to(stage).as_posix()}\n' for path in files))
    control.chmod(0o755)
    for path in control.iterdir():
        path.chmod(0o644)


def build(output):
    recovered = verify_sources()
    output = output.resolve()
    # No overwrite: an existing installer/manifest must never be silently replaced.
    filenames = [f'blackroot-{kind}_{VERSION}_amd64.deb' for kind in ('server', 'client')]
    for name in filenames + ['manifest.json', 'SHA256SUMS']:
        if (output / name).exists():
            raise FileExistsError(output / name)
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, SOURCE_DATE_EPOCH=str(EPOCH), LC_ALL='C', TZ='UTC')
    results = []
    with tempfile.TemporaryDirectory(prefix='blackroot-reconstructed-build-') as temp:
        for kind, name in zip(('server', 'client'), filenames):
            stage = Path(temp) / kind
            stage.mkdir()
            stage.chmod(0o755)
            prepare_payload(stage, kind)
            write_control(stage, kind)
            for path in sorted(stage.rglob('*'), reverse=True):
                os.utime(path, (EPOCH, EPOCH))
            os.utime(stage, (EPOCH, EPOCH))
            subprocess.run(['dpkg-deb', '--root-owner-group', '--threads-max=1',
                            '--uniform-compression', '-Zxz', '-z6', '--build', str(stage), str(output / name)],
                           env=env, check=True)
            artifact = output / name
            results.append({'file': name, 'bytes': artifact.stat().st_size, 'sha256': digest(artifact)})
    manifest = {'status': 'RECONSTRUCTED', 'version': VERSION, 'source_date_epoch': EPOCH,
                'game_revision': json.loads((PACKAGE / 'provenance.json').read_text())['game_base_commit'],
                'game_patch': 'evidence/packaged-server-host.patch',
                'original_recipe_recovered': False, 'recipe_sha256': digest(Path(__file__)),
                'recovered_files_manifest_sha256': digest(PACKAGE / 'recovered-files.json'),
                'provenance_sha256': digest(PACKAGE / 'provenance.json'),
                'recovered_file_count': len(recovered), 'artifacts': results}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    (output / 'SHA256SUMS').write_text(''.join(f'{r["sha256"]}  {r["file"]}\n' for r in results))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    arguments = parser.parse_args()
    build(arguments.output)
