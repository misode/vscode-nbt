import envPaths from 'env-paths'
import { Downloader } from './Downloader'

const cacheRoot = envPaths('nbt-viewer').cache
const downloader = new Downloader(cacheRoot, console)


export function getAssets(version: string) {
	
}
