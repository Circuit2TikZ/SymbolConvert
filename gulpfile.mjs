const { task, src, dest, series, parallel } = (await import("gulp")).default;
import { compileTexToDVIVinyl } from "./lib/compileTex.mjs";
import { combineSymbols, convertDVItoSVGsymbol } from "./lib/convertDviToSymbol.mjs";
import { createNodeTexFiles, createPathTexFiles } from "./lib/createTexFilesTasks.mjs";
import { filterNewer } from "./lib/vinylTools.mjs";
var concat = (await import("gulp-concat")).default;

task("createNodeTexFiles", createNodeTexFiles);

task("createPathTexFiles", createPathTexFiles);

task("createTexFiles", parallel("createNodeTexFiles", "createPathTexFiles"));

task("buildDVI", function () {
	return src("build/*.tex", {
		read: false,
		// @ts-ignore .d.ts is incomplete; gulp does accept `stat`
		stat: true,
	})
		.pipe(filterNewer(".dvi"))
		.pipe(compileTexToDVIVinyl());
});

task("buildSVG", function () {
	return src("build/*.dvi", {
		read: false,
		// @ts-ignore .d.ts is incomplete; gulp does accept `stat`
		stat: true,
	})
		.pipe(filterNewer(".svg"))
		.pipe(convertDVItoSVGsymbol())
		.pipe(dest("build/"));
});

task("buildSymbol", function () {
	return src("build/*.svg", {

	})
	.pipe(concat("symbols.svg",{newLine:''}))
	.pipe(combineSymbols())
	.pipe(dest("./"))
	;
});

task("default", series("buildDVI", "buildSVG", "buildSymbol"));
