// @ts-check
/**
 * Contains the logic for converting compiled dvi files (`Vinyl`s) to SVG symbols with metadata.
 * @module convertDviToSymbol
 */

import { Box, SVG as _SVG, registerWindow } from "@svgdotjs/svg.js";
import assert from "node:assert";
import { optimize } from "svgo";
import { NODES_AND_PATHS } from "../buildSettings.mjs";
import { decodeFilename, getFileBaseName } from "./buildFileNameTools.mjs";
import * as colorTools from "./colorTools.mjs";
import convertDVItoSVG from "./convertDVItoSVG.mjs";
import { Point, areTwoPointsClose, findMatchingLinePoint, svgPathToLine } from "./svgPointTools.mjs";
import { getSVGInnerContent, getSvgOptions } from "./svgStringTools.mjs";
import { vinylMap } from "./vinylTools.mjs";

/** @typedef {import("node:stream").Transform} Transform */
/** @typedef {import("vinyl")} Vinyl */
/** @typedef {import("../buildSettings.mjs").NodeDescription} NodeDescription */
/** @typedef {import("../buildSettings.mjs").PathComponentDescription} PathComponentDescription */
/** @typedef {import("./svgPointTools.mjs").Line} Line */
/** @typedef {import("./colorTools.mjs").rgbColor} rgbColor */

// fixes for svg.js: Add missing DOM (window & document)
const svgWindow = (await import("svgdom")).createWindow();
registerWindow(svgWindow, svgWindow.document);
// const svgSvgElement = SVG.SVG();

/**
 * Convert a full SVG to a SVG symbol with metadata (no surrounding \<svg\>-tag).
 *
 * Extracts the content (inside the svg tag), parses and removes helper lines and lastly adds meta information.
 *
 * @template {true|false} IS_NODE
 * @param {string} svgContent - the string containing the svg
 * @param {{index: number, isNode: IS_NODE}} fileInfo - infos extracted from the filename using {@link decodeFilename}
 * @param {IS_NODE extends true ? NodeDescription : PathComponentDescription} nodeDescription - the description of the node- or path-style component
 * @param {?string} [ID] - the symbol id, if already created; can be created using {@link getFileBaseName}
 * @returns {string} the new symbol with trailing newline
 * @throws {Error} if a pin can not be found in the svg
 */
