#!/usr/bin/env python3
"""Real extracted-package concurrency and foreign-server checks with disposable data."""
import argparse
import hashlib
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request


def verify(install, report):
    runtime = install / 'runtime.py'
    result = {'passed': False, 'checks': []}
    with tempfile.TemporaryDirectory(prefix='bk-recon-real-') as temp:
        root = Path(temp)
        env = dict(os.environ)
        for name, key in [('data', 'XDG_DATA_HOME'), ('state', 'XDG_STATE_HOME'), ('config', 'XDG_CONFIG_HOME')]:
            env[key] = str(root / name)
        config = root / 'config/blackroot'
        config.mkdir(parents=True)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        (config / 'settings.json').write_text(json.dumps({'port': port}))

        def command(action):
            response = subprocess.run([sys.executable, str(runtime), action], env=env,
                                      capture_output=True, text=True, check=True, timeout=15)
            return json.loads(response.stdout)

        def wait(state):
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                status = command('status')
                if status['state'] == state:
                    return status
                if state == 'ready' and status['state'] == 'error':
                    raise AssertionError(status)
                time.sleep(.05)
            raise AssertionError(f'Expected {state}; observed {status}')

        foreign = None
        foreign_thread = None
        try:
            version = subprocess.check_output([str(install / 'node/bin/node'), '--version'], text=True).strip()
            assert version == 'v24.22.2', version
            starts = [subprocess.Popen([sys.executable, str(runtime), 'start'], env=env,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(5)]
            for child in starts:
                out, err = child.communicate(timeout=15)
                assert child.returncode == 0, err.decode()
                assert json.loads(out)['state'] in ('starting', 'ready')
            ready = wait('ready')
            assert ready['url'] == f'http://127.0.0.1:{port}/'
            assert command('start')['state'] == 'ready'
            with urllib.request.urlopen(ready['url'], timeout=5) as response:
                assert response.status == 200 and b'<title>Blackroot</title>' in response.read()
            log = root / 'state/blackroot/server.log'
            assert log.read_text().count(f'Open http://localhost:{port} in your browser.') == 1
            result['checks'].append('five concurrent real starts and repeated start create one real game server')
            result['checks'].append('HTTP serves Blackroot from the owned ephemeral loopback port')
            command('stop')
            wait('stopped')
            checkpoint = root / 'data/blackroot/saves/world.checkpoint.json'
            assert checkpoint.is_file()
            checkpoint_hash = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
            result['checks'].append('graceful Stop writes a checkpoint in disposable XDG data')

            class ForeignHandler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'owned-disposable-foreign-marker')

                def log_message(self, *_):
                    pass

            foreign = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ForeignHandler)
            foreign_thread = threading.Thread(target=foreign.serve_forever, daemon=True)
            foreign_thread.start()
            foreign_port = foreign.server_address[1]
            (config / 'settings.json').write_text(json.dumps({'port': foreign_port}))
            command('start')
            error = wait('error')
            assert 'Address already in use' in error['error'], error
            command('stop')
            wait('stopped')
            with urllib.request.urlopen(f'http://127.0.0.1:{foreign_port}/', timeout=5) as response:
                assert response.read() == b'owned-disposable-foreign-marker'
            assert hashlib.sha256(checkpoint.read_bytes()).hexdigest() == checkpoint_hash
            result['checks'].append('occupied-port start refuses the foreign server; Stop leaves it serving its marker')
            result['checks'].append('existing disposable checkpoint survives a refused start and Stop')
            result.update(passed=True, node=version, game_port=port, foreign_test_port=foreign_port)
        finally:
            command('stop')
            wait('stopped')
            if foreign is not None:
                foreign.shutdown()
                foreign.server_close()
            if foreign_thread is not None:
                foreign_thread.join(timeout=5)
    result['cleanup'] = 'Only owned test processes and temporary XDG profile were used; all stopped and removed.'
    report.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('install', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    verify(args.install.resolve(), args.report)
