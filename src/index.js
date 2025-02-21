const fs = require("fs");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { app, ipcMain, BrowserWindow, dialog } = require("electron");

// ensures PWD/CWD is the config folder where viper.json is located
process.chdir(app.getPath("appData"));

const cli = require("./cli");
const lang = require("./lang");

const json = require("./modules/json");
const kill = require("./modules/kill");
const mods = require("./modules/mods");
const update = require("./modules/update");
const launch = require("./modules/launch");
const win_show = require("./modules/window");
const version = require("./modules/version");
const gamepath = require("./modules/gamepath");
const settings = require("./modules/settings");
const requests = require("./modules/requests");
const is_running = require("./modules/is_running");

var log = console.log;

// Starts the actual BrowserWindow, which is only run when using the
// GUI, for the CLI this function is never called.
function start() {
	win = new BrowserWindow({
		width: 1000,
		height: 600,
		title: "Viper",

		// Hides the window initially, it'll be shown when the DOM is
		// loaded, as to not cause visual issues.
		show: false,

		// In the future we may want to allow the user to resize the window,
		// as it's fairly responsive, but for now we won't allow that.
		resizable: false,

		userAgent: "test",

		frame: false,
		titleBarStyle: "hidden",
		icon: path.join(__dirname, "assets/icons/512x512.png"),
		webPreferences: {
			webviewTag: true,
			nodeIntegration: true,
			contextIsolation: false,
		},
	});

	// when --devtools is added it'll open the dev tools
	if (cli.hasParam("devtools")) {win.openDevTools()}

	// general setup
	win.removeMenu();
	win.loadURL("file://" + __dirname + "/app/index.html", {
		userAgent: "viper/" + json(path.join(__dirname, "../package.json")).version,
	});

	win.send = (channel, data) => {
		win.webContents.send(channel, data);
	}; send = win.send;

	ipcMain.on("exit", () => {
		if (settings.originkill) {
			is_running.origin().then((running) => {
				if (running) {
					kill.origin().then(process.exit(0))
				} else {
					process.exit(0)	
				}
			})
		} else {
			process.exit(0)
		}
	});
	ipcMain.on("minimize", () => {win.minimize()});
	ipcMain.on("relaunch", () => {app.relaunch(); app.exit()});

	// passthrough to renderer from main
	ipcMain.on("win-log", (event, ...args) => {send("log", ...args)});
	ipcMain.on("win-alert", (event, ...args) => {send("alert", ...args)});

	// mod states
	ipcMain.on("duped-mod", (event, modname) => {send("duped-mod", modname)});
	ipcMain.on("failed-mod", (event, modname) => {send("failed-mod", modname)});
	ipcMain.on("removed-mod", (event, modname) => {send("removed-mod", modname)});
	ipcMain.on("gui-getmods", (event, ...args) => {send("mods", mods.list())});
	ipcMain.on("installed-mod", (event, modname) => {send("installed-mod", modname)});
	ipcMain.on("no-internet", () => {send("no-internet")});

	process.on("uncaughtException", (err) => {
		send("unknown-error", err);
		console.error(err);
	});

	// install calls
	ipcMain.on("install-from-path", (event, path) => {mods.install(path)});
	ipcMain.on("install-from-url", (event, url, author) => {mods.installFromURL(url, author)});

	win.webContents.on("dom-ready", () => {
		send("mods", mods.list());
	});

	// ensures gamepath still exists and is valid on startup
	let gamepathlost = false;
	ipcMain.on("gamepath-lost", (event, ...args) => {
		if (! gamepathlost) {
			gamepathlost = true;
			send("gamepath-lost");
		}
	});

	ipcMain.on("save-settings", (event, obj) => {settings.save(obj)});

	// allows renderer to check for updates
	ipcMain.on("ns-update-event", (event) => {send("ns-update-event", event)});
	ipcMain.on("can-autoupdate", () => {
		if (! autoUpdater.isUpdaterActive() || cli.hasParam("no-vp-updates")) {
			send("cant-autoupdate");
		}
	})

	// start auto-update process
	if (settings.autoupdate) {
		if (cli.hasParam("no-vp-updates")) {
			update.northstar_autoupdate();
		} else {
			update.viper(false)
		}
	} else {
		update.northstar_autoupdate();
	}

	autoUpdater.on("update-downloaded", () => {
		send("update-available");
	});

	// updates and restarts Viper, if user says yes to do so.
	// otherwise it'll do it on the next start up.
	ipcMain.on("update-now", () => {
		autoUpdater.quitAndInstall();
	})
}

