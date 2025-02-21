const path = require("path");
const fs = require("fs-extra");
const unzip = require("unzipper");
const copy = require("recursive-copy");
const { app, ipcMain } = require("electron");
const { https } = require("follow-redirects");

const json = require("./json");
const win = require("./window");
const version = require("./version");
const settings = require("./settings");

const cli = require("../cli");
const lang = require("../lang");

var mods = {
	installing: [],
	dupe_msg_sent: false,
}

function update_path() {
	mods.path = path.join(settings.gamepath, "R2Northstar/mods");
}; update_path();

// returns a list of mods
//
// it'll return 3 arrays, all, enabled, disabled. all being a
// combination of the other two, enabled being enabled mods, and you
// guessed it, disabled being disabled mods.
mods.list = () => {
	update_path();

	// make sure Northstar is actually installed
	if (version.northstar() == "unknown") {
		win.log(lang("general.notinstalled"));
		console.log("error: " + lang("general.notinstalled"));
		cli.exit(1);
		return false;
	}

	let enabled = [];
	let disabled = [];

	// return early if the mods folder doesn't even exist
	if (! fs.existsSync(mods.path)) {
		// create the folder for later
		fs.mkdirSync(path.join(mods.path), {recursive: true});

		return {
			enabled: [],
			disabled: [],
			all: []
		};
	}

	let files = fs.readdirSync(mods.path);
	files.forEach((file) => {
		// return early if `file` isn't a folder
		if (! fs.statSync(path.join(mods.path, file)).isDirectory()) {
			return;
		}

		let modjson = path.join(mods.path, file, "mod.json");
		
		// return early if mod.json doesn't exist or isn't a file
		if (! fs.existsSync(modjson) || ! fs.statSync(modjson).isFile()) {
			return;
		}

		let mod = json(modjson);
		if (! mod) {return}

		let obj = {
			Author: false,
			Version: "unknown",
			Name: "unknown",
			FolderName: file,
		...mod}

		obj.Disabled = ! mods.modfile.get(obj.Name);

		// add manifest data from manifest.json, if it exists
		let manifest_file = path.join(mods.path, file, "manifest.json");
		if (fs.existsSync(manifest_file)) {
			let manifest = json(manifest_file);
			if (manifest != false) {
				obj.ManifestName = manifest.name;
				if (obj.Version == "unknown") {
					obj.Version = manifest.version_number;
				}
			}
		}

		// add author data from author file, if it exists
		let author_file = path.join(mods.path, file, "thunderstore_author.txt");
		if (fs.existsSync(author_file)) {
			obj.Author = fs.readFileSync(author_file, "utf8");
		}

		// add mod to their respective disabled or enabled Array
		if (obj.Disabled) {
			disabled.push(obj);
		} else {
			enabled.push(obj);
		}
	})

	return {
		enabled: enabled,
		disabled: disabled,
		all: [...enabled, ...disabled]
	};
}

// gets information about a mod
//
// folder name, version, name and whatever else is in the mod.json, keep
// in mind if the mod developer didn't format their JSON file the
// absolute basics will be provided and we can't know the version or
// similar.
mods.get = (mod) => {
	update_path();

	// make sure Northstar is actually installed
	if (version.northstar() == "unknown") {
		win.log(lang("general.notinstalled"));
		console.log("error: " + lang("general.notinstalled"));
		cli.exit(1);
		return false;
	}

	// retrieve list of mods
	let list = mods.list().all;

	// search for mod in list
	for (let i = 0; i < list.length; i++) {
		if (list[i].Name == mod) {
			// found mod, return data
			return list[i];
		} else {continue}
	}

	// mod wasn't found
	return false;
}

