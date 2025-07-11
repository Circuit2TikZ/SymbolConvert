from tqdm.contrib.concurrent import thread_map
import glob
import os
import pathlib
import subprocess
from utils import NODES_AND_PATHS, component_name_from_info, filter_newer, index_to_color, options_object_to_array


def _compile_worker(path: pathlib.Path):
	"""
	Worker function to compile a single .tex file to .dvi.
	"""
	command = [
		"lualatex",
		"-halt-on-error",
		"-output-format=dvi",
		"-interaction=nonstopmode",
		f'-jobname="{path.stem}"',
		path.absolute(),
	]
	p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True, cwd=path.parent)
	out, _ = p.communicate()

	# remove auxiliary files
	extensionBlacklist = [".aux", ".log", ".tmp", ".toc"]
	for outfile in glob.glob(f"{path.stem}.*", root_dir=path.parent):
		outfile_path = path.parent / outfile
		if outfile_path.suffix in extensionBlacklist:
			outfile_path.unlink()
	return p.returncode, out.decode(), path


def compile_tex_files():
	all_files = glob.glob("build/*.tex")
	all_files = filter_newer(all_files, ".dvi")

	results = thread_map(_compile_worker, all_files, desc="Compiling .tex files", unit="file")
	error_rs = [r for r in results if r[0] != 0]
	if len(error_rs) > 0:
		print(f"Errors ({len(error_rs)}) occurred during compilation:")
		for r in error_rs:
			print(f"Error compiling {r[2].stem}:")
			print(r[1])
	else:
		print("Sucessfully compiled all .tex files!")


def create_tex_files_from_json(output_dir="build"):
	"""
	Reads a JSON file and creates .tex files in the specified output directory.
	"""
	# Ensure the output directory exists
	os.makedirs(output_dir, exist_ok=True)

	# load node stencil
	with open("stencil_pgf_node.tex", "r") as f:
		node_stencil = f.read()
		node_stencil_pre, node_stencil_mid = node_stencil.split("<nodename>", 2)
		node_stencil_mid, node_stencil_post = node_stencil_mid.split("<anchorLines>", 2)
		if not (node_stencil_pre and node_stencil_mid and node_stencil_post):
			raise ValueError("Node stencil is not properly formatted. Missing <nodename> or <anchorLines> tags.")

	# Iterate through each node in the JSON data
	for index, node in enumerate(NODES_AND_PATHS["nodes"]):
		option_possibilities = options_object_to_array(node["options"] if "options" in node else [])
		for tmp, option_possibility in enumerate(option_possibilities):
			options = [option["name"] for option in option_possibility]
			options_display = [
				option["displayName"] if "displayName" in option else option["name"] for option in option_possibility
			]
			name_options = ", ".join([node["name"], *(options if len(options) > 0 else [])])
			basename = component_name_from_info(index, node["name"], True, options_display)

			addPins = []
			subPins = []
			for option in option_possibility:
				if "addPins" in option:
					addPins.extend(option["addPins"])
				if "subPins" in option:
					subPins.extend(option["subPins"])

			anchorLines = ""
			if "pins" in node and len(node["pins"]) > 0:
				anchors = [anchor for anchor in node["pins"] if anchor not in subPins and anchor != "center"]
				anchors.extend(addPins)
				for anchorIndex, anchor in enumerate(anchors):
					color = index_to_color(anchorIndex)
					color_str = f"rgb,255:red,{color.red};green,{color.green};blue,{color.blue}"
					anchorLines += f"\t\t\\draw[draw={{{color_str}}}] (0,0) -- (N.{anchor});\n"

			file_content = node_stencil_pre + name_options + node_stencil_mid + anchorLines + node_stencil_post

			# Write the content to a .tex file
			with open(os.path.join(output_dir, f"{basename}.tex"), "w") as f:
				f.write(file_content)

	# load path stencil
	with open("stencil_pgf_path.tex", "r") as f:
		path_stencil = f.read()
		path_stencil_pre, path_stencil_mid = path_stencil.split("<pathname>", 2)
		path_stencil_mid, path_stencil_post = path_stencil_mid.split("<anchorLines>", 2)
		if not (path_stencil_pre and path_stencil_mid and path_stencil_post):
			raise ValueError("Path stencil is not properly formatted. Missing <pathname> or <anchorLines> tags.")

	# Iterate through each path in the JSON data
	for index, path in enumerate(NODES_AND_PATHS["path"]):
		option_possibilities = options_object_to_array(path["options"] if "options" in path else [])
		for tmp, option_possibility in enumerate(option_possibilities):
			options = [option["name"] for option in option_possibility]
			options_display = [
				option["displayName"] if "displayName" in option else option["name"] for option in option_possibility
			]
			shapeName = path["shapeName"] if "shapeName" in path else path["drawName"].replace(" ", "") + "shape"
			name_options = ", ".join([shapeName, *(options if len(options) > 0 else [])])
			basename = component_name_from_info(index, path["drawName"], False, options_display)

			addPins = []
			subPins = []
			for option in option_possibility:
				if "addPins" in option:
					addPins.extend(option["addPins"])
				if "subPins" in option:
					subPins.extend(option["subPins"])

			anchorLines = ""
			if "pins" in path and len(path["pins"]) > 0:
				anchors = [anchor for anchor in path["pins"] if anchor not in subPins and anchor != "center"]
				anchors.extend(addPins)
				for anchorIndex, anchor in enumerate(anchors):
					color = index_to_color(anchorIndex)
					color_str = f"rgb,255:red,{color.red};green,{color.green};blue,{color.blue}"
					anchorLines += f"\t\t\\draw[draw={{{color_str}}}] (0,0) -- (P.{anchor});\n"

			if "stroke" in path and path["stroke"]:
				anchorLines += "\t\t\\draw (P.b) -- (P.a);\n"

			file_content = path_stencil_pre + name_options + path_stencil_mid + anchorLines + path_stencil_post

			# Write the content to a .tex file
			with open(os.path.join(output_dir, f"{basename}.tex"), "w") as f:
				f.write(file_content)