ipcMain.on("install-mod", () => {
	if (cli.hasArgs()) {
		mods.install(cli.param("installmod"));
	} else {
		dialog.showOpenDialog({properties: ["openFile"]}).then(res => {
			if (res.filePaths.length != 0) {
				mods.install(res.filePaths[0]);
			} else {
				send("set-buttons", true);
			}
		}).catch(err => {error(err)});
	}
})

ipcMain.on("remove-mod", (event, mod) => {mods.remove(mod)});
ipcMain.on("toggle-mod", (event, mod) => {mods.toggle(mod)});

ipcMain.on("launch-ns", () => {launch()});
ipcMain.on("launch-vanilla", () => {launch("vanilla")});

ipcMain.on("setlang", (event, lang) => {
	settings.lang = lang;
	settings.save();
});

ipcMain.on("update-northstar", async () => {
	if (await is_running.game()) {
		return win_show.alert(lang("general.autoupdates.gamerunning"));
	}

	update.northstar();
})

ipcMain.on("setpath-cli", () => {gamepath.set()});
ipcMain.on("setpath", (event, value) => {
	if (! value) {
		if (! win.isVisible()) {
			gamepath.set(win);
		} else {
			gamepath.set(win, true);
		}
	} else if (! win.isVisible()) {
		win.show();
	}
});

// retrieves various local version numbers
function sendVersionsInfo() {
	send("version", {
		ns: version.northstar(),
		tf2: version.titanfall(),
		vp: "v" + require("../package.json").version
	});
}

// sends the version info back to the renderer
ipcMain.on("get-version", () => {sendVersionsInfo()});

// prints out version info for the CLI
ipcMain.on("version-cli", () => {
	log("Viper: v" + require("../package.json").version);
	log("Titanfall 2: " + version.titanfall());
	log("Northstar: " + version.northstar());
	log("Node: " + process.version);
	log("Electron: v" + process.versions.electron);
	cli.exit();
})

// sends installed mods info to renderer
ipcMain.on("getmods", () => {
	let mods = mods.list();
	if (mods.all.length > 0) {
		log(`${lang("general.mods.installed")} ${mods.all.length}`);
		log(`${lang("general.mods.enabled")} ${mods.enabled.length}`);
		for (let i = 0; i < mods.enabled.length; i++) {
			log(`  ${mods.enabled[i].Name} ${mods.enabled[i].Version}`);
		}

		if (mods.disabled.length > 0) {
			log(`${lang("general.mods.disabled")} ${mods.disabled.length}`);
			for (let i = 0; i < mods.disabled.length; i++) {
				log(`  ${mods.disabled[i].Name} ${mods.disabled[i].Version}`);
			}
		}
		cli.exit(0);
	} else {
		log("No mods installed");
		cli.exit(0);
	}
})
// }

// allows renderer to set a new renderer
ipcMain.on("newpath", (event, newpath) => {
	if (newpath === false && ! win.isVisible()) {
		win.send("no-path-selected");
	} else {
		sendVersionsInfo();
		if (!win.isVisible()) {
			win.show();
		}
	}
}); ipcMain.on("wrong-path", () => {
	win.send("wrong-path");
});

// starts the GUI or CLI
if (cli.hasArgs()) {
	if (cli.hasParam("update-viper")) {
		update.viper(true);
	} else {
		cli.init();
	}
} else {
	app.on("ready", () => {
		app.setPath("userData", path.join(app.getPath("cache"), app.name));
		start();
	})
}

// returns cached requests
ipcMain.on("get-ns-notes", async () => {
	win.send("ns-notes", await requests.getNsReleaseNotes());
});

ipcMain.on("get-vp-notes", async () => {
	win.send("vp-notes", await requests.getVpReleaseNotes());
});
