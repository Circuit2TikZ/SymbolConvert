import subprocess
import pathlib
import glob
import re
import xml.dom.minidom as dom
import svgelements as svg
import json
from utils import (
	Pin_Anchor,
	are_two_points_close,
	color_to_index,
	component_name_from_info,
	filter_newer,
	find_matching_line_point,
	is_option_active,
	options_object_to_array,
	parse_filename,
	svg_path_to_line,
)
from tqdm.contrib.concurrent import thread_map
from utils import NODES_AND_PATHS
from settings import SVGO_BASE_CONFIG
import copy


def _compile_DVI_to_SVG_worker(path: pathlib.Path, translateX=0, translateY=0, scale=1):
	command = [
		"dvisvgm",
		"--bbox=min",
		"--clipjoin",
		"--optimize=group-attributes,remove-clippaths,simplify-transform,collapse-groups",
		"--no-fonts",
		"--stdout",
	]

	if translateX or translateY:
		command.append("--translate=" + str(translateX) + "," + str(translateY))
	if scale != 1:
		command.append("--scale=" + str(scale))
	command.append(path.absolute().as_posix())

	p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, cwd=path.parent)
	out, _ = p.communicate()
	return out.decode()


PATH_PATTERN = re.compile(r"^\s*(?P<tag><(?P<tagname>\w+) *(?P<inner>[^>]+?) *\/>)\s*$")


