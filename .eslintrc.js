module.exports = {
	env: { es6: true, node: true },
	parser: '@typescript-eslint/parser',
	parserOptions: { tsconfigRootDir: __dirname, project: './tsconfig.eslint.json' },
	plugins: ['@typescript-eslint'],
	ignorePatterns: ['**/out', '**/res', '**/node_modules', '**/work', '**/test-results', '**/playwright-report', '.eslintrc.js'],
	rules: {
		'@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
		'@typescript-eslint/prefer-readonly': 'warn',
		quotes: ['warn', 'single', { avoidEscape: true }],
		'eol-last': 'warn',
		'no-fallthrough': 'warn',
		'prefer-const': 'warn',
		'prefer-object-spread': 'warn',
		'quote-props': ['warn', 'as-needed'],
	},
}
