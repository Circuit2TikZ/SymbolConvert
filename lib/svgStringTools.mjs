// @ts-check
/**
 * Functions for extracting information from SVG strings.
 * @module svgStringTools
 */

/**
 * Extract a list of xml options (the parameters in any svg or xml tag) from a string.
 *
 * @param {string} svgTagInner - the tag "content"; \<tagname svgTagInner /\>
 * @returns {Map<string,string>} a map with the options
 */
export function getTagOptions(svgTagInner) {
	return new Map(
		Array.from(svgTagInner.matchAll(/(?<k>[\w:]+)=((?<v1>\w)|(\"(?<v2>[^"]+)\")|(\'(?<v3>[^']+)\'))/g), (match) => [
			// @ts-ignore named groups are a requirement for the RegEx --> match.groups is always defined
			match.groups.k.toLowerCase(),
			// @ts-ignore named groups are a requirement for the RegEx --> match.groups is always defined
			match.groups.v1 || match.groups.v2 || match.groups.v3 || "",
		])
	);
}

/**
 * Extract a list of svg options (the parameters in the svg tag) from a string.
 *
 * @param {string} svgContent - the string containing the svg
 * @returns {Map<string,string>} a map with the options
 * @throws {Error} if the svg tag can't be found
 */
export function getSvgOptions(svgContent) {
	const svgTagInner = svgContent.match(/<svg *(?<inner>[^>]+) *>/s)?.groups?.inner ?? null;
	if (svgTagInner === null) throw new Error("Couldn't find the svg tag");
	return getTagOptions(svgTagInner);
}

/**
 * Extract the content between the opening and the closing svg-tag.
 *
 * @param {string} svgContent - the string containing the svg
 * @return {string} the extracted "content"
 * @throws {Error} if the svg tag can't be found
 */
export function getSVGInnerContent(svgContent) {
	const regex = /<svg[^>]*>[ \t]*[\r\n]*(?<inner>.*?)\s*<\/svg/is;
	const inner = svgContent.match(regex)?.groups?.inner;
	if (!inner) throw new Error("Couldn't find content of the SVG-tag");
	return inner;
}
