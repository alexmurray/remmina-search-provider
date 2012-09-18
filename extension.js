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
const Search = imports.ui.search;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;
const Util = imports.misc.util;
const FileUtils = imports.misc.fileUtils;
const Lang = imports.lang;

let provider = null;

const RemminaSearchProvider = new Lang.Class({
    Name: 'RemminaSearchProvider',
    Extends: Search.SearchProvider,

    _init: function (name) {
	this.parent("REMMINA REMOTE DESKTOP SESSIONS");

	this._sessions = [];

	let path = GLib.build_filenamev([GLib.get_home_dir(), '/.remmina']);
	let dir = Gio.file_new_for_path(path);
	let monitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
	monitor.connect('changed', Lang.bind(this, this._onMonitorChanged));
	/* save a reference so we can cancel it on disable */
	this._remminaMonitor = monitor;

	FileUtils.listDirAsync(dir, Lang.bind(this, function (files) {
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

	    if (!keyfile.has_group("remmina")) {
		return;
	    }
	    let name = keyfile.get_string("remmina", "name");
	    if (name) {
		let session = { name: name,
				file: path };
		/* make sure session doesn't already exist in _sessions */
		for (let i = 0; i < this._sessions.length; i++) {
		    let s = this._sessions[i];
		    if (s.file == session.file) {
			return;
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

    getResultMeta: function (id) {
	let app_sys = Shell.AppSystem.get_default();
	let app = app_sys.lookup_app('remmina.desktop');
	return meta = { id: id,
		        name: id.name,
		        createIcon: function (size) {
                            return app.create_icon_texture(size);
		        }
	              };
    },

    getResultMetas: function (ids) {
        return ids.map(this.getResultMeta, this);
    },

    activateResult: function (id) {
	Util.spawn([ 'remmina', '-c', id.file ]);
    },

    _getResultSet: function (sessions, terms) {
	let results = [];

	for (let i = 0; i < terms.length; i++) {
	    let re = new RegExp(terms[i]);
	    for (let j = 0; j < sessions.length; j++) {
	        let session = sessions[j];
	        if (session.name.search(re) >= 0) {
		    results.push(session);
                }
	    }
	}
	return results;
    },

    getInitialResultSet: function (terms) {
	return this._getResultSet(this._sessions, terms);
    },

    getSubsearchResultSet: function (results, terms) {
	return this._getResultSet(results, terms);
    }
});

function init (meta) {
}

function enable () {
    if (!provider) {
	provider = new RemminaSearchProvider();
	Main.overview.addSearchProvider(provider);
    }
}

function disable() {
    if (provider) {
	Main.overview.removeSearchProvider(provider);
	provider._remminaMonitor.cancel();
	provider = null;
    }
}