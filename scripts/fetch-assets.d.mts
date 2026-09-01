export interface AssetSource {
  url: string
  sha256: string
}

export declare const KAYKIT_REVISIONS: Record<string, string>
export declare const ASSET_SHA256: Record<string, string>
export declare const ASSETS: Record<string, AssetSource>
export declare function validateAssetMetadata(name: string, source: AssetSource): void
export declare function verifyAssetBody(name: string, body: Buffer, expectedSha256: string): void
