// @ts-check
/**
 * Contains a function for easier handling of executing external programs.
 * @module simpleExec
 */

import { spawn } from "node:child_process"

/**
 * Execute a program and wait for finishing.
 *
 * @param {string} prog - the program/command
 * @param {string[]} args - a list of arguments
 * @param {string} [cwd] - the current working directory
 * @param {boolean} [storeStdout=false] - set to true, if you want to capture stdout
 * @returns {Promise<Buffer>} the promise resolving if the return value is zero
 */
export default function simpleExec(prog, args, cwd, storeStdout = false) {
	/** @type {import("node:child_process").ChildProcess} */
	let childProcess = spawn(prog, args, {
		cwd: cwd || process.cwd(),
		shell: false,
		stdio: storeStdout ? ["ignore", "pipe", "ignore"] : "ignore",
		timeout: 10000, // 10s
		windowsHide: true,
	})

	/**
	 * Chunks of stdout
	 * @type {Buffer[]}
	 */
	let chunks = []

	return new Promise((resolve, reject) => {
		childProcess.on("close", (code) => {
			if (code === 0) resolve(Buffer.concat(chunks))
			else reject(new Error("Return value not zero: " + prog + " returned " + code))
		})
		// @ts-ignore childProcess.stdout is not null, if storeStdout is true
		if (storeStdout) childProcess.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
		childProcess.on("error", (error) => reject(error))
	})
}
