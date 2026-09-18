/**
 * The lead box's slide order (v2.62) now lives in the domain package, where
 * the phone's asset screen reads the same rule. This module keeps the web's
 * import path: everything below is the domain's export, byte for byte.
 */
export {
  assetSlides,
  slideCountLabel,
  type AssetSlide,
  type SlideCustodyGroup,
  type SlidePhoto,
} from '@techpioasset/domain';
