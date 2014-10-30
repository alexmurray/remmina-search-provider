/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/**
 * Remmina Search Provider for GNOME Shell
 *
 * Copyright (c) 2012 Alex Murray <murray.alex@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Main = imports.ui.main;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Params = imports.misc.params;
const Util = imports.misc.util;
const FileUtils = imports.misc.fileUtils;
const Lang = imports.lang;
const IconGrid = imports.ui.iconGrid;

let remminaApp = Shell.AppSystem.get_default().lookup_app("remmina");

const emblems = { 'NX': 'remmina-nx',
                  'RDP': 'remmina-rdp',
                  'SFTP': 'remmina-sftp',
                  'SSH': 'gnome-terminal',
                  'VNC': 'remmina-vnc',
                  'XDMCP': 'remmina-xdmcp' };
let provider = null;
const RemminaIconBin = new Lang.Class({
    Name: 'RemminaIconBin',

    _init: function(protocol, name) {
        this.actor = new St.Bin({ reactive: true,
                                  track_hover: true });
        this._protocol = protocol;
        this.icon = new IconGrid.BaseIcon(name,
                                          { showLabel: true,
                                            createIcon: Lang.bind(this, this.createIcon) } );

        this.actor.child = this.icon.actor;
        this.actor.label_actor = this.icon.label;
    },

    createIcon: function (size) {
        let box = new Clutter.Box();
        let icon;

        if (remminaApp) {
            icon = remminaApp.create_icon_texture(size);
        } else {
            icon = new St.Icon({ gicon: new Gio.ThemedIcon({name: 'remmina'}),
                                 icon_size: size });
        }
        box.add_child(icon);
        if (this._protocol in emblems) {
            // remmina emblems are fixed size of 22 pixels
            let size = 22;
            let emblem = new St.Icon({ gicon: new Gio.ThemedIcon({name: emblems[this._protocol]}),
                                       icon_size: size});
            box.add_child(emblem);
        }
        return box;
    }
});

const RemminaSearchProvider = new Lang.Class({
    Name: 'RemminaSearchProvider',

    _init: function (name) {
        this.id = 'remmina';

        this._sessions = [];

        let path = GLib.build_filenamev([GLib.get_home_dir(), '/.remmina']);
        let dir = Gio.file_new_for_path(path);
        let monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        monitor.connect('changed', Lang.bind(this, this._onMonitorChanged));
        /* save a reference so we can cancel it on disable */
        this._remminaMonitor = monitor;

        this.listDirAsync(dir, Lang.bind(this, function (files) {
            files.map(function (f) {
                let name = f.get_name();
                let file_path = GLib.build_filenamev([path, name]);
                let file = Gio.file_new_for_path(file_path);
                this._onMonitorChanged(this._remminaMonitor, file,
                                       null, Gio.FileMonitorEvent.CREATED);
            }, this);
        }));
    },

    _onMonitorChanged: function(monitor, file, other_file, type) {
        let path = file.get_path();
        if (type == Gio.FileMonitorEvent.CREATED ||
            type == Gio.FileMonitorEvent.CHANGED ||
            type == Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
            let keyfile = new GLib.KeyFile();
            try {
                keyfile.load_from_file(path, 0);
            } catch (e) {
                return;
            }

            if (!keyfile.has_group('remmina')) {
                return;
            }
            let name = keyfile.get_string('remmina', 'name');
            if (name) {
                // get the type of session so we can use different
                // icons for each
                let protocol = keyfile.get_string('remmina', 'protocol');
                let session = { name: name,
                                protocol: protocol,
                                file: path };
                // if this session already exists in _sessions then
                // delete and add again to update it
                for (let i = 0; i < this._sessions.length; i++) {
                    let s = this._sessions[i];
                    if (s.file == session.file) {
                        this._sessions.splice(i, 1);
                        break;
                    }
                }
                this._sessions.push(session);
            }
        } else if (type == Gio.FileMonitorEvent.DELETED) {
            for (let i = 0; i < this._sessions.length; i++) {
                let s = this._sessions[i];
                if (s.file == path) {
                    /* remove the current element from _sessions */
                    this._sessions.splice(i, 1);
                    break;
                }
            }
        }
    },

    // steal from FileUtils since doesn't exist in FileUtils anymore
    // since GNOME 3.12
    listDirAsync: function(file, callback) {
        let allFiles = [];
        file.enumerate_children_async('standard::name,standard::type',
                                      Gio.FileQueryInfoFlags.NONE,
                                      GLib.PRIORITY_LOW, null,
                                      function (obj, res) {
                                          let enumerator = obj.enumerate_children_finish(res);
                                          function onNextFileComplete(obj, res) {
                                              let files = obj.next_files_finish(res);
                                              if (files.length) {
                                                  allFiles = allFiles.concat(files);
                                                  enumerator.next_files_async(100, GLib.PRIORITY_LOW, null, onNextFileComplete);
                                              } else {
                                                  enumerator.close(null);
                                                  callback(allFiles);
                                              }
                                          }
                                          enumerator.next_files_async(100, GLib.PRIORITY_LOW, null, onNextFileComplete);
                                      });
    },

    createResultObject: function (result, terms) {
        let icon = new RemminaIconBin(result.protocol, result.name);
        return icon;
    },

    filterResults: function (results, max) {
        return results.slice(0, max);
    },

    getResultMetas: function (ids, callback) {
        let metas = [];
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let session = null;
            // find session details
            for (let j = 0; !session && j < this._sessions.length; j++) {
                let _session = this._sessions[j];
                if (_session.file == id)
                    session = _session;
            }
            if (session != null) {
                metas.push({ id: id,
                             protocol: session.protocol,
                             name: session.name + ' (' + session.protocol + ')' });
            } else {
                log("failed to find session with id: " + id);
            }
        }
        callback(metas);
    },

    activateResult: function (id) {
        if (remminaApp) {
            remminaApp.launch(global.get_current_time(), ['-c', id], -1);
        } else {
            Util.spawn(['remmina', '-c', id]);
        }
    },

    _getResultSet: function (sessions, terms) {
        let results = [];
        // search for terms ignoring case - create re's once only for
        // each term and make sure matches all terms
        let res = terms.map(function (term) { return new RegExp(term, 'i'); });
        for (let i = 0; i < sessions.length; i++) {
            let session = sessions[i];
            let failed = false;
            for (let j = 0; !failed && j < res.length; j++) {
                let re = res[j];
                // search on name, protocol or the term remmina
                failed |= (session.name.search(re) < 0 &&
                           session.protocol.search(re) < 0 &&
                           'remmina'.search(re) < 0);
            }
            if (!failed) {
                results.push(session.file);
            }
        }
        return results;
    },

    getInitialResultSet: function (terms, callback, cancelable) {
        let results = this._getResultSet(this._sessions, terms);
        callback(results);
        return results;
    },

    getSubsearchResultSet: function (results, terms, callback, cancelable) {
        let results = this._getResultSet(this._sessions, terms);
        callback(results);
        return results;
    }
});

function init (meta) {
}

function enable () {
    if (!provider) {
        provider = new RemminaSearchProvider();
        Main.overview.viewSelector._searchResults._searchSystem.addProvider(provider);
    }
}

function disable() {
    if (provider) {
        Main.overview.viewSelector._searchResults._searchSystem._unregisterProvider(provider);
        Main.overview.viewSelector._searchResults._searchSystem.emit('providers-changed');
        provider._remminaMonitor.cancel();
        provider = null;
    }
}
