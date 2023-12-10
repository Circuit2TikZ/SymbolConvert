// @ts-check
/**
 * Module for handling of SVG and HTML colors.
 * @module colorTools
 */

import { requireJSONsync } from "./requireJSONC.mjs";

/**
 * @typedef {object} rgbColor - a Color in the standard RGB space (no alpha channel)
 * @property {number} r - the red part of the color (0-255)
 * @property {number} g - the green part of the color (0-255)
 * @property {number} b - the blue part of the color (0-255)
 */

/** @type {Map<string,rgbColor>} */
export const SVG_COLORS = new Map(requireJSONsync("./svgColors.json", import.meta.url));

// const uniqColors = Array.from(SVG_COLORS.entries()).filter(
// 	([key, value]) => !(key === "black" || key === "white" || key.endsWith("gray") || key.endsWith("grey"))
// );

/**
 * Convert a index (0 <= index <= 64) to a reproducible color.
 *
 * @param {number} index - the index (0 <= index <= 64)
 * @returns {rgbColor} the generated color
 * @see {@link colorToIndex} for the inverse function
 */
export function indexToColor(index) {
	return { r: index << 2, g: 0x99, b: 0x99 };
}

/**
 * Extracts an index (0 <= index <= 64) from an rgb color.
 *
 * @param {rgbColor} color - the color to extract an index from
 * @returns {number} the index corresponding to the color
 * @throws {Error} if the color is in an invalid range
 * @see {@link indexToColor} for the inverse function
 */
export function colorToIndex(color) {
	if (color.r & 0b11 || color.g !== 0x99 || color.b !== 0x99) throw new Error("Invalid color");
	return color.r >> 2;
}

/**
 * Compare two colors for equality.
 *
 * @param {rgbColor} color1
 * @param {rgbColor} color2
 * @returns {boolean} `true`, if the colors are identical
 */
export function isColorEqual(color1, color2) {
	return (
		color1 === color2 ||
		(typeof color1 === "object" &&
			typeof color2 === "object" &&
			color1.r === color2.r &&
			color1.g === color2.g &&
			color1.b === color2.b)
	);
}

/**
 * Convert a rgb color to an svg/html color string.
 *
 * @param {rgbColor} color - the color to convert
 * @returns {string} the color in the format "#rrggbb" (hexadecimal 24bit)
 */
export function colorToString(color) {
	return (
		"#" +
		color.r.toString(16).padStart(2, "0") +
		color.g.toString(16).padStart(2, "0") +
		color.b.toString(16).padStart(2, "0")
	);
}

/**
 * Parse a SVG color string. Supported are named colors, "rgb(11, 22, 33)", "rgb(11 22 33)", "#123" and "#112233".
 *
 * @param {string} colorString - the color string to parse
 * @returns {rgbColor} the parsed color or null if the color could'nt be parsed
 * @throws {Error} if the `colorString` is malformed
 */
export function parseColorString(colorString) {
	let rgb = SVG_COLORS.get(colorString) || null;
	if (rgb) return rgb;

	if (colorString.startsWith("rgb(") && colorString.endsWith(")")) {
		colorString = colorString.substring(4, colorString.length - 1); // trim "rgb(" and ")"
		const colorArray = colorString.split(/[, ]+/, 3).map((num) => parseInt(num));
		rgb = { r: colorArray[0], g: colorArray[1], b: colorArray[2] };
	} else if (colorString.startsWith("#") && (colorString.length === 4 || colorString.length === 7)) {
		// #rgb:    short version --> equals #rrggbb; e.g #123 is the same as #112233
		// #rrggbb: long version (24bit)
		const shortVersion = colorString.length === 4;
		rgb = {
			r: parseInt(shortVersion ? colorString[1] + colorString[1] : colorString.substring(1, 3), 16),
			g: parseInt(shortVersion ? colorString[2] + colorString[2] : colorString.substring(3, 5), 16),
			b: parseInt(shortVersion ? colorString[3] + colorString[3] : colorString.substring(5, 7), 16),
		};
	} else throw "Couldn't parse color.";

	/** @type {(num: number) => boolean} */
	const isValidRGBNum = (num) => Number.isInteger(num) && num >= 0 && num <= 255;
	if (isValidRGBNum(rgb.r) && isValidRGBNum(rgb.g) && isValidRGBNum(rgb.b)) return rgb;
	else throw "Couldn't parse color.";
}