// makes sure enabledmods.json exists
function modfile_pre() {
	mods.modfile.file = path.join(mods.path, "..", "enabledmods.json");

	// check that the folder enabledmods.json is in exists, and create
	// it if it doesn't exist
	if (! fs.existsSync(mods.path)) {
		fs.mkdirSync(path.join(mods.path), {recursive: true});
	}

	// check that enabledmods.json itself exists, and create it if not
	if (! fs.existsSync(mods.modfile.file)) {
		fs.writeFileSync(mods.modfile.file, "{}");
	}
}

// manages the enabledmods.json file
//
// it can both return info about the file, but also toggle mods in it,
// generate the file itself, and so on.
mods.modfile = {};

// generate the enabledmods.json file
mods.modfile.gen = () => {
	modfile_pre();

	let names = {};
	let list = mods.list().all; // get list of all mods
	for (let i = 0; i < list.length; i++) {
		// add every mod to the list
		names[list[i].Name] = true
	}

	// write the actual file
	fs.writeFileSync(mods.modfile.file, JSON.stringify(names));
}

// enable/disable a mod inside enabledmods.json
mods.modfile.set = (mod, state) => {
	modfile_pre();

	let data = json(mods.modfile.file); // get current data
	data[mod] = state; // set mod state

	// write new data
	fs.writeFileSync(mods.modfile.file, JSON.stringify(data));
}

// disable a mod inside enabledmods.json
mods.modfile.disable = (mod) => {
	return mods.modfile.set(mod, false);
}

// enable a mod inside enabledmods.json
mods.modfile.enable = (mod) => {
	return mods.modfile.set(mod, true);
}

// toggle a mod inside enabledmods.json
mods.modfile.toggle = (mod) => {
	modfile_pre();

	let data = json(mods.modfile.file);
	if (data[mod] != undefined) {
		data[mod] = ! data[mod];
	} else {
		data[mod] = false;
	}

	fs.writeFileSync(mods.modfile.file, JSON.stringify(data));
}

// return whether a mod is disabled or enabled
mods.modfile.get = (mod) => {
	modfile_pre();

	// read enabledmods.json
	let data = json(mods.modfile.file);

	if (data[mod]) { // enabled
		return true;
	} else if (data[mod] === false) { // disabled
		return false;
	} else { // fallback to enabled
		return true;
	}
}

