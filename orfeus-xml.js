const fs = require("fs");
const libxmljs = require("libxmljs");

const SCHEMA_PATH = "./schema/fdsn-station-1.0.xsd";

module.exports = libxmljs.parseXml(fs.readFileSync(SCHEMA_PATH, "utf8"));
