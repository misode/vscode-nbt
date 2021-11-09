import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { defineConfig } from 'rollup'

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
		external: ['vscode'],
		plugins: [
			resolve(),
			commonjs(),
			typescript(),
		],
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
	},
])
