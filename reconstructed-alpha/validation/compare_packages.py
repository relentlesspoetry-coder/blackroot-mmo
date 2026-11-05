#!/usr/bin/env python3
"""Independent DEB payload/control comparison; never imports the build recipe."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile

VERSION = '0.1.0~alpha.1+reconstructed.1'


def contents(deb, control=False):
    command = ['dpkg-deb', '--ctrl-tarfile' if control else '--fsys-tarfile', str(deb)]
    files = {}
    with subprocess.Popen(command, stdout=subprocess.PIPE) as child:
        with tarfile.open(fileobj=child.stdout, mode='r|') as archive:
            for entry in archive:
                path = PurePosixPath(entry.name)
                assert not path.is_absolute() and '..' not in path.parts, entry.name
                assert entry.uid == 0 and entry.gid == 0, entry.name
                assert not entry.mode & 0o022, entry.name
                if entry.isdir():
                    continue
                assert entry.isfile(), f'Unexpected link or special file: {entry.name}'
                name = path.as_posix()
                assert name not in files, f'Duplicate archive member: {name}'
                stream = archive.extractfile(entry)
                digest = hashlib.sha256()
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(chunk)
                files[name] = {'sha256': digest.hexdigest(), 'bytes': entry.size, 'mode': entry.mode}
        assert child.wait() == 0
    return files


def fields(deb):
    raw = subprocess.check_output(['dpkg-deb', '-f', str(deb)], text=True)
    return dict(line.split(': ', 1) for line in raw.splitlines() if ': ' in line and not line.startswith(' '))


def compare(originals, new, report):
    results = []
    for kind in ('server', 'client'):
        old_deb = originals / f'blackroot-{kind}_0.1.0~alpha.1_amd64.deb'
        new_deb = new / f'blackroot-{kind}_{VERSION}_amd64.deb'
        old, fresh = contents(old_deb), contents(new_deb)
        removed = sorted(old.keys() - fresh.keys())
        added = sorted(fresh.keys() - old.keys())
        changed = sorted(path for path in old.keys() & fresh.keys()
                         if old[path]['sha256'] != fresh[path]['sha256'])
        modes = sorted(path for path in old.keys() & fresh.keys() if old[path]['mode'] != fresh[path]['mode'])
        expected_added = sorted(f'usr/share/doc/blackroot-{kind}/{name}' for name in
                                ('RECONSTRUCTED.md', 'reconstruction-provenance.json'))
        assert not removed and not changed, {'removed': removed, 'changed': changed}
        assert added == expected_added, added
        assert set(contents(new_deb, control=True)) == {'control', 'md5sums'}, 'Unexpected maintainer scripts'
        control = fields(new_deb)
        assert control['Version'] == VERSION and control['Architecture'] == 'amd64'
        if kind == 'client':
            assert control['Depends'] == f'blackroot-server (= {VERSION})'
        assert not any('/accounts/' in '/' + name or '/saves/' in '/' + name or '/.git/' in '/' + name
                       or '/node_modules/playwright' in '/' + name for name in fresh)
        if kind == 'server':
            assert sum(name.endswith('.glb') for name in fresh) == 348
            for name in ('usr/lib/blackroot/node/bin/node', 'usr/bin/blackroot-server'):
                assert fresh[name]['mode'] == 0o755
        results.append({'package': kind, 'original_file_count': len(old), 'new_file_count': len(fresh),
                        'shared_files_byte_identical': len(old), 'removed': removed, 'added': added,
                        'content_changes': changed, 'mode_changes': modes, 'control': control})
    manifest = json.loads((new / 'manifest.json').read_text())
    for artifact in manifest['artifacts']:
        p = new / artifact['file']
        assert p.stat().st_size == artifact['bytes']
        assert hashlib.sha256(p.read_bytes()).hexdigest() == artifact['sha256']
    result = {'passed': True, 'packages': results,
              'checks': ['all shared payload bytes identical', 'only declared provenance additions',
                         'root-owned, non-world-writable archive entries', 'no maintainer scripts',
                         'exact-version client dependency', '348 GLBs', 'no packaged saves/accounts',
                         'manifest hashes and sizes']}
    report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('originals', type=Path)
    parser.add_argument('new', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    compare(args.originals, args.new, args.report)
