// @ts-check
/**
 * Contains the logic for converting compiled dvi files (`Vinyl`s) to SVG symbols with metadata.
 * @module convertDviToSymbol
 */

import { SVG as _SVG, registerWindow } from "@svgdotjs/svg.js"
import assert from "node:assert"
import { optimize } from "svgo"
import { NODES_AND_PATHS } from "../buildSettings.mjs"
import { decodeFilename, getFileBaseName } from "./buildFileNameTools.mjs"
import * as colorTools from "./colorTools.mjs"
import convertDVItoSVG from "./convertDVItoSVG.mjs"
import { Point, areTwoPointsClose, findMatchingLinePoint, svgPathToLine } from "./svgPointTools.mjs"
import { getSVGInnerContent, getSvgOptions } from "./svgStringTools.mjs"
import { vinylMap } from "./vinylTools.mjs"
import { optionsObjectToArray } from "./createTexFilesTasks.mjs"
import { JSDOM } from "jsdom"

/** @typedef {import("node:stream").Transform} Transform */
/** @typedef {import("vinyl")} Vinyl */
/** @typedef {import("../buildSettings.mjs").NodeDescription} NodeDescription */
/** @typedef {import("../buildSettings.mjs").PathComponentDescription} PathComponentDescription */
/** @typedef {import("./svgPointTools.mjs").Line} Line */
/** @typedef {import("./colorTools.mjs").rgbColor} rgbColor */

// fixes for svg.js: Add missing DOM (window & document)
const svgWindow = (await import("svgdom")).createWindow()
registerWindow(svgWindow, svgWindow.document)
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
 * @param {?array} [options] an array of options according to the schema
 * @returns {string} the new symbol with trailing newline
 * @throws {Error} if a pin can not be found in the svg
 */