def _convert_SVG_to_symbol_worker(svg_content: str, index, is_node, node_description, ID, option_possibility):
	view_box_string = get_SVG_options(svg_content)["viewbox"]
	svg_content = get_SVG_inner_content(svg_content)

	errors = []
	errorcode = 0

	lines = []
	filtered_content = []
	for line in re.split(r"\r?\n", svg_content):
		match = re.match(PATH_PATTERN, line)
		try:
			assert match and match["tagname"].lower() == "path" and len(match["inner"]) >= 10
			tag_options = get_tag_options(match["inner"])
			if "fill" in tag_options and tag_options["fill"].lower() != "none":
				raise ValueError("Path has a fill color, which is not allowed.")

			svg_lines = svg_path_to_line(tag_options)
			line_color: svg.Color = svg_lines["color"]
			if line_color is None or (line_color.red == 0 and line_color.green == 0 and line_color.blue == 0):
				raise
			lines.append(svg_lines)
		except BaseException:
			filtered_content.append(line)

	filtered_content = "\n".join(filtered_content)

	# the line corresponding to the text anchor point
	text_line_colors = [svg.Color("#f00"), svg.Color("rgb(255,0,155)")]
	zero_line_colors = [svg.Color("#ff0"), svg.Color("#0ff")]

	pin_lines = [
		line
		for line in lines
		if all([svg.Color.distance_sq(line["color"], c) != 0 for c in (zero_line_colors + text_line_colors)])
	]
	ref_point = find_matching_line_point(lines)
	zero_coordinate = svg.Point(0, 0)

	pin_anchors = (
		["START", "END", *(node_description["pins"] if "pins" in node_description else [])]
		if not is_node
		else (node_description["pins"] if "pins" in node_description else [])
	)
	pin_anchors = [anchor_name for anchor_name in pin_anchors if anchor_name != "center"]
	pin_anchors = [Pin_Anchor(anchor_name, None, False) for anchor_name in pin_anchors]

	for line in pin_lines:
		# sort line start/end; end=relevant point
		if not are_two_points_close(line["start"], ref_point):
			# unsorted
			if are_two_points_close(line["end"], ref_point):
				line["end"] = line["start"]
				line["start"] = ref_point
			else:
				errors.append("Error parsing line: " + line["start"] + line["end"] + line["color"])
				errorcode = 1

		index = color_to_index(line["color"])
		pin_anchor = pin_anchors[index]

		if pin_anchor is not None:
			pin_anchor.point = line["end"] - ref_point
		else:
			raise ("No matching pin description found for line color: " + line["color"])

	# add center anchor back as pin, if indicated by nodeDescription
	if "pins" in node_description and "center" in node_description["pins"]:
		pin_anchors.append(Pin_Anchor("center", zero_coordinate, False))

	has_default = False
	for pin_anchor in pin_anchors:
		if not pin_anchor.point:
			pin_anchor.point = svg.Point(0, 0)
			errors.append(
				"Warning["
				+ (node_description["name"] if "name" in node_description else node_description["drawName"])
				+ "]: Anchor "
				+ pin_anchor.anchor_name
				+ " not found; assuming (0, 0)"
			)
		if not has_default and are_two_points_close(zero_coordinate, pin_anchor.point):
			has_default = True
			pin_anchor.default = True

	tikz_name = node_description["name"] if is_node else node_description["drawName"]
	shape_name = (
		None
		if is_node
		else (
			node_description["shapeName"]
			if "shapeName" in node_description
			else node_description["drawName"].replace(" ", "") + "shape"
		)
	)

	meta_lines = ["\t<metadata>"]
	ci_line = f'\t\t<ci:componentInformation type="{"node" if is_node else "path"}"{' displayName="' + node_description["displayName"] + '"' if "displayName" in node_description else ""} tikzName="{tikz_name}" {'shapeName="' + shape_name + '" ' if shape_name is not None else ""}{'groupName="' + node_description["groupName"] + '" ' if "groupName" in node_description else '" '}refX="{ref_point.x}" refY="{ref_point.y}" viewBox="{view_box_string}">'
	meta_lines.append(ci_line)

	def format_option(option: dict) -> str:
		if "enumOptions" in option:
			# is an enum option
			select_none = f' selectNone="{option["selectNone"]}"' if "selectNone" in option else ""
			display_name = f' displayName="{option["displayName"]}"' if "displayName" in option else ""

			enum_lines = [f"\t\t\t\t<ci:enumOption{select_none}{display_name}>"]
			for enum_option in option["enumOptions"]:
				enum_lines.append(
					option_str_from_option(enum_option, is_option_active(enum_option["name"], option_possibility))
				)
			enum_lines.append("\t\t\t</ci:enumOption>")
			return "\n\t".join(enum_lines)

	meta_lines.append("\t\t\t<ci:tikzOptions>")
	meta_lines.extend(map(format_option, node_description["options"] if "options" in node_description else []))
	meta_lines.append("\t\t\t</ci:tikzOptions>")

	meta_lines.append("\t\t\t<ci:pins>")
	meta_lines.extend(
		[
			f'\t\t\t\t<ci:pin anchorName="{pin_anchor.anchor_name}" x="{pin_anchor.point.x}" y="{pin_anchor.point.y}" {'isDefault="True" ' if pin_anchor.default else ""}/>'
			for pin_anchor in pin_anchors
		]
	)
	meta_lines.append("\t\t\t</ci:pins>")

	text_line = [line for line in lines if svg.Color.distance_sq(line["color"], text_line_colors[0]) == 0]
	if len(text_line) > 0:
		text_point: svg.Point = text_line[0]["end"] - ref_point
		meta_lines.append(f'\t\t\t<ci:textPosition x="${text_point.x}" y="${text_point.y}"/>')

	meta_lines.append("\t\t</ci:componentInformation>")
	meta_lines.append("\t</metadata>")

	# - put it all together ---
	if ID is None:
		ID = component_name_from_info(
			None,
			node_description["name"] if is_node else node_description["drawName"],
			is_node,
			node_description["options"],
		)
	return (
		errorcode,
		"\n".join(errors),
		f'<symbol id="{ID}">\n' + "\n".join(meta_lines) + "\n" + filtered_content + "\n</symbol>\n",
	)


def option_str_from_option(option, active) -> str:
	name: str = option["name"]
	display_name = option["displayName"]
	display_name = f' displayName="${display_name}"' if display_name else ""
	active_str = ' active="true"' if active else ""
	if "=" in name:
		[key, val] = name.split("=")
		return f'\t\t\t\t<ci:option key="{key}" value="{val}"{display_name}{active_str} />'
	else:
		return f'\t\t\t\t<ci:option key="{name}"{display_name}{active_str} />'


