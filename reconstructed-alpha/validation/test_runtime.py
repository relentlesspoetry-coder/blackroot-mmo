import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = Path(__file__).parent

class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bk-deb-test-')
        self.root = Path(self.temp.name)
        self.install = self.root / 'install'
        (self.install / 'node/bin').mkdir(parents=True)
        (self.install / 'game/server').mkdir(parents=True)
        shutil.copy(SOURCE / 'runtime.py', self.install)
        node = self.install / 'node/bin/node'
        node.write_text('''#!/usr/bin/python3
import os, signal, socket, time
from pathlib import Path
s=socket.socket(); s.bind((os.environ['HOST'],int(os.environ['PORT']))); s.listen()
print('  Open http://localhost:'+os.environ['PORT']+' in your browser.',flush=True)
def stop(*_):
 Path(os.environ['BLACKROOT_DATA_DIR'],'saved').write_text('checkpoint'); raise SystemExit
signal.signal(signal.SIGTERM,stop)
while True: time.sleep(.1)
''')
        node.chmod(0o755)
        self.env = {**os.environ, 'XDG_DATA_HOME': str(self.root / 'data'),
                    'XDG_STATE_HOME': str(self.root / 'state'), 'XDG_CONFIG_HOME': str(self.root / 'config')}
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); self.port = sock.getsockname()[1]
        config = self.root / 'config/blackroot'
        config.mkdir(parents=True)
        (config / 'settings.json').write_text(json.dumps({'port': self.port}))

    def command(self, name):
        result = subprocess.run([sys.executable, str(self.install / 'runtime.py'), name], env=self.env,
                                text=True, capture_output=True, timeout=10, check=True)
        return json.loads(result.stdout)

    def wait(self, expected):
        for _ in range(100):
            value = self.command('status')
            if value['state'] == expected:
                return value
            time.sleep(.03)
        self.fail(f'Expected {expected}, got {value}')

    def tearDown(self):
        self.command('stop'); self.wait('stopped'); self.temp.cleanup()

    def test_start_repeat_stop_and_preserve(self):
        self.assertEqual(self.command('status')['state'], 'stopped')
        self.command('start'); self.wait('ready')
        self.assertEqual(self.command('start')['state'], 'ready')
        self.command('stop'); self.wait('stopped')
        save = self.root / 'data/blackroot/saved'
        self.assertEqual(save.read_text(), 'checkpoint')
        self.command('start'); self.wait('ready')
        self.assertEqual(save.read_text(), 'checkpoint')

    def test_simultaneous_start_one_supervisor(self):
        procs = [subprocess.Popen([sys.executable, str(self.install / 'runtime.py'), 'start'], env=self.env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(5)]
        for proc in procs:
            out, err = proc.communicate(timeout=10)
            self.assertEqual(proc.returncode, 0, err)
        self.wait('ready')
        self.assertEqual((self.root/'state/blackroot/server.log').read_text().count('Open http'), 1)

    def test_foreign_listener_untouched(self):
        with socket.socket() as other:
            other.bind(('127.0.0.1', self.port)); other.listen()
            self.command('start')
            status = self.wait('error')
            self.assertIn('Address already in use', status['error'])
            self.command('stop'); self.wait('stopped')
            self.assertEqual(other.getsockname()[1], self.port)

    def test_stale_socket(self):
        state = self.root/'state/blackroot'; state.mkdir(parents=True)
        with socket.socket(socket.AF_UNIX) as stale:
            stale.bind(str(state/'control.sock'))
        self.command('start'); self.wait('ready')

    def test_failed_child_reports_error_then_recovers(self):
        node = self.install/'node/bin/node'
        original = node.read_text()
        node.write_text('#!/usr/bin/python3\nraise SystemExit(7)\n')
        self.command('start')
        self.assertIn('(7)', self.wait('error')['error'])
        self.command('stop'); self.wait('stopped')
        node.write_text(original)
        self.command('start'); self.wait('ready')

if __name__ == '__main__':
    unittest.main()
