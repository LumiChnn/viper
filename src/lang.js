const fs = require("fs");

var lang = "en";
if (fs.existsSync("viper.json")) {
	lang = JSON.parse(fs.readFileSync("viper.json", "utf8")).lang;
	if (! lang) {lang = "en"}
	if (! fs.existsSync(__dirname + `/lang/${lang}.json`)) {
		if (fs.existsSync(__dirname + `/lang/${lang.replace(/-.*$/, "")}.json`)) {
			lang = lang.replace(/-.*$/, "");
		} else {
			lang = "en";
		}
	}
}

var langObj = JSON.parse(fs.readFileSync(__dirname + `/lang/${lang}.json`, "utf8"));

module.exports = (string) => {
	if (langObj[string]) {
		return langObj[string];
	} else {
		return string
	}
}