function convertSVGtoSymbol(svgContent, fileInfo, nodeDescription, ID, options) {
	const viewBoxString = getSvgOptions(svgContent).get("viewbox")
	assert(viewBoxString, "SVG has no viewBox")
	svgContent = getSVGInnerContent(svgContent) // strip svg tag

	/** @type {Line[]} */
	let lines = []

	// Filter content and find colored helper lines
	const filteredContent = svgContent
		.split(/\r?\n/) // line by line
		.reduce((/** @type {string[]} */ prevVal, line) => {
			const match = line.match(/^\s*(?<tag><(?<tagname>\w+) *(?<inner>[^>]+?) *\/>)\s*$/)
			try {
				assert(
					match?.groups && match.groups.tagname?.toLowerCase() === "path" && match.groups.inner.length >= 10
				)

				/** @type {import("@svgdotjs/svg.js").Path} */ // @ts-ignore
				const path = _SVG(match.groups.tag)
				if (path.type !== "path") throw null
				if ((path.attr().fill || "none") !== "none") throw null // no option fill or explicitly set to none

				const line = svgPathToLine(path)
				if (!line.color || (line.color.r === 0 && line.color.g === 0 && line.color.b === 0)) throw null

				lines.push(line)
				console.log(
					(nodeDescription.displayName ?? nodeDescription.name) +
						(options.length > 0 ? " (" + options.map((option) => option.name) + "): " : ": "),
					line.start,
					line.end,
					line.color
				)
			} catch (e) {
				// Not a line to filter
				prevVal.push(line)
			}
			return prevVal
		}, [])
		.join("\n")

	//TODO adjust viewbox to fit content without the helper lines in the content

	// the line corresponding to the text anchor point
	const textLineColor = { r: 255, g: 0, b: 0 }

	/** @type {rgbColor[]} */
	const zeroLineColors = [
		{ r: 255, g: 255, b: 0 },
		{ r: 0, g: 255, b: 255 },
	]

	// const zeroLines = lines.filter((line) => zeroLineColors.find((color) => isColorEqual(line.color, color)));
	let pinLines = lines.filter(
		(line) => !zeroLineColors.concat([textLineColor]).find((color) => colorTools.isColorEqual(line.color, color))
	)
	let refPoint = findMatchingLinePoint(lines)
	const zeroCoordinate = new Point(0, 0)

	// helper array for mapping known node information and extracted coordinates
	// <ci:pin anchorName="D" x="0" y="0.77cm" isDefault="false" />
	/** @type {{ anchorName: string, point: ?Point, isDefault: boolean }[]} */
	let pinAnchors = (fileInfo.isNode ? nodeDescription.pins || [] : ["START", "END", ...(nodeDescription.pins || [])])
		.filter((anchorName) => anchorName !== "center")
		.map((anchorName) => ({ anchorName: anchorName, point: null, isDefault: false }))

	// Map lines to pinAnchors
	pinLines.forEach((line) => {
		// sort line start/end; end=relevant point
		if (!areTwoPointsClose(line.start, refPoint)) {
			// unsorted
			if (areTwoPointsClose(line.end, refPoint)) {
				line.end = line.start
				line.start = refPoint
			} else {
				// neither start nor end are the zero position
				console.log("Error parsing line: ", line.start, line.end, line.color)
				return
			}
		}
		const index = colorTools.colorToIndex(line.color)
		let pinAnchor = pinAnchors[index] || null

		// @ts-ignore vs code doesn't know this function has been added
		if (pinAnchor) pinAnchor.point = line.end.minus(refPoint)
		else {
			throw new Error("No matching pin description found for line color: " + JSON.stringify(line.color))
		}
	})

	// add center anchor back as pin, if indicated by nodeDescription
	if (nodeDescription.pins?.includes("center"))
		pinAnchors.push({ anchorName: "center", point: zeroCoordinate, isDefault: false })

	pinAnchors.forEach((pinAnchor) => {
		if (!pinAnchor.point) {
			pinAnchor.point = new Point(0, 0)
			console.log(
				"Warning[" +
					(nodeDescription.name || nodeDescription.drawName) +
					"]: Anchor " +
					pinAnchor.anchorName +
					" not found; assuming (0, 0)"
			)
		}
	})

	// try to find the used anchor
	const hasDefault = !pinAnchors.every((pinAnchor) => {
		if (areTwoPointsClose(zeroCoordinate, pinAnchor.point)) {
			pinAnchor.isDefault = true
			return false // <-- break
		} else return true // <-- continue; try next point
	})

	/** @type {string} */
	const tikzName = fileInfo.isNode ? nodeDescription.name : nodeDescription.drawName
	/** @type {?string} */
	const shapeName =
		fileInfo.isNode ? null : nodeDescription.shapeName || nodeDescription.drawName.replaceAll(" ", "") + "shape"

	let metaLines = [
		"\t<metadata>",
		`\t\t<ci:componentInformation type="${fileInfo.isNode ? "node" : "path"}"${
			nodeDescription.displayName ? ' displayName="' + nodeDescription.displayName + '"' : ""
		} tikzName="${tikzName}" ${shapeName ? 'shapeName="' + shapeName + '" ' : ""}${
			nodeDescription.groupName ? 'groupName="' + nodeDescription.groupName + '" ' : ""
		}refX="${toFixedIfNecessary(refPoint.x)}" refY="${toFixedIfNecessary(refPoint.y)}" viewBox="${viewBoxString}">`,
	]

	metaLines.push(
		"\t\t\t<ci:tikzOptions>",
		...(nodeDescription.options ?? []).map((option) => {
			if (option.enumOptions) {
				//is an enum option
				const selectNone = Object.hasOwn(option, "selectNone") ? ` selectNone="${option.selectNone}"` : ""
				let enumLines = [`\t\t\t\t<ci:enumOption${selectNone}>`]
				for (const enumOption of option.enumOptions) {
					enumLines.push(optionStrFromOption(enumOption, isOptionActive(enumOption.name, options)))
				}
				enumLines.push("\t\t\t</ci:enumOption>")
				return enumLines.join("\n\t")
			} else {
				//is a standard option
				return optionStrFromOption(option, isOptionActive(option.name, options))
			}
		}),
		"\t\t\t</ci:tikzOptions>"
	)

	metaLines.push(
		"\t\t\t<ci:pins>",
		...pinAnchors.map(
			// prettier-ignore
			(pinAnchor) => // @ts-ignore all pinAnchor[s] are assigned at this point
				`\t\t\t\t<ci:pin anchorName="${pinAnchor.anchorName}" x="${toFixedIfNecessary(pinAnchor.point.x)}" y="${toFixedIfNecessary(pinAnchor.point.y)}" ${pinAnchor.isDefault?'isDefault="true" ':''}/>`
		),
		"\t\t\t</ci:pins>"
	)

	let textLine = lines.filter((line) => colorTools.isColorEqual(line.color, textLineColor))
	if (textLine.length > 0) {
		let textPoint = textLine[0].end.minus(refPoint)
		metaLines.push(
			`\t\t\t<ci:textPosition x="${toFixedIfNecessary(textPoint.x)}" y="${toFixedIfNecessary(textPoint.y)}"/>`
		)
	}

	metaLines.push("\t\t</ci:componentInformation>", "\t</metadata>")

	//- put it all together ---
	if (!ID)
		ID = getFileBaseName(
			null,
			fileInfo.isNode ? nodeDescription.name : nodeDescription.drawName,
			fileInfo.isNode,
			nodeDescription.options
		)
	return `<symbol id="${ID}">\n` + metaLines.join("\n") + "\n" + filteredContent + "\n</symbol>\n"
}

