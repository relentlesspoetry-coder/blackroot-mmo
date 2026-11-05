#!/usr/bin/python3
"""GTK launchers; the client deliberately uses the user's WebGL-capable browser."""
import sys
import threading
import subprocess
import gi

gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, GLib
import runtime


class Launcher(Gtk.Window):
    def __init__(self, client=False):
        self.client = client
        self.busy = False
        self.pending_open = False
        super().__init__(title='Blackroot Client' if client else 'Blackroot Server')
        self.set_default_size(580, 360)
        self.set_border_width(18)
        self.connect('delete-event', self.close)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.add(box)
        title = Gtk.Label(label='Blackroot — Local Alpha')
        box.pack_start(title, False, False, 0)
        detail = ('Play in your default browser. The local server can be started for you.' if client else
                  'Local-only server. Closing this window leaves it running; Stop saves and shuts it down.')
        label = Gtk.Label(label=detail)
        label.set_line_wrap(True)
        box.pack_start(label, False, False, 0)
        self.status = Gtk.Label(label='Checking server…')
        self.status.set_line_wrap(True)
        box.pack_start(self.status, False, False, 0)
        buttons = Gtk.Box(spacing=8)
        box.pack_start(buttons, False, False, 0)
        self.play = Gtk.Button(label='Play' if client else 'Open game')
        self.play.connect('clicked', self.on_play)
        buttons.pack_start(self.play, True, True, 0)
        self.start_button = Gtk.Button(label='Start server')
        self.start_button.connect('clicked', lambda *_: self.run(runtime.start))
        buttons.pack_start(self.start_button, True, True, 0)
        self.stop = Gtk.Button(label='Stop server')
        self.stop.connect('clicked', self.on_stop)
        buttons.pack_start(self.stop, True, True, 0)
        self.log = Gtk.TextView(editable=False, monospace=True)
        self.log.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        scroll = Gtk.ScrolledWindow()
        scroll.add(self.log)
        box.pack_start(scroll, True, True, 0)
        note = Gtk.Label(label='Saves: ' + str(runtime.paths()['data']) + '\nInternet is required for browser dependencies.')
        note.set_selectable(True)
        note.set_line_wrap(True)
        box.pack_start(note, False, False, 0)
        self.show_all()
        GLib.timeout_add(750, self.refresh)
        self.refresh()

    def run(self, action, after=None):
        if self.busy:
            return
        self.busy = True
        def work():
            try:
                result = action()
            except Exception as exc:
                result = {'state': 'error', 'error': str(exc)}
            def deliver():
                self.finished(result)
                if after is not None:
                    after(result)
                return False
            GLib.idle_add(deliver)
        threading.Thread(target=work, daemon=True).start()

    def finished(self, result):
        self.busy = False
        self.status.set_text(result.get('error') or result['state'].capitalize())
        state = result['state']
        self.start_button.set_sensitive(state == 'stopped')
        self.stop.set_sensitive(state not in ('stopped', 'stopping'))
        self.play.set_sensitive(state not in ('starting', 'stopping', 'error'))
        if self.pending_open and state == 'ready':
            self.pending_open = False
            subprocess.Popen(['xdg-open', result['url']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if state == 'error':
            self.pending_open = False
        try:
            path = runtime.paths()['state'] / 'server.log'
            with open(path, 'rb') as file:
                file.seek(0, 2)
                file.seek(max(0, file.tell() - 16000))
                self.log.get_buffer().set_text(file.read().decode('utf-8', errors='replace'))
        except FileNotFoundError:
            pass
        return False

    def refresh(self):
        self.run(runtime.request)
        return True

    def on_play(self, *_):
        if self.busy:
            return
        self.run(runtime.request, self.play_status)

    def play_status(self, status):
        if status['state'] == 'stopped':
            dialog = Gtk.MessageDialog(transient_for=self, modal=True,
                message_type=Gtk.MessageType.QUESTION, buttons=Gtk.ButtonsType.YES_NO,
                text='Start the local Blackroot server and play?')
            response = dialog.run()
            dialog.destroy()
            if response != Gtk.ResponseType.YES:
                return
            self.pending_open = True
            self.run(runtime.start)
        elif status['state'] == 'ready':
            self.pending_open = True
            self.finished(status)

    def on_stop(self, *_):
        self.pending_open = False
        self.run(lambda: runtime.request('stop'))

    def close(self, *_):
        self.pending_open = False
        Gtk.main_quit()
        return False


if __name__ == '__main__':
    Launcher(client=len(sys.argv) > 1 and sys.argv[1] == 'client')
    Gtk.main()
