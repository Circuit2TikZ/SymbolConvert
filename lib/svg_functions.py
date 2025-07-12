import itertools
import subprocess
import pathlib
import glob
import re
import xml.dom.minidom as dom
import svgelements as svg
import json
import copy

from dataclasses import dataclass
from svgelements import Color, Path, Point
from utils import (
	are_two_points_close,
	color_to_index,
	component_name_from_info,
	filter_newer,
	options_object_to_array,
	parse_filename,
)
from tqdm.contrib.concurrent import thread_map
from utils import NODES_AND_PATHS
from settings import SVGO_BASE_CONFIG, SVGO_CONFIG


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


def svg_path_to_line(path: dom.Element):
	path_stroke = path.getAttribute("stroke")
	line = {
		"start": None,
		"end": None,
		"color": Color(path_stroke if path_stroke != "" else "#000"),
	}

	d = Path(path.getAttribute("d"))
	if len(d) != 2:
		raise "Unexpected number of draw commands"  # Start & endpoint
	line["start"] = d[-1].start
	line["end"] = d[-1].end
	return line


def is_option_active(option_name, options):
	for option in options:
		if option_name == option["name"]:
			return True
	return False


def find_matching_line_point(lines: list[dict]):
	points = [[line["start"], line["end"]] for line in lines]
	points = list(itertools.chain.from_iterable(points))  # flatten list

	acc: dict[Point, int] = {points[0]: 1}
	for point in points[1:]:
		close = next(
			(k for k in acc.keys() if k and point and are_two_points_close(k, point)),
			None,
		)
		if close is not None:
			acc[close] += 1
		else:
			acc[point] = 1

	point = None
	max_count = 0
	for entry in acc:
		if acc[entry] > max_count:
			point = entry
			max_count = acc[entry]

	return point


@dataclass
class Pin_Anchor:
	anchor_name: str
	point: Point
	default: bool


