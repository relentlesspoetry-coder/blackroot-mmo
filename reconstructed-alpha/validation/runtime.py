#!/usr/bin/python3
"""Per-user local server supervisor. Never discovers or signals foreign PIDs."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time

INSTALL = Path(__file__).resolve().parent


def private_dir(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or path.stat().st_uid != os.getuid():
        raise RuntimeError(f'Unsafe private directory: {path}')
    path.chmod(0o700)
    return path


def paths():
    home = Path.home()
    return {
        'data': private_dir(Path(os.environ.get('XDG_DATA_HOME', home / '.local/share')) / 'blackroot'),
        'state': private_dir(Path(os.environ.get('XDG_STATE_HOME', home / '.local/state')) / 'blackroot'),
        'config': private_dir(Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / 'blackroot'),
    }


def configured_port(p):
    file = p['config'] / 'settings.json'
    port = json.loads(file.read_text()).get('port', 8282) if file.exists() else 8282
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError('settings.json port must be an integer from 1024 to 65535.')
    return port


def request(command='status'):
    p = paths()
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(2)
        try:
            s.connect(str(p['state'] / 'control.sock'))
        except (FileNotFoundError, ConnectionRefusedError):
            return {'state': 'stopped'}
        s.sendall((command + '\n').encode())
        return json.loads(s.recv(4096))


def start():
    status = request()
    if status['state'] != 'stopped':
        return status
    p = paths()
    # Detached supervisor owns the child, not this UI. Duplicate supervisors exit
    # before touching sockets or launching Node, under an exclusive flock.
    with open(p['state'] / 'launcher.log', 'ab') as log:
        subprocess.Popen([sys.executable, str(INSTALL / 'runtime.py'), '--supervise'],
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                         start_new_session=True, close_fds=True)
    for _ in range(100):
        time.sleep(.05)
        status = request()
        if status['state'] != 'stopped':
            return status
    raise RuntimeError(f'Server could not start. See {p["state"]}/launcher.log')


def supervise():
    os.umask(0o077)
    p = paths()
    fd = os.open(p['state'] / 'supervisor.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        port = configured_port(p)
        sock_path = p['state'] / 'control.sock'
        sock_path.unlink(missing_ok=True)
        status = {'state': 'starting', 'port': port, 'url': f'http://127.0.0.1:{port}/'}
        child = None
        stopping = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stopping.set())
        signal.signal(signal.SIGINT, lambda *_: stopping.set())
        with socket.socket(socket.AF_UNIX) as control:
            control.bind(str(sock_path))
            control.listen(8)
            control.settimeout(.2)
            try:
                # Occupied means stop, not connect to or terminate an unknown app.
                with socket.socket() as probe:
                    probe.bind(('127.0.0.1', port))
                env = os.environ.copy()
                env.pop('NODE_OPTIONS', None)
                env.pop('NODE_PATH', None)
                # Packaged content is read-only; editor writes require a source checkout.
                env.pop('BLACKROOT_EDIT_KEY', None)
                env.update(PORT=str(port), HOST='127.0.0.1', BLACKROOT_DATA_DIR=str(p['data']))
                log_path = p['state'] / 'server.log'
                if log_path.exists() and log_path.stat().st_size > 4 * 1024 * 1024:
                    log_path.replace(p['state'] / 'server.previous.log')
                child = subprocess.Popen([str(INSTALL / 'node/bin/node'), str(INSTALL / 'game/server/server.js')],
                                         cwd=INSTALL / 'game/server', env=env,
                                         stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, text=True, bufsize=1)
                def capture():
                    with open(log_path, 'a') as log:
                        for line in child.stdout:
                            log.write(line)
                            log.flush()
                            # Emitted by this exact child only after successful listen.
                            if status['state'] == 'starting' and f'Open http://localhost:{port} in your browser.' in line:
                                status['state'] = 'ready'
                reader = threading.Thread(target=capture, daemon=True)
                reader.start()
                started_at = time.monotonic()
                while not stopping.is_set():
                    if status['state'] == 'starting' and time.monotonic() - started_at > 120:
                        status.update(state='error', error=f'Startup timed out. Stop the server and inspect {log_path}.')
                    if child.poll() is not None:
                        status['state'] = 'error'
                        status['error'] = f'Server exited ({child.returncode}). See {log_path}'
                    try:
                        connection, _ = control.accept()
                    except socket.timeout:
                        continue
                    with connection:
                        connection.settimeout(1)
                        try:
                            command = connection.recv(128).decode().strip()
                            if command == 'stop':
                                status['state'] = 'stopping'
                                stopping.set()
                            connection.sendall(json.dumps(status).encode())
                        except (OSError, UnicodeError):
                            pass
            except Exception as exc:
                # Keep the error available to the UI until it requests Stop.
                status.update(state='error', error=str(exc))
                while not stopping.is_set():
                    try:
                        connection, _ = control.accept()
                    except socket.timeout:
                        continue
                    with connection:
                        connection.settimeout(1)
                        try:
                            if connection.recv(128).strip() == b'stop':
                                stopping.set()
                            connection.sendall(json.dumps(status).encode())
                        except OSError:
                            pass
            finally:
                if child is not None and child.poll() is None:
                    # Popen retains ownership of this exact child. No pidfile killing.
                    child.terminate()
                    # Do not escalate to SIGKILL: give the game's checkpoint time.
                    child.wait()
                sock_path.unlink(missing_ok=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--supervise', action='store_true')
    parser.add_argument('command', nargs='?', choices=['start', 'stop', 'status'])
    args = parser.parse_args()
    if args.supervise:
        supervise()
    else:
        print(json.dumps(start() if args.command == 'start' else request(args.command or 'status')))
