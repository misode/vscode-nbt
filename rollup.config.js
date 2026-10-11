import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { defineConfig } from 'rollup'
import { builtinModules } from 'module'
import { promises as fs } from 'fs'
import path from 'path'

export default defineConfig([
	{
		input: 'src/extension.ts',
		output: [
			{
				file: 'out/extension.js',
				format: 'cjs',
				sourcemap: true,
			},
		],
		external: id => id === 'vscode' || id.startsWith('node:') || builtinModules.includes(id),
		plugins: [
			resolve(),
			commonjs(),
			typescript(),
			packagedResources(),
		],
		onwarn,
	},
	{
		input: 'src/editor/Editor.ts',
		output: [
			{
				file: 'out/editor.js',
				format: 'iife',
				name: 'nbtEditor',
				sourcemap: true,
			},
		],
		plugins: [
			resolve(),
			commonjs(),
			typescript(),
		],
		onwarn,
	},
])

function onwarn(warning) {
	if (warning.code === 'CIRCULAR_DEPENDENCY') {
		return
	}
	console.warn(`(!) ${warning.message}`)
}

function packagedResources() {
	return {
		name: 'packaged-resources',
		async writeBundle() {
			const output = 'res/generated/codicons'
			await fs.mkdir(output, { recursive: true })
			await Promise.all([
				fs.copyFile('node_modules/vscode-codicons/dist/codicon.css', path.join(output, 'codicon.css')),
				fs.copyFile('node_modules/vscode-codicons/dist/codicon.ttf', path.join(output, 'codicon.ttf')),
				fs.copyFile('node_modules/vscode-codicons/LICENSE-CODE', path.join(output, 'License.txt')),
				fs.copyFile('node_modules/vscode-codicons/LICENSE', path.join(output, 'LICENSE-FONT.txt')),
			])
			const packages = ['deepslate', 'env-paths', 'follow-redirects', 'gl-matrix', 'tar', 'yauzl', 'pend', 'pako', 'md5', 'crypt', 'charenc', 'is-buffer', 'chownr', 'minipass', 'minizlib', 'yallist']
			const notices = []
			for (const name of packages) {
				const directory = path.join('node_modules', name)
				const file = (await fs.readdir(directory)).find(file => /^licen[sc]e(?:\..*)?$/i.test(file))
				if (file) notices.push(`## ${name}\n\n${await fs.readFile(path.join(directory, file), 'utf8')}`)
			}
			await fs.writeFile('res/generated/THIRD_PARTY_NOTICES.md', notices.join('\n\n'))
		},
	}
}
