// @ts-check
/**
 * Tools for creating filenames for (temporary) build artifacts.
 * @module buildFileNameTools
 */

/**
 * Create the basename of a node or path.
 *
 * The syntax is \<index\>_\<"node"|"path"\>_\<name\>_\<option1\>_\<option2\>...
 *
 * Example:
 *  - 000_node_nigfete
 *  - 001_node_pnp_schottky_base
 *
 * @param {number|null} index
 * @param {string} componentName
 * @param {boolean} [isNode=true]
 * @param {(string|([string, string]))[]} [options=[]]
 * @returns {string}
 */
export function getFileBaseName(index, componentName, isNode = true, options = []) {
	let basenameArray = [isNode ? "node" : "path"]
	if (index !== null) {
		basenameArray.push(index.toString(10).padStart(3, "0"))
	}
	basenameArray.push(componentName)
	if (options && options.length > 0)
		basenameArray.push(...options.map((option) => (Array.isArray(option) ? option.join("-") : option)))
	return basenameArray.map((str) => str.replace(/\W/g, "-")).join("_")
}

/**
 * Decode a filename to get the index and type (node or path).
 *
 * @param {string} filename - the filename
 * @returns {{index: number, isNode: boolean}|null} `null`, if the string couldn't be decoded
 * @throws {Error} if the filename can't be parsed
 */
export function decodeFilename(filename) {
	const regex = /^(?<nodeOrPath>(node)|(path))_(?<index>[0-9]{3})_/i
	const match = filename.match(regex)
	const index = Number.parseInt(match?.groups?.index ?? "NaN", 10)
	if (!Number.isInteger(index)) throw new Error("Error parsing filename: " + filename)
	const isNode = match?.groups?.nodeOrPath?.toLowerCase() === "node"
	return Number.isInteger(index) ? { index: index, isNode: isNode } : null
}
