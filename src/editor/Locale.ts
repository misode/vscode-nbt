const LOCALES = {
	copy: 'Copy',
	name: 'Name',
	value: 'Value',
	confirm: 'Confirm',
	addTag: 'Add Tag',
	editTag: 'Edit',
	removeTag: 'Remove',
	renameTag: 'Rename',
	grid: 'Show Grid',
	invisibleBlocks: 'Show Invisible Blocks',
	'panel.structure': '3D',
	'panel.map': 'Map',
	'panel.region': 'Region',
	'panel.default': 'Default',
	'panel.snbt': 'SNBT',
}

export function locale(key: string) {
	return LOCALES[key] ?? key
}
