// @ts-check
/**
 * Module for importing/requiring *JavaScript-Object-Notation* files with or without comments (JSON, JSONC).
 * @module requireJSONC
 */

import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"

/**
 * Convert a relative file path to an url
 *
 * @param {string} filename - the file path
 * @param {string} [relTo] - the path the `filename` is relative to; with or without "file://" prefix
 * @returns {URL} he new URL
 */
function relativePathToURL(filename, relTo) {
	if (filename.startsWith("./")) {
		if (!relTo) relTo = "file://" + process.cwd()
		else if (!relTo.startsWith("file://")) relTo = "file://" + relTo
		return new URL(filename, relTo)
	}
	return new URL(filename, "file://")
}

/**
 * Process a json(c) string and convert it to an object.
 *
 * @param {string} content - the content of the json/jsonc file
 * @param {boolean} supportJSONC - set to `true`, if you want to import a jsonc file
 * @returns {object} the parsed object
 */
function processJSONstring(content, supportJSONC) {
	if (supportJSONC) {
		// strip comments
		content = content.replace(/(?<!\/)\/\*.*\*\//gs, "") // starts with "/*", ends with "*/"; //* is not a start
		content = content.replace(/\/\/.*$/gm, "") // remove line comments; start "//", end "$"
	}
	return JSON.parse(content)
}

/**
 * Parses an *JavaScript-Object-Notation* with or without comments (JSON, JSONC) file synchronously.
 *
 * If the `filename` is relative (starts with "./"), the parameter `relTo` should be set. If your json file is relative
 * to your current js file, `__dirname` (CJS) or `import.meta.url` (MJS) should be used. For files relative to the
 * project root, `process.cwd()` can be used, which is also the default for `undefined`.
 *
 * @param {string} filename - the path to the json(c) file
 * @param {string} [relTo] - the path the `filename` is relative to
 * @param {boolean} [supportJSONC=false] - set to `true`, if you want to import a jsonc file
 * @returns {object} the parsed object
 */
export function requireJSONsync(filename, relTo, supportJSONC = false) {
	const content = readFileSync(relativePathToURL(filename, relTo), { encoding: "utf8" })
	return processJSONstring(content, supportJSONC)
}

/**
 * Parses an *JavaScript-Object-Notation* with or without comments (JSON, JSONC) file asynchronously.
 *
 * If the `filename` is relative (starts with "./"), the parameter `relTo` should be set. If your json file is relative
 * to your current js file, `__dirname` should be used. For files relative to the project root, `process.cwd()` can be
 * used.
 *
 * @param {string} filename - the path to the json(c) file
 * @param {string} [relTo] - the path the `filename` is relative to
 * @param {boolean} [supportJSONC=false] - set to `true`, if you want to import a jsonc file
 * @returns {Promise<object>} the parsed object
 */
export async function requireJSON(filename, relTo, supportJSONC = false) {
	const content = await readFile(relativePathToURL(filename, relTo), { encoding: "utf8" })
	return processJSONstring(content, supportJSONC)
}
