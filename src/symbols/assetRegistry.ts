/**
 * Symbol asset registry.
 *
 * Uses Vite's import.meta.glob to eagerly resolve all images in src/assets/
 * into browser-ready URLs. Components look up assets by filename using
 * `resolveSymbolAsset(filename)`, which matches the `sample_assets` strings
 * stored in glossary.json.
 */

// Eagerly import every image in src/assets/ as a URL so Vite fingerprints and
// copies them to the build output automatically.
const _rawGlob = import.meta.glob('../assets/**/*.{jpg,jpeg,png,webp,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

// Build a map from plain filename → resolved URL so callers don't need to
// know the full relative path.
const _assetMap: Record<string, string> = {}
for (const [path, url] of Object.entries(_rawGlob)) {
  const filename = path.split('/').pop() ?? path
  if (import.meta.env.DEV && filename in _assetMap) {
    console.warn(
      `[assetRegistry] Duplicate asset filename "${filename}" — the entry from "${path}" overwrites a previous one.`
    )
  }
  _assetMap[filename] = url
}

/**
 * Resolve a filename from a glossary `sample_assets` entry to a browser URL.
 * Returns `undefined` when the asset is not found in the bundle.
 */
export function resolveSymbolAsset(filename: string): string | undefined {
  return _assetMap[filename]
}

export default Object.freeze({ ..._assetMap })
