const exec = require("child_process").exec;

const cli = require("../cli");
const lang = require("../lang");

const win = require("./window");
const settings = require("./settings");

// launches the game
//
// either Northstar or Vanilla. Linux support is not currently a thing,
// however it'll be added at some point.
function launch(game_version) {
	// return early, and show error message if on Linux
	if (process.platform == "linux") {
		win.alert(lang("cli.launch.linuxerror"));
		console.error("error:", lang("cli.launch.linuxerror"));
		cli.exit(1);
		return;
	}

	// change current directory to gamepath
	process.chdir(settings.gamepath);

	// launch the requested game version
	switch(game_version) {
		case "vanilla":
			console.log(lang("general.launching"), "Vanilla...");
			exec("Titanfall2.exe", {cwd: settings.gamepath});
			break;
		default:
			console.log(lang("general.launching"), "Northstar...");
			exec("NorthstarLauncher.exe", {cwd: settings.gamepath});
			break;
	}
}

module.exports = launch;