def _convert_SVG_to_symbol_worker(svg_content: str, index, is_node, node_description, ID, option_possibility):
	doc = dom.parseString(svg_content)
	svg_doc = doc.firstChild

	paths = svg_doc.getElementsByTagName("path")
	lines = []
	for path in paths:
		try:
			path_fill = path.getAttribute("fill")
			if path_fill != "" and path_fill != "none":
				raise ValueError("Path has a fill color, which is not allowed.")
			svg_line = svg_path_to_line(path)
			line_color: svg.Color = svg_line["color"]
			if line_color is None or line_color == "black":
				raise
			lines.append(svg_line)
			path.parentNode.removeChild(path)
		except BaseException:
			pass

	tikz_name = node_description["name"] if is_node else node_description["drawName"]

	errorcode = 0

	# the line corresponding to the text anchor point
	text_line_colors = [svg.Color("#f00"), svg.Color("rgb(255,0,155)")]
	zero_line_colors = [svg.Color("#ff0"), svg.Color("#0ff")]

	# all lines which are not text or zero lines
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
				print(f"Error parsing line ({tikz_name}): {line['start']}; {line['end']}; {line['color']}")
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
		if not has_default and are_two_points_close(zero_coordinate, pin_anchor.point):
			has_default = True
			pin_anchor.default = True

	shape_name = (
		None
		if is_node
		else (
			node_description["shapeName"]
			if "shapeName" in node_description
			else node_description["drawName"].replace(" ", "") + "shape"
		)
	)

	# build dom tree for metadata
	metadata = doc.createElement("metadata")
	# fill in attributes
	componentInfo = doc.createElement("componentInformation")
	componentInfo.setAttribute("type", "node" if is_node else "path")
	if "displayName" in node_description:
		componentInfo.setAttribute("display", node_description["displayName"])
	componentInfo.setAttribute("tikz", tikz_name)
	if shape_name is not None:
		componentInfo.setAttribute("shape", shape_name)
	if "groupName" in node_description:
		componentInfo.setAttribute("group", node_description["groupName"])
	componentInfo.setAttribute("refX", f"{ref_point.x:.5f}")
	componentInfo.setAttribute("refY", f"{ref_point.y:.5f}")
	componentInfo.setAttribute("viewBox", svg_doc.getAttribute("viewBox"))

	# fill in options
	if "options" in node_description:
		tikz_options = doc.createElement("options")
		for option in node_description["options"]:
			if "enumOptions" in option:
				enum = doc.createElement("enumopt")
				if "selectNone" in option:
					enum.setAttribute("selectNone", str(option["selectNone"]))
				if "displayName" in option:
					enum.setAttribute("name", option["displayName"])

				for enum_option in option["enumOptions"]:
					enum.appendChild(
						_convert_option(enum_option, is_option_active(enum_option["name"], option_possibility), doc)
					)
				tikz_options.appendChild(enum)
			else:
				tikz_options.appendChild(
					_convert_option(option, is_option_active(option["name"], option_possibility), doc)
				)
		componentInfo.appendChild(tikz_options)

	# fill in pins
	if len(pin_anchors) > 0:
		pins = doc.createElement("pins")
		for pin_anchor in pin_anchors:
			pin = doc.createElement("pin")
			pin.setAttribute("name", pin_anchor.anchor_name)
			if pin_anchor.point.x != 0:
				pin.setAttribute("x", f"{pin_anchor.point.x:.5f}")
			if pin_anchor.point.y != 0:
				pin.setAttribute("y", f"{pin_anchor.point.y:.5f}")
			if pin_anchor.default:
				pin.setAttribute("isDefault", "true")
			pins.appendChild(pin)
		componentInfo.appendChild(pins)

		##############################

	text_line = [line for line in lines if svg.Color.distance_sq(line["color"], text_line_colors[0]) == 0]
	if len(text_line) > 0:
		text_point: svg.Point = text_line[0]["end"] - ref_point
		text_position = doc.createElement("textpos")
		text_position.setAttribute("x", f"{text_point.x:.5f}")
		text_position.setAttribute("y", f"{text_point.y:.5f}")
		componentInfo.appendChild(text_position)

	metadata.appendChild(componentInfo)
	svg_doc.appendChild(metadata)

	# - put it all together ---
	if ID is None:
		ID = component_name_from_info(
			None,
			node_description["name"] if is_node else node_description["drawName"],
			is_node,
			node_description["options"],
		)

	svg_symbol = doc.createElement("symbol")
	svg_symbol.setAttribute("id", ID)

	while svg_doc.firstChild:
		svg_symbol.appendChild(svg_doc.firstChild)

	return (
		errorcode,
		svg_symbol.toxml(),
	)


def _convert_option(option: dict, active: bool, doc: dom.Document) -> dom.Element:
	option_element = doc.createElement("option")
	name: str = option["name"]
	if "displayName" in option:
		option_element.setAttribute("display", option["displayName"])
	if active:
		option_element.setAttribute("active", "true")

	if "=" in name:
		[key, val] = name.split("=")
		option_element.setAttribute("key", key)
		option_element.setAttribute("value", val)
	else:
		option_element.setAttribute("key", name)

	return option_element


def _convert_DVI_to_symbol_worker(path: pathlib.Path):
	# convert from dvi to svg
	# then convert the svg to a symbol
	svg_content = _compile_DVI_to_SVG_worker(path)
	doc = dom.parseString(svg_content).getElementsByTagName("svg")[0]

	view_box_array = re.split(r" +", doc.getAttribute("viewBox"))
	if len(view_box_array) != 4:
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
	if p.returncode == 0:
		returncode, svg_content = _convert_SVG_to_symbol_worker(
			svg_content, index, is_node, node_description_copy, ID, option_possibility
		)

		if svg_content:
			with open(path.parent / (path.stem + ".svg"), "w") as f:
				f.write(svg_content)
	else:
		print(f"Error while svg optimizing {path.stem}:", out.decode())

	return returncode


