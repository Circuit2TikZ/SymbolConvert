// @ts-check
/**
 * Tools for easier handling of `Vinyl`s (Gulps file representation).
 * @module vinylTools
 */

import Vinyl from "vinyl";
import { Transform } from "node:stream";
import { stat } from "node:fs/promises";

/**
 * Ensure the `Vinyl`/file has stats. If an error occurs, e.g. the file doesn't exist, `stat` is set to `null`.
 *
 * @param {Vinyl} file - the file to get the stat(s) for
 * @returns {Promise<Vinyl>} - the "updated" file
 */
export async function ensureVinylHasStats(file) {
	if (!file.stat) file.stat = await stat(file.path).catch(() => null);
	return file;
}

/**
 * Wrap a (asynchronous) function in a parallel `Transform` to simplify processing with gulp.
 *
 * @param {(Vinyl) => Promise<Vinyl|null|void>|Vinyl|null|void} targetFunction - the processing function
 * @param {boolean} [write=false] - set to true, if the `targetFunction` should be able to push data
 * @param {number} [maxThreads=4] - the maximum count of async function calls
 * @returns {Transform} the gulp compatible `Transform`
 */
export function vinylMap(targetFunction, write = false, maxThreads = 4) {
	/** @type {Promise[]} */
	let pendingPromises = [];
	return new Transform({
		readableObjectMode: true,
		writableObjectMode: true,
		objectMode: true,
		writableHighWaterMark: 5 * maxThreads,
		flush(callback) {
			if (pendingPromises.length === 0) callback();
			else Promise.allSettled(pendingPromises).then(() => callback());
		},
		transform(/** @type {Vinyl} */ chunk, _encoding, callback) {
			const result = targetFunction(chunk) || null;

			if (result instanceof Promise) {
				/** @type {Promise<*>} */
				const promise = (write ? result.then((value) => value && this.push(value)) : result).catch(() => {});
				pendingPromises.push(promise);
				promise.finally(() => pendingPromises.splice(pendingPromises.indexOf(promise), 1)); // remove self

				if (pendingPromises.length >= maxThreads) Promise.race(pendingPromises).finally(() => callback());
				else callback();
			} else callback(null, (write && result) || undefined);
		},
	});
}

/**
 * Filter files that are newer than their targets.
 *
 * @param {string} targetFileExtension - the new (target) extension including the dot
 * @returns {Transform}
 */
export function filterNewer(targetFileExtension) {
	return vinylMap(async function (/** @type {Vinyl} */ srcFile) {
		let targetFile = srcFile.clone({ contents: false, deep: false });
		targetFile.extname = targetFileExtension;
		targetFile.stat = null;

		await Promise.allSettled([ensureVinylHasStats(srcFile), ensureVinylHasStats(targetFile)]);

		// @ts-ignore Vinyls can have stats
		if (srcFile.stat?.isFile() && (!targetFile.stat?.isFile() || targetFile.stat.mtime < srcFile.stat.mtime))
			return srcFile;
	}, true);
}
