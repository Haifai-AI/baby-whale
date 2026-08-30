// Baby Whale brand mark: the watercolor whale artwork served from the web
// root (`/baby-whale.png`, real alpha). Square at any size; alt text stays
// empty — the mark is decorative and pairs with the wordmark.

import type { IconProps } from './icons/props.ts'

/**
 * Render the Baby Whale mark.
 * @param props.size - width in px (default 24; height matches — the artwork is near-square).
 * @param props.className - extra class for layout placement.
 * @returns the brand mark image (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/baby-whale.png"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain', display: 'block' }}
      alt=""
      draggable={false}
    />
  )
}