def convert_DVI_to_SVGs():
	# call this from the main script
	all_files = glob.glob("build/*.dvi")
	all_files = filter_newer(all_files, ".svg")
	# _convert_DVI_to_symbol_worker(pathlib.Path(all_files[0]))
	results = thread_map(
		_convert_DVI_to_symbol_worker, all_files, desc="Converting .dvi files", unit="file", smoothing=0.1
	)
	errors = [r for r in results if r != 0]
	if len(errors) > 0:
		print(f"A total of {len(errors)} errors occurred during compilation:")
	else:
		print("Sucessfully converted all .dvi files to .svg files!")


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
		info = symbol.getElementsByTagName("componentInformation")[0]
		tikzname = info.getAttribute("tikz")
		if tikzname in clusteredSymbols:
			clusteredSymbols[tikzname].append(symbol)
		else:
			clusteredSymbols[tikzname] = [symbol]

	metadata = doc.createElement("metadata")

	for key, clusteredSymbol in clusteredSymbols.items():
		firstSymbol = clusteredSymbol[0]
		firstComponentInfo = firstSymbol.getElementsByTagName("componentInformation")[0]
		component = doc.createElement("component")
		symbol_type = firstComponentInfo.getAttribute("type")
		component.setAttribute("type", symbol_type)
		component.setAttribute("display", firstComponentInfo.getAttribute("display"))
		component.setAttribute("tikz", firstComponentInfo.getAttribute("tikz"))
		component.setAttribute("group", firstComponentInfo.getAttribute("group"))
		if symbol_type == "path":
			component.setAttribute("shape", firstComponentInfo.getAttribute("shape"))

		tikz_options = firstSymbol.getElementsByTagName("options")
		if len(tikz_options) > 0 and tikz_options[0].hasChildNodes():
			try:
				tikz_options[0].removeAttribute("xmlns:ci")
			except BaseException:
				pass
			component.appendChild(tikz_options[0].cloneNode(True))

		for symbol in clusteredSymbol:
			variant = doc.createElement("variant")

			componentInfo = symbol.getElementsByTagName("componentInformation")[0]
			ref_x = float(componentInfo.getAttribute("refX"))
			ref_y = float(componentInfo.getAttribute("refY"))
			if ref_x != 0:
				variant.setAttribute("x", str(ref_x))
			if ref_y != 0:
				variant.setAttribute("y", str(ref_y))
			variant.setAttribute("viewBox", componentInfo.getAttribute("viewBox"))

			variant.setAttribute("for", symbol.getAttribute("id"))
			activeOptions = symbol.getElementsByTagName("option")
			for option in activeOptions:
				if option.hasAttribute("active"):
					option.removeAttribute("active")
					if option.hasAttribute("display"):
						option.removeAttribute("display")
					variant.appendChild(option)

			pins = symbol.getElementsByTagName("pin")
			for pin in pins:
				variant.appendChild(pin)
			textPosition = symbol.getElementsByTagName("textpos")
			if textPosition.length > 0:
				variant.appendChild(textPosition[0])

			component.appendChild(variant)

		metadata.appendChild(component)

	metaDataElements = doc.getElementsByTagName("metadata")
	for element in metaDataElements:
		element.parentNode.removeChild(element)

	doc.getElementsByTagName("svg")[0].appendChild(metadata)

	config_name = "symbols.config.js"
	with open(config_name, "w") as f:
		f.write("module.exports=" + json.dumps(SVGO_CONFIG, indent=4))

	command = ["svgo", "--config", config_name, "-i", "-", "-o", "-"]
	p = subprocess.Popen(
		command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, cwd="."
	)
	out, err = p.communicate(input=doc.toxml().encode())
	svg_content = out.decode()
	if p.returncode != 0:
		print(f"Error combining symbols to SVG:\n{err.decode()}")
		return

	with open("symbols.svg", "w") as f:
		f.write(svg_content)

	pathlib.Path(config_name).unlink()
