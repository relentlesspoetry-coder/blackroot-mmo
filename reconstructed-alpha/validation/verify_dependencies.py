#!/usr/bin/env python3
"""Compare recovered vendor files with independently downloaded upstream archives."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request


def download(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify(project, cache, report):
    cache.mkdir(parents=True, exist_ok=True)
    vendor = project / 'packaging/deb/vendor'
    version = '24.22.2'
    filename = f'node-v{version}-linux-x64.tar.xz'
    sums = download(f'https://nodejs.org/dist/v{version}/SHASUMS256.txt')
    (cache / 'SHASUMS256.txt').write_bytes(sums)
    expected = [line.split()[0] for line in sums.decode().splitlines() if line.split()[-1] == filename]
    assert len(expected) == 1, 'Official Node checksum entry missing or duplicated'
    archive = download(f'https://nodejs.org/dist/v{version}/{filename}')
    assert sha256(archive) == expected[0], 'Official Node archive checksum mismatch'
    (cache / filename).write_bytes(archive)
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:xz') as tar:
        binary = tar.extractfile(f'node-v{version}-linux-x64/bin/node').read()
        license_text = tar.extractfile(f'node-v{version}-linux-x64/LICENSE').read()
    assert binary == (vendor / 'node/bin/node').read_bytes(), 'Recovered Node binary differs from official archive'
    assert license_text == (project / 'packaging/deb/assets/usr/share/doc/blackroot-server/Node-LICENSE').read_bytes()
    lock = json.loads((project / 'game/server/package-lock.json').read_text())['packages']['node_modules/ws']
    ws_archive = download(lock['resolved'])
    assert lock['integrity'] == 'sha512-' + base64.b64encode(hashlib.sha512(ws_archive).digest()).decode(), 'ws lockfile integrity mismatch'
    (cache / 'ws.tgz').write_bytes(ws_archive)
    official = {}
    with tarfile.open(fileobj=io.BytesIO(ws_archive), mode='r:gz') as tar:
        for member in tar:
            if member.isfile():
                assert member.name.startswith('package/'), member.name
                official[member.name[len('package/'):]] = sha256(tar.extractfile(member).read())
    recovered = {p.relative_to(vendor / 'ws').as_posix(): sha256(p.read_bytes())
                 for p in (vendor / 'ws').rglob('*') if p.is_file()}
    assert official == recovered, 'Recovered ws file inventory differs from registry archive'
    result = {'passed': True, 'node_version': version, 'node_archive_sha256': expected[0],
              'node_binary_sha256': sha256(binary), 'node_license_matches': True,
              'ws_version': lock['version'], 'ws_archive_sha256': sha256(ws_archive),
              'ws_integrity': lock['integrity'], 'ws_files_matched': len(official),
              'note': 'Downloaded only official Node HTTPS distribution and lockfile-pinned npm archive. No installation.'}
    report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    verify(args.project.resolve(), args.cache, args.report)