// installs mods from a file path
//
// either a zip or folder is supported, we'll also try to search inside
// the zip or folder to see if buried in another folder or not, as
// sometimes that's the case.
mods.install = (mod, opts) => {
	update_path();

	let modname = mod.replace(/^.*(\\|\/|\:)/, "");

	opts = {
		forked: false,
		author: false,
		destname: false,
		malformed: false,
		manifest_file: false,
		...opts
	}

	if (! opts.forked) {
		mods.installing = [];
		mods.dupe_msg_sent = false;
	}

	if (version.northstar() == "unknown") {
		win.log(lang("general.notinstalled"));
		console.log("error: " + lang("general.notinstalled"));
		cli.exit(1);
		return false;
	}

	let notamod = () => {
		win.log(lang("gui.mods.notamod"));
		console.log("error: " + lang("cli.mods.notamod"));
		cli.exit(1);
		return false;
	}

	let installed = () => {
		console.log(lang("cli.mods.installed"));
		cli.exit();

		win.log(lang("gui.mods.installedmod"));

		if (modname == "mods") {
			let manifest = path.join(app.getPath("userData"), "Archives/manifest.json");

			if (fs.existsSync(manifest)) {
				modname = require(manifest).name;
			}
		}

		ipcMain.emit("installed-mod", "", {
			name: modname,
			malformed: opts.malformed,
		});

		ipcMain.emit("gui-getmods");
		return true;
	}

	if (! fs.existsSync(mod)) {return notamod()}

	if (fs.statSync(mod).isDirectory()) {
		win.log(lang("gui.mods.installing"));
		files = fs.readdirSync(mod);
		if (fs.existsSync(path.join(mod, "mod.json")) &&
			fs.statSync(path.join(mod, "mod.json")).isFile()) {


			if (! json(path.join(mod, "mod.json"))) {
				ipcMain.emit("failed-mod");
				return notamod();
			}

			if (fs.existsSync(path.join(mods.path, modname))) {
				fs.rmSync(path.join(mods.path, modname), {recursive: true});
			}

			let copydest = path.join(mods.path, modname);
			if (typeof opts.destname == "string") {
				copydest = path.join(mods.path, opts.destname)
			}

			copy(mod, copydest, (err) => {
				if (err) {
					ipcMain.emit("failed-mod");
					return;
				}

				copy(opts.manifest_file, path.join(copydest, "manifest.json"), (err) => {
					if (err) {
						ipcMain.emit("failed-mod");
						return;
					}

					if (opts.author) {
						fs.writeFileSync(
							path.join(copydest, "thunderstore_author.txt"),
							opts.author
						)
					}

					return installed();
				});
			});

			return;
		} else {
			mod_files = fs.readdirSync(mod);

			for (let i = 0; i < mod_files.length; i++) {
				if (fs.statSync(path.join(mod, mod_files[i])).isDirectory()) {
					if (fs.existsSync(path.join(mod, mod_files[i], "mod.json")) &&
						fs.statSync(path.join(mod, mod_files[i], "mod.json")).isFile()) {

						let mod_name = mod_files[i];
						let use_mod_name = false;

						while (mods.installing.includes(mod_name)) {
							if (! mods.dupe_msg_sent) {
								mods.dupe_msg_sent = true;
								ipcMain.emit("duped-mod", "", mod_name);
							}

							use_mod_name = true;
							mod_name = mod_name + " (dupe)";
						}

						mods.installing.push(mod_name);

						let install = false;
						if (use_mod_name) {
							install = mods.install(path.join(mod, mod_files[i]), {
								...opts,
								forked: true,
								destname: mod_name,
							})
						} else {
							install = mods.install(path.join(mod, mod_files[i]), {
								...opts,
								forked: true
							})
						}

						if (install) {return true};
					}
				}
			}

			return notamod();
		}
	} else {
		win.log(lang("gui.mods.extracting"));
		let cache = path.join(app.getPath("userData"), "Archives");
		if (fs.existsSync(cache)) {
			fs.rmSync(cache, {recursive: true});
			fs.mkdirSync(path.join(cache, "mods"), {recursive: true});
		} else {
			fs.mkdirSync(path.join(cache, "mods"), {recursive: true});
		}

		try {
			if (mod.replace(/.*\./, "").toLowerCase() == "zip") {
				fs.createReadStream(mod).pipe(unzip.Extract({path: cache}))
				.on("finish", () => {
					setTimeout(() => {
						let manifest = path.join(cache, "manifest.json");
						if (fs.existsSync(manifest)) {
							files = fs.readdirSync(path.join(cache, "mods"));
							if (fs.existsSync(path.join(cache, "mods/mod.json"))) {
								if (mods.install(path.join(cache, "mods"), {
										...opts,

										forked: true,
										malformed: true,
										manifest_file: manifest,
										destname: require(manifest).name
									})) {

									return true;
								}
							} else {
								for (let i = 0; i < files.length; i++) {
									let mod = path.join(cache, "mods", files[i]);
									if (fs.statSync(mod).isDirectory()) {
										setTimeout(() => {
											if (mods.install(mod, {
													...opts,
													forked: true,
													destname: false,
													manifest_file: manifest
												})) {

												return true
											}
										}, 1000)
									}
								}

								if (files.length == 0) {
									ipcMain.emit("failed-mod");
									return notamod();
								}
							}

							return notamod();
						}

						if (mods.install(cache, {
							...opts,
							forked: true
						})) {
							installed();
						} else {return notamod()}
					}, 1000)
				});
			} else {
				return notamod();
			}
		}catch(err) {return notamod()}
	}
}