def _convert_DVI_to_symbol_worker(path: pathlib.Path):
	# convert from dvi to svg
	# then convert the svg to a symbol
	svg_content = _compile_DVI_to_SVG_worker(path)

	svg_options = get_SVG_options(svg_content)
	view_box_str = svg_options["viewbox"]
	view_box_array = re.split(r" +", view_box_str)
	if view_box_str == "" or len(view_box_array) != 4:
		raise ValueError("SVG has no viewBox")

	translate_x = -float(view_box_array[0])
	translate_y = -float(view_box_array[1])

	svg_content = _compile_DVI_to_SVG_worker(path, translateX=translate_x, translateY=translate_y, scale=4 / 3)

	# get node information (name, pins, ...)
	index, is_node = parse_filename(path.stem)
	if is_node:
		node_description: dict = NODES_AND_PATHS["nodes"][index]
	else:
		node_description: dict = NODES_AND_PATHS["path"][index]

	option_possibilities = options_object_to_array(node_description["options"] if "options" in node_description else [])

	for option_possibility in option_possibilities:
		optionsDisplay = list(
			map(lambda option: option["displayName"] if "displayName" in option else option["name"], option_possibility)
		)
		name = component_name_from_info(
			index, node_description["name"] if is_node else node_description["drawName"], is_node, optionsDisplay
		)

		if name == path.stem:
			break

	addPins = []
	subPins = []
	for option in option_possibility:
		if "addPins" in option:
			addPins.extend(option["addPins"])
		if "subPins" in option:
			subPins.extend(option["subPins"])

	node_description_copy = node_description.copy()
	if "pins" in node_description_copy:
		node_description_copy["pins"] = [pin for pin in node_description["pins"] if pin not in subPins]
	else:
		node_description_copy["pins"] = []
	node_description_copy["pins"].extend(addPins)

	ID = component_name_from_info(
		None, node_description["name"] if is_node else node_description["drawName"], is_node, optionsDisplay
	)

	svgo_config = copy.deepcopy(SVGO_BASE_CONFIG)
	svgo_config["plugins"].append(
		{
			"name": "prefixIds",
			"params": {
				"delim": "_",
				"prefix": ID,
				"prefixIds": True,
				"prefixClassNames": True,
			},
		}
	)

	config_name = f"{name}.config.js"
	with open(path.parent / config_name, "w") as f:
		f.write("module.exports=" + json.dumps(svgo_config, indent=4))

	command = ["svgo", "--config", config_name, "-i", "-", "-o", "-"]
	p = subprocess.Popen(
		command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, cwd=path.parent
	)
	out, err = p.communicate(input=svg_content.encode())
	svg_content = out.decode()
	(path.parent / config_name).unlink()
	returncode = p.returncode
	returnstr = out.decode()
	if p.returncode == 0:
		returncode, returnstr, svg_content = _convert_SVG_to_symbol_worker(
			svg_content, index, is_node, node_description_copy, ID, option_possibility
		)

		if svg_content:
			with open(path.parent / (path.stem + ".svg"), "w") as f:
				f.write(svg_content)

	return returncode, returnstr, path


def convert_DVI_to_SVGs():
	# call this from the main script
	all_files = glob.glob("build/*.dvi")
	all_files = filter_newer(all_files, ".svg")
	# _convert_DVI_to_symbol_worker(pathlib.Path(all_files[0]))
	results = thread_map(_convert_DVI_to_symbol_worker, all_files, desc="Converting .dvi files", unit="file")
	errors = [r for r in results if r[0] != 0]
	warnings = [r for r in results if r[0] == 0 and r[1].strip() != ""]
	if len(errors) > 0:
		print(f"Errors ({len(errors)}) occurred during compilation:")
		for r in errors:
			print(r[1])

	if len(warnings) > 0:
		print(f"Warnings ({len(warnings)}) occurred during compilation:")
		for r in warnings:
			print(r[1])

	if len(errors) == 0 and len(warnings) == 0:
		print("Sucessfully converted all .dvi files!")


