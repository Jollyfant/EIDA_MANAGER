/*
 * EIDA-Manager - lib/orfeus-xml.js
 * 
 * Wrapper for XSD schema templates
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const fs = require("fs");
const libxmljs = require("libxmljs");
const CONFIG = require("./config");

// Export the parsed schema file
module.exports = libxmljs.parseXml(fs.readFileSync(CONFIG.METADATA.SCHEMA.PATH, "utf8"));