function convertSVGtoSymbol(svgContent, fileInfo, nodeDescription, ID) {
	const viewBoxString = getSvgOptions(svgContent).get("viewbox");
	assert(viewBoxString, "SVG has no viewBox");
	svgContent = getSVGInnerContent(svgContent); // strip svg tag

	/** @type {Line[]} */
	let lines = [];

	// Filter content and find colored helper lines
	const filteredContent = svgContent
		.split(/\r?\n/) // line by line
		.reduce((/** @type {string[]} */ prevVal, line) => {
			const match = line.match(/^\s*(?<tag><(?<tagname>\w+) *(?<inner>[^>]+?) *\/>)\s*$/);
			try {
				assert(
					match?.groups && match.groups.tagname?.toLowerCase() === "path" && match.groups.inner.length >= 10
				);

				/** @type {import("@svgdotjs/svg.js").Path} */ // @ts-ignore
				const path = _SVG(match.groups.tag);
				if (path.type !== "path") throw null;
				if ((path.attr().fill || "none") !== "none") throw null; // no option fill or explicitly set to none

				const line = svgPathToLine(path);
				if (!line.color || (line.color.r === 0 && line.color.g === 0 && line.color.b === 0)) throw null;

				lines.push(line);
				console.log("Found colored line: ", line.start, line.end, line.color);
			} catch (e) {
				// Not a line to filter
				prevVal.push(line);
			}
			return prevVal;
		}, [])
		.join("\n");

	/** @type {rgbColor[]} */
	const zeroLineColors = [
		{ r: 255, g: 255, b: 0 },
		{ r: 0, g: 255, b: 255 },
	];

	// const zeroLines = lines.filter((line) => zeroLineColors.find((color) => isColorEqual(line.color, color)));
	let pinLines = lines.filter((line) => !zeroLineColors.find((color) => colorTools.isColorEqual(line.color, color)));
	let refPoint = findMatchingLinePoint(lines);
	const zeroCoordinate = new Point(0, 0);

	// helper array for mapping known node information and extracted coordinates
	// <ci:pin anchorName="D" x="0" y="0.77cm" isDefault="false" />
	/** @type {{ anchorName: string, point: ?Point, isDefault: boolean }[]} */
	let pinAnchors = (fileInfo.isNode ? nodeDescription.pins || [] : ["START", "END", ...(nodeDescription.pins || [])])
		.filter((anchorName) => anchorName !== "center")
		.map((anchorName) => ({ anchorName: anchorName, point: null, isDefault: false }));

	// Map lines to pinAnchors
	pinLines.forEach((line) => {
		// sort line start/end; end=relevant point
		if (!areTwoPointsClose(line.start, refPoint)) {
			// unsorted
			if (areTwoPointsClose(line.end, refPoint)) {
				line.end = line.start;
				line.start = refPoint;
			} else {
				// neither start nor end are the zero position
				console.log("Error parsing line: ", line.start, line.end, line.color);
				return;
			}
		}
		const index = colorTools.colorToIndex(line.color);
		let pinAnchor = pinAnchors[index] || null;

		// @ts-ignore vs code doesn't know this function has been added
		if (pinAnchor) pinAnchor.point = line.end.minus(refPoint);
		else throw new Error("No matching pin description found for line color: " + JSON.stringify(line.color));
	});

	// add center anchor back as pin, if indicated by nodeDescription
	if (nodeDescription.pins?.includes("center"))
		pinAnchors.push({ anchorName: "center", point: zeroCoordinate, isDefault: false });

	pinAnchors.forEach((pinAnchor) => {
		if (!pinAnchor.point) {
			pinAnchor.point = new Point(0, 0);
			console.log(
				"Warning[" +
					(nodeDescription.name || nodeDescription.drawName) +
					"]: Anchor " +
					pinAnchor.anchorName +
					" not found; assuming (0, 0)"
			);
		}
	});

	// try to find the used anchor
	const hasDefault = !pinAnchors.every((pinAnchor) => {
		if (areTwoPointsClose(zeroCoordinate, pinAnchor.point)) {
			pinAnchor.isDefault = true;
			return false; // <-- break
		} else return true; // <-- continue; try next point
	});

	/** @type {string} */
	const tikzName = fileInfo.isNode ? nodeDescription.name : nodeDescription.drawName;
	/** @type {?string} */
	const shapeName = fileInfo.isNode
		? null
		: nodeDescription.shapeName || nodeDescription.drawName.replaceAll(" ", "") + "shape";

	let metaLines = [
		"\t<metadata>",
		`\t\t<ci:componentInformation type="${fileInfo.isNode ? "node" : "path"}"${
			nodeDescription.displayName ? ' displayName="' + nodeDescription.displayName + '"' : ""
		} tikzName="${tikzName}" ${shapeName ? 'shapeName="' + shapeName + '" ' : ""}${
			nodeDescription.groupName ? 'groupName="' + nodeDescription.groupName + '" ' : ""
		}refX="${refPoint.x}" refY="${refPoint.y}" viewBox="${viewBoxString}">`,
	];

	if (nodeDescription.options && nodeDescription.options.length > 0) {
		metaLines.push(
			"\t\t\t<ci:tikzOptions>",
			...nodeDescription.options.map((option) => {
				/** @type {string} */
				const key = Array.isArray(option) ? option[0] : option;
				/** @type {?string} */
				const value = (Array.isArray(option) && option[1]) || null;
				return value
					? `\t\t\t\t<ci:option key="${key}" value="${value}" />`
					: `\t\t\t\t<ci:option key="${key}" />`;
			}),
			"\t\t\t</ci:tikzOptions>"
		);
	}

	metaLines.push(
		"\t\t\t<ci:pins>",
		...pinAnchors.map(
			// prettier-ignore
			(pinAnchor) => // @ts-ignore all pinAnchor[s] are assigned at this point
				`\t\t\t\t<ci:pin anchorName="${pinAnchor.anchorName}" x="${pinAnchor.point.x}" y="${pinAnchor.point.y}" isDefault="${pinAnchor.isDefault}" />`
		),
		"\t\t\t</ci:pins>"
	);

	// add anchor point (not a pin) in center, if node has no default anchor yet
	if (!hasDefault)
		metaLines.push(
			"\t\t\t<ci:additionalAnchors>",
			'\t\t\t\t<ci:anchor anchorName="center" x="0" y="0" isDefault="true" />',
			"\t\t\t</ci:additionalAnchors>"
		);
	// TODO add text position
	metaLines.push("\t\t</ci:componentInformation>", "\t</metadata>");

	// add transparent ellipse for easier dragging
	const viewBox = new Box(viewBoxString);
	metaLines.push(
		`\t<ellipse stroke="none" fill="transparent" cx="${viewBox.cx}" cy="${viewBox.cy}" rx="${
			viewBox.width * 0.4
		}" ry="${viewBox.height * 0.4}" />`
	);

	//- put it all together ---
	if (!ID)
		ID = getFileBaseName(
			null,
			fileInfo.isNode ? nodeDescription.name : nodeDescription.drawName,
			fileInfo.isNode,
			nodeDescription.options
		);
	return `<symbol id="${ID}">\n` + metaLines.join("\n") + "\n" + filteredContent + "\n</symbol>\n";
}

