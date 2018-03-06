const fs = require("fs");
const libxmljs = require("libxmljs");

const CONFIG = require("../config");

module.exports = libxmljs.parseXml(fs.readFileSync(CONFIG.METADATA.SCHEMA.PATH, "utf8"));
