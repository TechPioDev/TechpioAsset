/**
 * The asset page's pure helpers (v2.61) now live in the domain package, where
 * the phone's asset screen reads the same rules (v2.62). This module keeps the
 * web's import path: everything below is the domain's export, byte for byte.
 */
export {
  assetDetailNav,
  conditionSentence,
  deviceHealthTiles,
  formatUptime,
  headerMeta,
  illustrationIcon,
  latestAgentReport,
  noteSummary,
  quickSpecs,
  resolveAssetImageSource,
  type AssetDetailNavKey,
  type AssetImageSource,
  type AssetNavItem,
  type HealthTile,
  type IllustrationIcon,
} from '@techpioasset/domain';