/**
 * Generate a optimized SVG (symbol) from an dvi file.
 *
 * This function calls {@link convertDVItoSVG} twice. The first call is only used to get the viewBox. This information
 * is used to add shift/offset parameters for the second conversion. The final therefore SVG starts at (0,0).
 *
 * The gained SVG is used to generate the symbol (with metadata) using {@link convertSVGtoSymbol}.
 *
 * @returns {Transform}
 */
export function convertDVItoSVGsymbol() {
	return vinylMap(
		/**
		 * Mapper function for converting a single DVI Vinyl (file) to a SVG symbol
		 * @param {Vinyl} file
		 * @returns {Promise<Vinyl>}
		 */
		async function (file) {
			let svgContent = await convertDVItoSVG(file.path);

			const svgOptions = getSvgOptions(svgContent);
			const viewBoxStr = svgOptions.get("viewbox");
			const viewBoxArray = viewBoxStr?.split(/ +/);
			if (!viewBoxStr || !viewBoxArray || viewBoxArray.length !== 4) throw new Error("SVG has no viewBox");

			const translateX = -parseFloat(viewBoxArray[0]);
			const translateY = -parseFloat(viewBoxArray[1]);

			svgContent = await convertDVItoSVG(file.path, translateX, translateY, 4 / 3);

			// get node information (name, pins, ...)
			const fileInfo = decodeFilename(file.stem);
			/** @type {?NodeDescription|PathComponentDescription} */
			const nodeDescription =
				(fileInfo && fileInfo.isNode && NODES_AND_PATHS.nodes[fileInfo.index]) ||
				(fileInfo && !fileInfo.isNode && NODES_AND_PATHS.path[fileInfo.index]) ||
				null;
			if (!fileInfo || !nodeDescription) {
				console.log("Error: Couldn't decode filename: ", basename);
				return svgContent;
			}
			const ID = getFileBaseName(
				null,
				fileInfo.isNode ? nodeDescription.name : nodeDescription.drawName,
				fileInfo.isNode,
				nodeDescription.options
			);

			svgContent = optimize(svgContent, {
				multipass: true,
				floatPrecision: 5,
				js2svg: {
					indent: "\t",
					pretty: true,
					eol: "lf",
					finalNewline: true,
				},
				plugins: [
					{
						name: "preset-default",
						params: {
							overrides: {
								removeViewBox: false,
								convertPathData: {
									forceAbsolutePath: false,
									applyTransforms: true,
									utilizeAbsolute: false,
								},
							},
						},
					},
					{
						name: "prefixIds",
						params: {
							delim: "_",
							prefix: ID || "",
							prefixIds: !!ID, // if not empty
							prefixClassNames: !!ID, // if not empty
						},
					},
					"removeDimensions",
				],
			}).data;

			if (fileInfo && nodeDescription) svgContent = convertSVGtoSymbol(svgContent, fileInfo, nodeDescription);
			else console.log("Error: Couldn't decode filename: " + file.stem);

			if (svgContent) {
				file.contents = Buffer.from(svgContent, "utf8");
				file.extname = ".svg";

				return file;
			}
		},
		true
	);
}

export function combineSymbols(){
	return vinylMap(
		/**
		 * @param {Vinyl} file
		 * @returns {Promise<Vinyl>}
		 */
		async function (file) {
			let header = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<svg\n\tversion="1.1"\n\txmlns="http://www.w3.org/2000/svg"\n\txmlns:xlink="http://www.w3.org/1999/xlink"\n\txmlns:ci="urn:uuid:c93d8327-175d-40b7-bdf7-03205e4f8fc3"\n\txmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n\txsi:schemaLocation="urn:uuid:c93d8327-175d-40b7-bdf7-03205e4f8fc3 ../../xmlSchema/metadataSchema.xsd"\n>\n\t<defs>\n'
			let footer = '\n\t</defs>\n</svg>'
			let contents = file.contents.toString().split('\n');
			console.log(contents[0]);
			contents = contents.map(line => {
				return '\t\t'+line;
			});
			file.contents = Buffer.from(header + contents.join('\n') + footer, "utf8");
			return file;
		},
		true
	);
}
