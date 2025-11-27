/* -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*- */
/**
 * Remmina Search Provider for GNOME Shell
 *
 * Copyright (c) 2020 Alex Murray <murray.alex@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
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

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as Search from 'resource:///org/gnome/shell/ui/search.js';

let remminaApp = null;

const emblems = {
    'NX': ['remmina-nx', 'org.remmina.Remmina-nx'],
    'RDP': ['remmina-rdp', 'org.remmina.Remmina-rdp'],
    'SFTP': ['remmina-sftp', 'org.remmina.Remmina-sftp'],
    'SPICE': ['remmina-spice', 'org.remmina.Remmina-spice'],
    'SSH': ['remmina-ssh', 'org.remmina.Remmina-ssh', 'gnome-terminal', 'org.gnome.Terminal', 'x-term'],
    'VNC': ['remmina-vnc', 'org.remmina.Remmina-vnc'],
    'XDMCP': ['remmina-xdmcp', 'org.remmina.Remmina-xdmcp']
};
let provider = null;

var RemminaSearchProvider = class RemminaSearchProvider_SearchProvider {
    _getDataDirPaths() {
        // remmina stores its configuration in ~/.config/remmina/remmina.pref -
        // this may also be within a snap -
        // ie. ~/snap/remmina/current/.config/remmina/remmina.pref or flatpak -
        // ~/.var/app/org.remmina.Remmina/config/remmina/remmina.pref - from
        // each of these files parse it as a gkeyfile and get the
        // remmina_pref.datadir_path value from each - however if the value is
        // not set then we need to try and use the same default that remmina
        // itself uses
        let dirs = new Map([
            [GLib.build_filenamev([GLib.get_home_dir(), '.config', 'remmina']), GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'remmina'])],
            [GLib.build_filenamev([GLib.get_home_dir(), 'snap', 'remmina', 'current', '.config', 'remmina']),  GLib.build_filenamev([GLib.get_home_dir(), 'snap', 'remmina', 'current', '.local', 'share', 'remmina'])],
            [GLib.build_filenamev([GLib.get_home_dir(), '.var', 'app', 'org.remmina.Remmina', 'config', 'remmina'] ),  GLib.build_filenamev([GLib.get_home_dir(), '.var', 'app', 'org.remmina.Remmina', 'data', 'remmina'])]
        ]);
        let paths = [];
        dirs.forEach((default_datadir, dir_path, _) => {
            let pref_file_path = GLib.build_filenamev([dir_path, 'remmina.pref']);
            let pref_file = Gio.file_new_for_path(pref_file_path);
            if (pref_file.query_exists(null)) {
                let keyfile = new GLib.KeyFile();
                try {
                    keyfile.load_from_file(pref_file_path, 0);
                    if (keyfile.has_group('remmina_pref')) {
                        let data_dir = keyfile.get_string('remmina_pref', 'datadir_path');
                        // if data_dir is empty then default to data/remmina in the
                        if (!data_dir || data_dir == "") {
                            console.debug("remmina pref datadir_path empty - using default: " + default_datadir);
                            data_dir = default_datadir;
                        }
                        if (paths.indexOf(data_dir) < 0) {
                            paths.push(data_dir);
                        }
                    } else {
                        console.warn("remmina_pref group not found in remmina pref file: " + pref_file_path);
                    }
                    keyfile = null;
                } catch (e) {
                    console.warn("Failed to load remmina pref file: " + pref_file_path + ": " + e.toString());
                }
            }

        }
        , this);
        return paths;
    }

    _monitorRemminaDir(path) {
        let dir = Gio.file_new_for_path(path);
        let monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        monitor.connect('changed', (monitor, file, other_file, type) => {
            this._onMonitorChanged(monitor, file, other_file, type);
        });
        /* save a reference so we can cancel it on disable */
        this._remminaMonitors.push(monitor);

        this._listDirAsync(dir, (files) => {
            files.map((f) => {
                let name = f.get_name();
                let file_path = GLib.build_filenamev([path, name]);
                let file = Gio.file_new_for_path(file_path);
                this._onMonitorChanged(monitor, file,
                                       null, Gio.FileMonitorEvent.CREATED);
            }, this);
        });
    }

    constructor(name) {
        this.id = 'remmina';

        this._sessions = [];
        this._remminaMonitors = [];

        let paths = this._getDataDirPaths();
        for (let i = 0; i < paths.length; i++) {
            this._monitorRemminaDir(paths[i]);
        }
    }

    _onMonitorChanged(monitor, file, other_file, type) {
        let path = file.get_path();
        if (type == Gio.FileMonitorEvent.CREATED ||
            type == Gio.FileMonitorEvent.CHANGED ||
            type == Gio.FileMonitorEvent.CHANGES_DONE_HINT) {
            let keyfile = new GLib.KeyFile();
            try {
                keyfile.load_from_file(path, 0);
            } catch (e) {
                console.warn("Failed to load remmina session file: " + path + ": " + e.toString());
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
                let server = keyfile.get_string('remmina', 'server');
                let group = keyfile.get_string('remmina', 'group');
                let session = { name: name,
                                protocol: protocol,
                                server: server,
                                group: group,
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
            } else {
                console.warn("Remmina session missing name in file: " + path);
            }
                keyfile = null;
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
    }

    // steal from FileUtils since doesn't exist in FileUtils anymore
    // since GNOME 3.12
    _listDirAsync(file, callback) {
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
    }

    createResultObject(metaInfo, terms) {
        metaInfo.createIcon = (size) => {
            let theme = new St.IconTheme();
            // add snap icon search path
            let snapIconPath = GLib.build_filenamev(['/snap', 'remmina', 'current', 'usr', 'share', 'icons']);
            if (GLib.file_test(snapIconPath, GLib.FileTest.IS_DIR)) {
                theme.append_search_path(snapIconPath);
            }
            let box = new St.BoxLayout();
            let icon = null;

            if (remminaApp) {
                icon = remminaApp.create_icon_texture(size);
            }

            if (!icon || !icon.gicon) {
                // try the app icon
                let gicon = null;
                id = remminaApp.get_id();
                if (theme.has_icon(id)) {
                    gicon = new Gio.ThemedIcon({name: id});
                }
                if (!gicon)
                    // this should not happen in general so log if it does
                    console.debug("Failed to find icon for remmina");
                // handle display scaling
                let scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                icon = new St.Icon({ gicon: gicon,
                                     icon_size: size / scale_factor });
            }
            box.add_child(icon);
            if (metaInfo.protocol in emblems) {
                // remmina emblems are fixed size of 22 pixels
                let size = 22;
                let names = emblems[metaInfo.protocol];
                let name = null;
                let found = false;
                for (let n = 0; !found && n < names.length; n++) {
                    name = names[n];
                    found = theme.has_icon(name);
                    if (!found) {
                        // also try with -symbolic suffix
                        name = name + '-symbolic';
                        found = theme.has_icon(name);
                    }
                }
                if (found) {
                    let emblem = new St.Icon({ gicon: new Gio.ThemedIcon({name: name}),
                        icon_size: size });
                    box.add_child(emblem);
                } else {
                    console.debug("Failed to find emblem icon for protocol: " + metaInfo.protocol);
                }
            } else {
                console.debug("No emblem defined for protocol: " + metaInfo.protocol);
            }
            return box;
        };
        return new Search.GridSearchResult(provider, metaInfo, Main.overview.searchController._searchResults);
    }

    filterResults(results, max) {
        return results.slice(0, max);
    }

    _wrapText(str, maxWidth) {
        return str.replace(
            new RegExp(`(?![^\\n]{1,${maxWidth}}$)([^\\n]{1,${maxWidth}})\\s`, 'g'),
            '$1\n');
    }

    async getResultMetas(ids, cancellable) {
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
                let prefix = ((session.group && session.group != "") ?
                              ("[" + session.group + "] ") : "");
                let name = this._wrapText(prefix + session.name + ' (' + session.protocol + ')',
                                          // TODO: Wrap at max label width
                                          15);

                metas.push({ id: id,
                             protocol: session.protocol,
                             description: session.server,
                             name: name });
            } else {
                console.warn("failed to find session with id: " + id);
            }
        }
        return metas;
    }

    activateResult(id, terms) {
        if (remminaApp) {
            remminaApp.app_info.launch([Gio.file_new_for_path(id)], null);
        } else {
            Util.spawn(['remmina', '-c', id]);
        }
        // specifically hide the overview -
        // https://github.com/alexmurray/remmina-search-provider/issues/19
        Main.overview.hide();
    }

    _getResultSet(sessions, terms, cancellable) {
        let results = [];
        // search for terms ignoring case - create re's once only for
        // each term and make sure matches all terms
        let res = terms.map(function (term) { return new RegExp(term, 'i'); });
        for (let i = 0; i < sessions.length; i++) {
            let session = sessions[i];
            let failed = false;
            for (let j = 0; !failed && j < res.length; j++) {
                let re = res[j];
                // search on name, group, protocol or the term remmina
                failed |= (session.name.search(re) < 0 &&
                           session.group.search(re) < 0 &&
                           session.protocol.search(re) < 0 &&
                           'remmina'.search(re) < 0);
            }
            if (!failed) {
                results.push(session.file);
            }
        }
        return results;
    }

    async getInitialResultSet(terms, cancellable) {
        let realResults = this._getResultSet(this._sessions, terms, cancellable);
        return realResults;
    }

    async getSubsearchResultSet(results, terms, cancellable) {
        return this.getInitialResultSet(terms, cancellable);
    }
};

