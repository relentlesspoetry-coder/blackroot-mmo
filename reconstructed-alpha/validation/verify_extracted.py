#!/usr/bin/python3
"""Non-install smoke: python3 verify_extracted.py /path/to/extracted/usr/lib/blackroot.
Uses a disposable XDG profile, ephemeral loopback port, and stops only its supervisor.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

install = Path(sys.argv[1]).resolve()
assert (install/'runtime.py').is_file()
with tempfile.TemporaryDirectory(prefix='blackroot-package-smoke-') as temp:
    root = Path(temp)
    env = dict(os.environ)
    for kind, key in [('data','XDG_DATA_HOME'), ('state','XDG_STATE_HOME'), ('config','XDG_CONFIG_HOME')]:
        env[key] = str(root/kind)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
    config = root/'config/blackroot'; config.mkdir(parents=True)
    (config/'settings.json').write_text(json.dumps({'port':port}))
    def command(cmd):
        proc = subprocess.run([sys.executable,str(install/'runtime.py'),cmd],env=env,text=True,capture_output=True,timeout=15)
        assert proc.returncode == 0, proc.stderr
        return json.loads(proc.stdout)
    try:
        print('START',command('start'))
        for _ in range(600):
            status = command('status')
            if status['state'] in ('ready','error'): break
            time.sleep(.2)
        assert status['state'] == 'ready', status
        response = urllib.request.urlopen(status['url'],timeout=10)
        assert response.status == 200 and b'<title>Blackroot</title>' in response.read()
        # Verify server listens on loopback ONLY, by matching this port in procfs.
        listeners=[]
        for file in ['/proc/net/tcp','/proc/net/tcp6']:
            for line in Path(file).read_text().splitlines()[1:]:
                cols=line.split(); address,p=cols[1].split(':')
                if int(p,16)==port and cols[3]=='0A': listeners.append(address)
        assert listeners == ['0100007F'], listeners
        js = """import WebSocket from './node_modules/ws/wrapper.mjs';
const w=new WebSocket(process.argv[1]); const t=setTimeout(()=>{console.error('WS timeout');process.exit(1)},5000);
w.on('error',e=>{console.error(e);process.exit(1)});w.on('open',()=>{console.log('WS upgrade OK');clearTimeout(t);w.close()});"""
        subprocess.run([str(install/'node/bin/node'),'--input-type=module','-e',js,f'ws://127.0.0.1:{port}'],
                       cwd=install/'game/server',check=True,timeout=10)
        print('PASS: bundled Node, HTTP game, websocket upgrade, loopback-only listener')
        print('STOP',command('stop'))
        for _ in range(300):
            if command('status')['state']=='stopped': break
            time.sleep(.1)
        else: raise AssertionError('Graceful stop did not complete')
        assert (root/'data/blackroot/saves/world.checkpoint.json').is_file(), 'Checkpoint missing'
        print('PASS: graceful Stop wrote checkpoint outside installation')
    finally:
        command('stop')
