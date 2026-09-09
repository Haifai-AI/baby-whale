/** Wire-form admission of base64-encoded image uploads. @module @deepseek-ai/dsh-attachment/admission */

import { Buffer } from 'node:buffer'
import { AttachmentError } from './error.ts'
import type { AttachmentStore } from './index.ts'
import type {
  EncodedImageAttachment,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
} from './types.ts'

/** Decode one upload payload while rejecting non-canonical base64 forms. */
function decodeBase64(data: string): Uint8Array {
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    throw new AttachmentError('Image upload is not canonical base64.', 'INVALID_IMAGE_BASE64')
  }
  return new Uint8Array(decoded)
}

/** Store input for one decoded upload. */
function saveInput(image: EncodedImageAttachment): SaveImageAttachment {
  return {
    data: decodeBase64(image.data),
    mediaType: image.mediaType,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

/**
 * Longest canonical base64 text encoding `byteLength` bytes (4 chars per 3
 * bytes, rounded up). A longer text necessarily decodes past the cap, so it
 * is refused before decoding allocates.
 * @param byteLength - the decoded-byte cap.
 * @returns the longest encodable text length.
 */
function maxEncodedLength(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3)
}

/**
 * Aggregate text bound with one quantum of padding per member: every
 * member's encoding carries its own `=` padding (up to 4 chars), so the
 * summed text of a fittable batch can exceed the single-string bound by one
 * quantum per member — three separately padded 4-char images are 12 chars
 * for 3 bytes. Past this total no valid batch fits the cap (each member's
 * canonical length bounds its bytes, summed with room to spare), so the
 * batch is refused before decoding allocates.
 * @param byteLength - the decoded-byte aggregate cap.
 * @param members - the batch member count.
 * @returns the longest admittable summed text length.
 */
function maxTotalEncodedLength(byteLength: number, members: number): number {
  return 4 * Math.ceil(byteLength / 3) + 4 * members
}

/**
 * Refuse wire payloads that cannot fit the deployment byte caps while they
 * are still text. Decoding first would transiently hold the encoded text,
 * the decoded bytes, and the re-encoded canonical-comparison copy — roughly
 * twice the cap per image — before the post-decode limits could refuse them.
 * Size is checked before shape, so an over-long non-base64 payload reports
 * the size refusal rather than the shape refusal; both stay
 * caller-correctable admission errors under the same codes the post-decode
 * path raises.
 * @param images - base64-encoded uploads in caller order.
 * @param limits - the deployment byte caps.
 */
function checkEncodedSize(images: readonly EncodedImageAttachment[], limits: ImageAttachmentLimits): void {
  let totalEncoded = 0
  for (const image of images) {
    if (image.data.length > maxEncodedLength(limits.maxImageBytes)) {
      throw new AttachmentError(
        `Image upload exceeds the configured per-image byte limit (${String(limits.maxImageBytes)} bytes).`,
        'IMAGE_TOO_LARGE',
      )
    }
    totalEncoded += image.data.length
  }
  if (totalEncoded > maxTotalEncodedLength(limits.maxMessageImageBytes, images.length)) {
    throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
  }
}

/**
 * Admit one wire image batch: refuse over-cap encoded text first (no decode
 * allocation), then enforce canonical base64 on every member, then delegate
 * batch admission — count and aggregate-byte limits, media-type and
 * per-image validation, ordered commit — to {@link AttachmentStore.saveImages},
 * which remains authoritative for the decoded bytes.
 * The shared entry for every RPC endpoint accepting browser uploads.
 * @param attachments - the deployment attachment store owning batch policy.
 * @param images - base64-encoded uploads in caller order.
 * @returns durable references in the same order as `images`.
 * @throws AttachmentError on an over-cap or non-canonical payload, or a refused batch.
 */
export async function admitEncodedImages(
  attachments: AttachmentStore,
  images: readonly EncodedImageAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  checkEncodedSize(images, attachments.imageLimits)
  return attachments.saveImages(images.map(saveInput))
}