export default class RemminaSearchProviderExtension {
    enable () {
        if (!remminaApp) {
            // desktop id changed in recent releases and make sure to include
            // snap/flatpak ids too
            let ids = ["org.remmina.Remmina", "remmina_remmina", "remmina", "remmina-file"];
            for (let i = 0; i < ids.length; i++) {
                remminaApp = Shell.AppSystem.get_default().lookup_app(ids[i] + ".desktop");
                if (remminaApp) {
                    break;
                }
            }
            if (!remminaApp) {
                console.warn("Failed to find remmina application");
                let installed = Shell.AppSystem.get_default().get_installed();
                installed.forEach((app) => {
                    // log all installed apps for debugging in case one of them is a new variant of remmina
                    console.debug("Installed app: " + app.get_id());
                });
            }
        }
        // only create the provider if remmina app is found otherwise we can't
        // show icons or launch remmina so there is no point
        if (!provider && remminaApp) {
            provider = new RemminaSearchProvider();
            Main.overview.searchController.addProvider(provider);
        }
    }

    disable() {
        if (provider) {
            Main.overview.searchController.removeProvider(provider);
            for (let i = 0; i < provider._remminaMonitors.length; i++) {
                provider._remminaMonitors[i].cancel();
                provider._remminaMonitors[i] = null;
            }
            provider = null;
        }
        if (remminaApp) {
            remminaApp = null;
        }
    }

}
