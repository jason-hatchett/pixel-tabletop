/**
 * Asset store — holds raster bytes outside the domain, keyed by an opaque
 * `assetRef`. `BoardState` carries only the ref (ADR-0008), so this is where the
 * actual image lives for the render layer to load a texture from.
 *
 * `SessionAssetStore` is in-memory (object URLs) and lasts for the tab session.
 * A save/export therefore round-trips the *reference*, not the bytes: on reload
 * or on another device the placement exists but its image is absent until
 * re-imported. Durable asset caching (IndexedDB) and multiplayer asset delivery
 * are deferred (ADR-0007 §7, ADR-0008 open questions).
 */

export interface AssetStore {
  /** Store bytes, return the opaque ref to put in `ImagePlacement.assetRef`. */
  add(blob: Blob): string;
  /** Resolve a ref to a loadable URL, or null if this session lacks the bytes. */
  url(ref: string): string | null;
  has(ref: string): boolean;
  /** Release a ref's bytes (revoke its URL). Called when no placement uses it. */
  remove(ref: string): void;
}

export class SessionAssetStore implements AssetStore {
  private urls = new Map<string, string>();

  add(blob: Blob): string {
    const ref = `img:${crypto.randomUUID()}`;
    this.urls.set(ref, URL.createObjectURL(blob));
    return ref;
  }
  url(ref: string): string | null {
    return this.urls.get(ref) ?? null;
  }
  has(ref: string): boolean {
    return this.urls.has(ref);
  }
  remove(ref: string): void {
    const url = this.urls.get(ref);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(ref);
    }
  }
}
