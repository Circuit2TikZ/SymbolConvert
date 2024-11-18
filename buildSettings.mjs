// @ts-check
/**
 * Settings and Objects needed by all tasks.
 * @module buildSettings
 */

import { requireJSONsync } from "./lib/requireJSONC.mjs"

/**
 * The relative path to the folder used for building with trailing slash
 * @constant {string}
 */
export const buildFolderRel = "build/"

/**
 * The absolute path to the folder used for building
 * @constant {string}
 */
export const buildFolderAbs = process.cwd() + "/" + buildFolderRel

/**
 * @typedef {object} NodeDescription
 * @property {string} name
 * @property {string} [groupName]
 * @property {string[]} [options]
 * @property {string[]} [pins]
 */

/**
 * Represents a undefined object
 * @typedef {Object} PathComponentDescription
 * @property {string} [displayName] - the name to show in the UI
 * @property {string} drawName - the unique (!) CircuiTikZ name used in to[...], e.g. american resistor (not R) for an resistor
 * @property {string[]} [aliases] - additional names which can be used in to[...]
 * @property {string} [shapeName] - the shape name used internally by CircuiTikZ; can be used to create a node
 * @property {string} [groupName] - the name of the group, e.g. Transistors
 * @property {(string|([string, string]))[]} [options] - a list of options to set in CircuiTikZ
 * @property {string[]} [pins] - a list of additional CircuiTikZ pin (anchor) names; e.g. for potentiometer
 * @property {boolean} [stroke=false] - draw a line through the component
 */

/**
 * @typedef {object} NODES_AND_PATHS_TYPE
 * @property {NodeDescription[]} nodes
 * @property {PathComponentDescription[]} path
 */

/** @type {NODES_AND_PATHS_TYPE} */
export const NODES_AND_PATHS = requireJSONsync("./nodes.jsonc", import.meta.url, true)
