const fs = require("fs");
const libxmljs = require("libxmljs");

const SCHEMA_PATH = "./schema.xsd";

module.exports = libxmljs.parseXml(fs.readFileSync(SCHEMA_PATH, "utf8"));