// installs mods from URL's
//
// this'll simply download the file that the URL points to and then
// install it with mods.install()
mods.installFromURL = (url, author) => {
	update_path();

	// download mod to a temporary location
	https.get(url, (res) => {
		let tmp = path.join(app.getPath("cache"), "vipertmp");
		let modlocation = path.join(tmp, "/mod.zip");

		// make sure the temporary folder exists
		if (fs.existsSync(tmp)) {
			if (! fs.statSync(tmp).isDirectory()) {
				fs.rmSync(tmp);
			}
		} else {
			fs.mkdirSync(tmp);
			if (fs.existsSync(modlocation)) {
				fs.rmSync(modlocation);
			}
		}

		// write out the file to the temporary location
		let stream = fs.createWriteStream(modlocation);
		res.pipe(stream);

		stream.on("finish", () => {
			stream.close();

			// attempt to install the downloaded mod
			mods.install(modlocation, {
				author: author
			})
		})
	})
}

// removes mods
//
// takes in the names of the mod then removes it, no confirmation,
// that'd be up to the GUI.
mods.remove = (mod) => {
	update_path();

	// make sure Northstar is actually installed
	if (version.northstar() == "unknown") {
		win.log(lang("general.notinstalled"));
		console.log("error: " + lang("general.notinstalled"));
		cli.exit(1);
		return false;
	}

	// removes all mods installed, no exceptions
	if (mod == "allmods") {
		let modlist = mods.list().all;
		for (let i = 0; i < modlist.length; i++) {
			mods.remove(modlist[i].Name);
		}
		return
	}

	let mod_name = mods.get(mod).FolderName;
	if (! mod_name) {
		console.log("error: " + lang("cli.mods.cantfind"));
		cli.exit(1);
		return;
	}

	let path_to_mod = path.join(mods.path, mod_name);

	// return early if path_to_mod isn't a folder
	if (! fs.statSync(path_to_mod).isDirectory()) {
		return cli.exit(1);
	}

	let manifestname = null;

	// if the mod has a manifest.json we want to save it now so we can
	// send it later when telling the renderer about the deleted mod
	if (fs.existsSync(path.join(path_to_mod, "manifest.json"))) {
		manifestname = require(path.join(path_to_mod, "manifest.json")).name;
	}

	// actually remove the mod itself
	fs.rmSync(path_to_mod, {recursive: true});

	console.log(lang("cli.mods.removed"));
	cli.exit();

	ipcMain.emit("gui-getmods"); // send updated list to renderer

	// tell the renderer that the mod has been removed, along with
	// relevant info for it to properly update everything graphically
	ipcMain.emit("removed-mod", "", {
		name: mod.replace(/^.*(\\|\/|\:)/, ""),
		manifestname: manifestname
	});
}

// toggles mods
//
// if a mod is enabled it'll disable it, vice versa it'll enable it if
// it's disabled. You could have a direct .disable() function if you
// checked for if a mod is already disable and if not run the function.
// However we currently have no need for that.
mods.toggle = (mod, fork) => {
	update_path();

	// make sure Northstar is actually installed
	if (version.northstar() == "unknown") {
		win.log(lang("general.notinstalled"));
		console.log("error: " + lang("general.notinstalled"));
		cli.exit(1);
		return false;
	}

	// toggles all mods, thereby inverting the current enabled states
	if (mod == "allmods") {
		let modlist = mods.list().all; // get list of all mods
		for (let i = 0; i < modlist.length; i++) { // run through list
			mods.toggle(modlist[i].Name, true); // enable mod
		}

		console.log(lang("cli.mods.toggledall"));
		cli.exit(0);
		return
	}

	// toggle specific mod
	mods.modfile.toggle(mod);

	if (! fork) {
		console.log(lang("cli.mods.toggled"));
		cli.exit();
	}

	// send updated modlist to renderer
	ipcMain.emit("gui-getmods");
}

module.exports = mods;
