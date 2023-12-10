// @ts-check
/**
 * Tasks for creating of the to-be-compiled tex files.
 * @module createTexFilesTasks
 */

const dest = (await import("gulp")).default.dest;
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import Vinyl from "vinyl";
import { NODES_AND_PATHS, buildFolderAbs } from "../buildSettings.mjs";
import { getFileBaseName } from "./buildFileNameTools.mjs";
import { indexToColor } from "./colorTools.mjs";
/** @typedef {import("../buildSettings.mjs").NodeDescription} NodeDescription */
/** @typedef {import("../buildSettings.mjs").PathComponentDescription} PathComponentDescription */

/**
 * Task for creating of the to-be-compiled tex files. Uses "stencil_pgf_node.tex" as a template and
 * `NODES_AND_PATHS.nodes` as the data source.
 *
 * @returns {Promise<NodeJS.ReadWriteStream>} the stream returned by `dest`
 * @throws {Error} if the file "stencil_pgf_node.tex" can't be read
 */
export async function createNodeTexFiles() {
	/**
	 * Generator for tex-Vinyls.
	 * @param {string|Buffer} stencilPreBuffer - stencil before node name
	 * @param {string|Buffer} stencilMidBuffer - stencil after node name and before anchorLines
	 * @param {string|Buffer} stencilPostBuffer - stencil after anchorLines
	 * @param {NodeDescription[]} nodeList - a list of node names
	 * @yields {Vinyl} the generated file
	 */
	function* texFileGenerator(stencilPreBuffer, stencilMidBuffer, stencilPostBuffer, nodeList) {
		stencilPreBuffer =
			stencilPreBuffer instanceof Buffer ? stencilPreBuffer : Buffer.from(stencilPreBuffer, "utf8");
		stencilMidBuffer =
			stencilMidBuffer instanceof Buffer ? stencilMidBuffer : Buffer.from(stencilMidBuffer, "utf8");
		stencilPostBuffer =
			stencilPostBuffer instanceof Buffer ? stencilPostBuffer : Buffer.from(stencilPostBuffer, "utf8");

		for (const [index, node] of nodeList.entries()) {
			const nameOptionsList = [node.name, ...(node.options || [])];
			const basename = getFileBaseName(index, node.name, true, node.options);
			const nameBuffer = Buffer.from(nameOptionsList.join(", "), "utf8");

			let anchorLines = "";
			if (node.pins && node.pins.length > 0) {
				anchorLines = node.pins
					.filter((anchorName) => anchorName !== "center")
					.map((anchorName, index) => {
						const color = indexToColor(index);
						return `\t\t\\draw[draw={rgb,255:red,${color.r};green,${color.g};blue,${color.b}}] (0,0) -- (N.${anchorName});\n`;
					})
					.join("");
			}
			const anchorLinesBuffer = Buffer.from(anchorLines, "utf8");
			let file = new Vinyl({
				cwd: process.cwd(),
				base: buildFolderAbs,
				path: buildFolderAbs + basename + ".tex",
				contents: Buffer.concat([
					stencilPreBuffer,
					nameBuffer,
					stencilMidBuffer,
					anchorLinesBuffer,
					stencilPostBuffer,
				]),
			});
			yield file;
		}
	}

	const stencil = await readFile("stencil_pgf_node.tex", {
		encoding: "utf8",
	});

	let [stencilPre, stencilMid] = stencil?.split("<nodename>", 2);
	let stencilPost;
	[stencilMid, stencilPost] = stencilMid?.split("<anchorLines>", 2);
	if (!stencil || !stencilPre || !stencilMid || !stencilPost)
		throw new Error("Could not load stencil file stencil_pgf_node.tex");

	const nodeTexFileStream = Readable.from(
		texFileGenerator(stencilPre, stencilMid, stencilPost, NODES_AND_PATHS.nodes)
	);
	return nodeTexFileStream.pipe(dest(buildFolderAbs));
}

/**
 * Task for creating of the to-be-compiled tex files. Uses "stencil_pgf_node.tex" as a template and
 * `NODES_AND_PATHS.path` as the data source.
 *
 * @returns {Promise<NodeJS.ReadWriteStream>} the stream returned by `dest`
 * @throws {Error} if the file "stencil_pgf_path.tex" can't be read
 */
export async function createPathTexFiles() {
	/**
	 * Generator for tex-Vinyls.
	 * @param {string|Buffer} stencilPreBuffer - stencil before path name
	 * @param {string|Buffer} stencilMidBuffer - stencil after path name and before anchorLines
	 * @param {string|Buffer} stencilPostBuffer - stencil after anchorLines
	 * @param {PathComponentDescription[]} pathList - a list of path names
	 * @yields {Vinyl} the generated file
	 */
	function* texFileGenerator(stencilPreBuffer, stencilMidBuffer, stencilPostBuffer, pathList) {
		stencilPreBuffer =
			stencilPreBuffer instanceof Buffer ? stencilPreBuffer : Buffer.from(stencilPreBuffer, "utf8");
		stencilMidBuffer =
			stencilMidBuffer instanceof Buffer ? stencilMidBuffer : Buffer.from(stencilMidBuffer, "utf8");
		stencilPostBuffer =
			stencilPostBuffer instanceof Buffer ? stencilPostBuffer : Buffer.from(stencilPostBuffer, "utf8");

		for (const [index, path] of pathList.entries()) {
			const shapeName = path.shapeName || path.drawName.replaceAll(" ", "") + "shape";
			const basename = getFileBaseName(index, path.drawName, false, path.options);
			const nameBuffer = Buffer.from(shapeName, "utf8");

			let anchorLines = ["b", "a", ...(path.pins || [])]
				.filter((anchorName) => anchorName !== "center")
				.map((anchorName, index) => {
					const color = indexToColor(index);
					return `\t\t\\draw[draw={rgb,255:red,${color.r};green,${color.g};blue,${color.b}}] (0,0) -- (P.${anchorName});\n`;
				})
				.join("");
			const anchorLinesBuffer = Buffer.from(anchorLines, "utf8");
			let file = new Vinyl({
				cwd: process.cwd(),
				base: buildFolderAbs,
				path: buildFolderAbs + basename + ".tex",
				contents: Buffer.concat([
					stencilPreBuffer,
					nameBuffer,
					stencilMidBuffer,
					anchorLinesBuffer,
					stencilPostBuffer,
				]),
			});
			yield file;
		}
	}

	const stencil = await readFile("stencil_pgf_path.tex", {
		encoding: "utf8",
	});

	let [stencilPre, stencilMid] = stencil?.split("<pathname>", 2);
	let stencilPost;
	[stencilMid, stencilPost] = stencilMid?.split("<anchorLines>", 2);
	if (!stencil || !stencilPre || !stencilMid || !stencilPost)
		throw new Error("Could not load stencil file stencil_pgf_path.tex");

	const nodeTexFileStream = Readable.from(
		texFileGenerator(stencilPre, stencilMid, stencilPost, NODES_AND_PATHS.path)
	);
	return nodeTexFileStream.pipe(dest(buildFolderAbs));
}