/**
 *
 * @param {number} value
 * @param {number} dp
 * @returns
 */
function toFixedIfNecessary(value, dp = 5) {
	return +value.toFixed(dp)
}

/**
 * @param {string} optionName
 * @param {[{name:string}]} options
 */
function isOptionActive(optionName, options) {
	for (const option of options) {
		if (optionName == option.name) {
			return true
		}
	}
	return false
}

/**
 *
 * @param {object} option
 * @returns {string} the option as a string
 */
function optionStrFromOption(option, active) {
	/** @type {string} */
	const name = option.name
	let displayName = option.displayName
	displayName = displayName ? ` displayName="${displayName}"` : ""
	const activeStr = active ? ' active="true"' : ""
	if (name.includes("=")) {
		const [key, val] = name.split("=")
		return `\t\t\t\t<ci:option key="${key}" value="${val}"${displayName}${activeStr} />`
	} else {
		return `\t\t\t\t<ci:option key="${name}"${displayName}${activeStr} />`
	}
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
			let svgContent = await convertDVItoSVG(file.path)

			const svgOptions = getSvgOptions(svgContent)
			const viewBoxStr = svgOptions.get("viewbox")
			const viewBoxArray = viewBoxStr?.split(/ +/)
			if (!viewBoxStr || !viewBoxArray || viewBoxArray.length !== 4) throw new Error("SVG has no viewBox")

			const translateX = -parseFloat(viewBoxArray[0])
			const translateY = -parseFloat(viewBoxArray[1])

			svgContent = await convertDVItoSVG(file.path, translateX, translateY, 4 / 3)

			// get node information (name, pins, ...)
			const fileInfo = decodeFilename(file.stem)
			/** @type {?NodeDescription|PathComponentDescription} */
			const nodeDescription =
				(fileInfo && fileInfo.isNode && NODES_AND_PATHS.nodes[fileInfo.index]) ||
				(fileInfo && !fileInfo.isNode && NODES_AND_PATHS.path[fileInfo.index]) ||
				null
			if (!fileInfo || !nodeDescription) {
				console.log("Error: Couldn't decode filename: ", basename)
				return svgContent
			}
			const optionPossibilities = optionsObjectToArray(nodeDescription.options)

			// loop through all variations to find which one matches the filename
			for (const optionPossibility of optionPossibilities) {
				const optionsDisplay = optionPossibility.map((option) => option.displayName ?? option.name)

				const ID = getFileBaseName(
					fileInfo.index,
					fileInfo.isNode ? nodeDescription.name : nodeDescription.drawName,
					fileInfo.isNode,
					optionsDisplay
				)

				if (ID != file.stem) {
					continue
				}

				const addPins = []
				const subPins = []
				optionPossibility.forEach((option) => {
					if (option.addPins) {
						addPins.push(...option.addPins)
					}
					if (option.subPins) {
						subPins.push(...option.subPins)
					}
				})

				const nodeDescriptionCopy = Object.assign({}, nodeDescription)

				if (nodeDescriptionCopy.pins) {
					nodeDescriptionCopy.pins = nodeDescription.pins.filter(
						(anchorName) => !subPins.includes(anchorName)
					)
				} else {
					nodeDescriptionCopy.pins = []
				}
				nodeDescriptionCopy.pins.push(...addPins)

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
				}).data

				if (fileInfo && nodeDescriptionCopy)
					svgContent = convertSVGtoSymbol(svgContent, fileInfo, nodeDescriptionCopy, ID, optionPossibility)
				else console.log("Error: Couldn't decode filename: " + file.stem)

				if (svgContent) {
					file.contents = Buffer.from(svgContent, "utf8")
					file.extname = ".svg"

					return file
				}
			}
		},
		true
	)
}

