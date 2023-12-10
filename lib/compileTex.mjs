// @ts-check
/**
 * Module for compiling a LaTeX file to DVI.
 * @module compileTex
 */

import { readdir, rm } from "node:fs/promises";
import simpleExec from "./simpleExec.mjs";
import { vinylMap } from "./vinylTools.mjs";

/** @typedef {import("node:stream").Transform} Transform */
/** @typedef {import("vinyl")} Vinyl */

/**
 * Compile .tex files to dvi. Does not "return" `Vinyl`s. Do not use `dest`.
 *
 * @returns {Transform}
 */
export function compileTexToDVIVinyl() {
	return vinylMap(async function (/** @type {Vinyl} */ file) {
		console.log("Building " + file.stem + " ...");
		try {
			await simpleExec(
				"lualatex",
				[
					"-halt-on-error",
					"-interaction=nonstopmode",
					'-jobname="' + file.stem + '"',
					"--output-format=dvi",
					//"--output-directory",
					file.path,
				],
				file.dirname
			);
		} catch (error) {
			console.log("Error while building " + file.stem, error);
			return;
		}
		console.log("Done building " + file.stem);

		const entries = await readdir(file.dirname, {
			recursive: false,
			withFileTypes: true,
		});

		const extensionBlacklist = ["aux", "log", "tmp", "toc"];
		//const extensionWhitelist = ["dvi", "svg", "tex", "pdf", "pgf"];

		/** filepath of aux files */
		const auxFiles = entries
			.filter((entry) => {
				if (
					!(entry.isFile() && entry.name.startsWith(file.stem) && entry.name.charAt(file.stem.length) === ".")
				)
					return false;
				const ext = entry.name.substring(file.stem.length + 1);
				return extensionBlacklist.includes(ext.toLowerCase());
			})
			.map((entry) => entry.path + (entry.path.endsWith("/") ? "" : "/") + entry.name);

		await Promise.all(auxFiles.map((fn) => rm(fn)));
	});
}
