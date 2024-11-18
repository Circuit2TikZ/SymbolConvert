// @ts-check
/**
 * Module extending the SVG.js Point class with useful functions.
 * @module
 */

import { extend, Point, Path } from "@svgdotjs/svg.js"
import { parseColorString } from "./colorTools.mjs"

/** @typedef {import("./colorTools.mjs").rgbColor} rgbColor */

extend(Point, {
	/**
	 * Subtracts another svg point.
	 * Returns a new instance.
	 *
	 * @memberof Point
	 * @this {Point}
	 * @param {Point} other - the subtrahend
	 * @returns {Point} the result
	 */
	minus(other) {
		return new Point(this.x - other.x, this.y - other.y)
	},
})

export { Point }

/**
 * Check if two points have nearly the same coordinates. (up to a floating point error)
 *
 * @param  {Point} pointA - first point
 * @param  {Point} pointB - second point
 * @param  {Number} eps - floating point error margin
 * @returns {boolean} `true`, if both points are close enough
 */
export function areTwoPointsClose(pointA, pointB, eps = 1e-6) {
	return (
		pointA.x >= pointB.x - eps &&
		pointA.x <= pointB.x + eps &&
		pointA.y >= pointB.y - eps &&
		pointA.y <= pointB.y + eps
	)
}

/**
 * @typedef {object} Line
 * @property {Point} start
 * @property {Point} end
 * @property {rgbColor} color
 */

/**
 * Find the point, where the most `Lines` start or end.
 *
 * @param  {...Line|Line[]} lines - the lines to process
 * @returns {Point} the found point
 */
export function findMatchingLinePoint(...lines) {
	/** @type {Line[]} */ // @ts-ignore
	const lineArray = lines.length === 1 && lines[0] instanceof Array ? lines[0] : lines

	/** @type {Point[]} */
	const points = lineArray.flatMap((line) => [line.start, line.end])

	let eps = 1e-6

	return (
		points
			.reduce((/** @type {{point: Point, count: number}[]} */ acc, point) => {
				let item = acc.find((item) => item.point === point || areTwoPointsClose(item.point, point))
				if (item) item.count++
				else acc.push({ point: point, count: 1 })
				return acc
			}, [])
			.sort((a, b) => b.count - a.count)[0]?.point || null
	)
}

/**
 * Convert a SVG path to an simple line
 *
 * @param {Path} path - the SVG path to "parse"
 * @returns {Line} the extracted line
 * @throws {Error} if the path or path color (stroke) is malformed
 */
export function svgPathToLine(path) {
	/** @type {{start: Point|null,end: Point|null, color: rgbColor}} */
	let line = {
		start: null,
		end: null,
		color: parseColorString(path.stroke()),
	}

	/** @type {import("@svgdotjs/svg.js").PathArray} */
	const d = path.array()
	if (d.length !== 2) throw new Error("Unexpected number of draw commands") // Start & endpoint
	const startArray = d[0]
	const endArray = d[1]

	if (startArray.length !== 3 || !(startArray[0] === "M" || startArray[0] === "m"))
		throw new Error("First draw command malformed") // [M]ove to x, y
	// @ts-ignore new Point accepts an array with two numbers
	line.start = new Point(startArray.slice(1))
	line.end = new Point(line.start)

	// parse draw commands
	switch (endArray[0]) {
		case "L":
			// absolute lineTo (x, y)
			line.end.x = endArray[1]
			line.end.y = endArray[2]
			break
		case "l":
			// relative lineTo (dx, dy)
			line.end.x += endArray[1]
			line.end.y += endArray[2]
			break
		case "H":
			// absolute horizontal lineTo (only x)
			line.end.x = endArray[1]
			break
		case "h":
			// relative horizontal lineTo (only dx)
			line.end.x += endArray[1]
			break
		case "V":
			// absolute vertical lineTo (only y)
			line.end.y = endArray[1]
			break
		case "v":
			// relative vertical lineTo (only dy)
			line.end.y += endArray[1]
			break
		default:
			// error wrong command
			throw null
	}

	if (!Number.isFinite(line.end.x) || !Number.isFinite(line.end.x))
		throw new Error("Could not parse second draw command")

	// @ts-ignore both .start & .end are set within this function
	return line
}