export function combineSymbols() {
	return vinylMap(
		/**
		 * @param {Vinyl} file
		 * @returns {Promise<Vinyl>}
		 */
		async function (file) {
			let header =
				'<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<svg\n\tversion="1.1"\n\txmlns="http://www.w3.org/2000/svg"\n\txmlns:xlink="http://www.w3.org/1999/xlink"\n\txmlns:ci="urn:uuid:c93d8327-175d-40b7-bdf7-03205e4f8fc3">\n\t<defs>\n'
			let footer = "\n\t</defs>\n</svg>"

			let contents = file.contents.toString().split("\n")
			contents = contents.map((line) => {
				return "\t\t" + line
			})
			var filecontents = header + contents.join("\n") + footer

			const dom = new JSDOM(filecontents, { contentType: "text/xml" })
			const doc = dom.window.document

			const symbols = Array.from(doc.getElementsByTagName("symbol"))

			/**
			 * @type {Map<string,SVGSymbolElement[]>}
			 */
			const clusteredSymbols = new Map()
			for (const symbol of symbols) {
				const info = symbol.getElementsByTagName("ci:componentInformation")[0]
				const tikzname = info.getAttribute("tikzName")
				if (clusteredSymbols.has(tikzname)) {
					clusteredSymbols.get(tikzname).push(symbol)
				} else {
					clusteredSymbols.set(tikzname, [symbol])
				}
			}

			const metadata = doc.createElement("ci:metadata")

			clusteredSymbols.forEach((clusteredSymbol, key, map) => {
				const firstSymbol = clusteredSymbol[0]
				const firstComponentInfo = firstSymbol.getElementsByTagName("ci:componentInformation")[0]
				const component = doc.createElement("ci:component")
				component.setAttribute("type", firstComponentInfo.getAttribute("type"))
				component.setAttribute("displayName", firstComponentInfo.getAttribute("displayName"))
				component.setAttribute("tikzName", firstComponentInfo.getAttribute("tikzName"))
				component.setAttribute("groupName", firstComponentInfo.getAttribute("groupName"))

				var tikzOptions = firstSymbol.getElementsByTagName("ci:tikzOptions")[0]
				if (tikzOptions.children.length > 0) {
					tikzOptions.removeAttribute("xmlns:ci")
					component.appendChild(tikzOptions)
				}

				clusteredSymbol.forEach((symbol, index, array) => {
					const variant = doc.createElement("ci:variant")

					const componentInfo = symbol.getElementsByTagName("ci:componentInformation")[0]
					variant.setAttribute("refX", componentInfo.getAttribute("refX"))
					variant.setAttribute("refY", componentInfo.getAttribute("refY"))
					variant.setAttribute("viewBox", componentInfo.getAttribute("viewBox"))

					variant.setAttribute("for", symbol.id)
					const activeOptions = Array.from(symbol.getElementsByTagName("ci:option"))
					const pins = Array.from(symbol.getElementsByTagName("ci:pin"))
					activeOptions.forEach((option) => {
						if (option.hasAttribute("active")) {
							variant.appendChild(option)
							option.removeAttribute("active")
						}
					})
					pins.forEach((pin) => variant.appendChild(pin))
					const textPosition = symbol.getElementsByTagName("ci:textPosition")
					if (textPosition.length > 0) {
						variant.appendChild(textPosition[0])
					}
					component.appendChild(variant)
				})

				metadata.appendChild(component)
			})

			const metaDataElements = Array.from(doc.getElementsByTagName("metadata"))
			metaDataElements.forEach((element) => element.remove())

			doc.getElementsByTagName("svg")[0].prepend(metadata)

			filecontents = optimize(dom.serialize(), {
				multipass: false,
				floatPrecision: 5,
				js2svg: {
					indent: "\t",
					pretty: true,
					eol: "lf",
					finalNewline: true,
				},
				plugins: [
					"removeDimensions",
					"removeViewBox",
					{ name: "cleanupIds", params: { force: false, minify: false, remove: false } },
					{
						name: "convertPathData",
						params: {
							applyTransforms: true,
							forceAbsolutePath: false,
							utilizeAbsolute: false,
							floatPrecision: 4,
							removeUseless: true,
							collapseRepeated: true,
						},
					},
					{ name: "mergePaths", params: { noSpaceAfterFlags: true } },
				],
			}).data

			file.contents = Buffer.from(filecontents, "utf8")
			return file
		},
		true
	)
}
