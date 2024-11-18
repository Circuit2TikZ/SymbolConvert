// @ts-check
/**
 * Contains a function for converting a dvi to a SVG.
 * @module convertDVItoSVG
 */

import simpleExec from "./simpleExec.mjs"
import { buildFolderAbs } from "../buildSettings.mjs"

/** @typedef {import("../buildSettings.mjs").NodeDescription} NodeDescription */

/**
 * Convert a dvi to svg using dvisvgm.
 *
 * @param {string} filename - name of dvi with or without trailing ".dvi"
 * @param {number} [translateX=0] - shift the x axis by `translateX` pixels
 * @param {number} [translateY=0] - shift the y axis by `translateY` pixels
 * @param {number} [scale=1] - scale the whole picture/all coordinates, e.g by 4/3 to convert pt to px
 * @returns {Promise<string>} the svg
 */
export default async function convertDVItoSVG(filename, translateX = 0, translateY = 0, scale = 1) {
	// dvisvgm --bbox=min -j --optimize=none --translate=72.000004,72.000006 --scale=1.3333333333333333333333333333333333 nigfete_node_dvisvgm
	let args = [
		"--bbox=min",
		"--clipjoin",
		"--optimize=group-attributes,remove-clippaths,simplify-transform,collapse-groups",
		"--no-fonts",
		"--stdout",
	]
	if (translateX || translateY) args.push("--translate=" + translateX + "," + translateY)
	if (scale && scale !== 1) args.push("--scale=" + scale)
	args.push(filename)

	return (await simpleExec("dvisvgm", args, buildFolderAbs, true)).toString("utf8")
}