def combine_SVGs_to_symbol():
	header = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<svg\n\tversion="1.1"\n\txmlns="http://www.w3.org/2000/svg"\n\txmlns:xlink="http://www.w3.org/1999/xlink"\n\txmlns:ci="urn:uuid:c93d8327-175d-40b7-bdf7-03205e4f8fc3">\n\t<defs>\n'
	footer = "\n\t</defs>\n</svg>"

	all_files = glob.glob("build/*.svg")
	contents = []
	for file in all_files:
		with open(file) as f:
			contents.extend(f.readlines())

	contents = map(lambda line: "\t\t" + line, contents)
	filecontents = header + "\n".join(contents) + footer

	doc = dom.parseString(filecontents)
	symbols = doc.getElementsByTagName("symbol")

	clusteredSymbols: dict[str, list[dom.Element]] = {}
	for symbol in symbols:
		info = symbol.getElementsByTagName("ci:componentInformation")[0]
		tikzname = info.getAttribute("tikzName")
		if tikzname in clusteredSymbols:
			clusteredSymbols[tikzname].append(symbol)
		else:
			clusteredSymbols[tikzname] = [symbol]

	metadata = doc.createElement("ci:metadata")

	for key, clusteredSymbol in clusteredSymbols.items():
		firstSymbol = clusteredSymbol[0]
		firstComponentInfo = firstSymbol.getElementsByTagName("ci:componentInformation")[0]
		component = doc.createElement("ci:component")
		component.setAttribute("type", firstComponentInfo.getAttribute("type"))
		component.setAttribute("displayName", firstComponentInfo.getAttribute("displayName"))
		component.setAttribute("tikzName", firstComponentInfo.getAttribute("tikzName"))
		component.setAttribute("groupName", firstComponentInfo.getAttribute("groupName"))

		tikzOptions = firstSymbol.getElementsByTagName("ci:tikzOptions")[0]
		if tikzOptions.hasChildNodes():
			try:
				tikzOptions.removeAttribute("xmlns:ci")
			except BaseException:
				pass
			component.appendChild(tikzOptions.cloneNode(True))

		for symbol in clusteredSymbol:
			variant = doc.createElement("ci:variant")

			componentInfo = symbol.getElementsByTagName("ci:componentInformation")[0]
			variant.setAttribute("refX", componentInfo.getAttribute("refX"))
			variant.setAttribute("refY", componentInfo.getAttribute("refY"))
			variant.setAttribute("viewBox", componentInfo.getAttribute("viewBox"))

			variant.setAttribute("for", symbol.getAttribute("id"))
			activeOptions = symbol.getElementsByTagName("ci:option")
			pins = symbol.getElementsByTagName("ci:pin")
			for option in activeOptions:
				if option.hasAttribute("active"):
					variant.appendChild(option)
					option.removeAttribute("active")

			for pin in pins:
				variant.appendChild(pin)
			textPosition = symbol.getElementsByTagName("ci:textPosition")
			if textPosition.length > 0:
				variant.appendChild(textPosition[0])

			component.appendChild(variant)

		metadata.appendChild(component)

	metaDataElements = doc.getElementsByTagName("metadata")
	for element in metaDataElements:
		element.parentNode.removeChild(element)

	doc.getElementsByTagName("svg")[0].appendChild(metadata)

	svgo_config = {
		"multipass": False,
		"floatPrecision": 5,
		"js2svg": {
			"indent": "\t",
			"pretty": True,
			"eol": "lf",
			"finalNewline": True,
		},
		"plugins": [
			"removeDimensions",
			"removeViewBox",
			{"name": "cleanupIds", "params": {"force": False, "minify": False, "remove": False}},
			{
				"name": "convertPathData",
				"params": {
					"applyTransforms": True,
					"forceAbsolutePath": False,
					"utilizeAbsolute": False,
					"floatPrecision": 4,
					"removeUseless": True,
					"collapseRepeated": True,
				},
			},
			{"name": "mergePaths", "params": {"noSpaceAfterFlags": True}},
		],
	}
	config_name = "symbols.config.js"
	with open(config_name, "w") as f:
		f.write("module.exports=" + json.dumps(svgo_config, indent=4))

	command = ["svgo", "--config", config_name, "-i", "-", "-o", "-"]
	p = subprocess.Popen(
		command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, cwd="."
	)
	out, err = p.communicate(input=doc.toxml().encode())
	svg_content = out.decode()
	if p.returncode != 0:
		print(f"Error combining symols to SVG:\n{err.decode()}")
		return

	with open("symbols.svg", "w") as f:
		f.write(svg_content)

	pathlib.Path(config_name).unlink()


OPTIONS_PATTERN = re.compile(r"<svg *(?P<inner>[^>]+) *>")


def get_SVG_options(svg_content) -> dict[str, str]:
	matches = re.search(OPTIONS_PATTERN, svg_content)
	return get_tag_options(matches.group("inner"))


INNER_TAG_PATTERN = re.compile(r"(?P<k>[\w:]+)=((?P<v1>\w)|(\"(?P<v2>[^\"]+)\")|(\'(?P<v3>[^']+)\'))")


def get_tag_options(svg_tag_inner):
	options = {}
	for match in re.finditer(INNER_TAG_PATTERN, svg_tag_inner):
		k = match["k"].lower()
		v = match["v1"] or match["v2"] or match["v3"] or ""
		options[k] = v
	return options


INNER_CONTENT_PATTERN = re.compile(r"<svg[^>]*>[ \t]*[\r\n]*(?P<inner>.*?)\s*<\/svg", re.IGNORECASE | re.DOTALL)


def get_SVG_inner_content(svg_content):
	match = re.search(INNER_CONTENT_PATTERN, svg_content)
	inner = match.group("inner") if match else None
	return inner


# convert_DVI_to_SVGs()
# combine_SVGs_to_symbol()
