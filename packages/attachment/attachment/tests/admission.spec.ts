import { describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment/types'

const PNG = 'AAAA' // canonical base64, 3 bytes

/**
 * Delegation double: records the exact saveImages batch and answers ordered
 * refs. The byte caps sit exactly on the tiny fixture payload (3 decoded
 * bytes, 4 encoded chars) so boundary behavior is pinned, not incidental.
 */
function storeOf(limits?: Partial<ImageAttachmentLimits>) {
  const store = {
    imageLimits: {
      maxImageBytes: 3,
      maxImagesPerMessage: 10,
      maxMessageImageBytes: 6,
      maxImagePixels: 100,
      maxImageDimension: 10,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp'],
      ...limits,
    },
    saveImages: vi.fn((inputs: readonly SaveImageAttachment[]) => Promise.resolve(inputs.map((input, index): ImageAttachmentRef => ({
      attachmentId: `att-${index + 1}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    })))),
  }
  return { store: store as unknown as AttachmentStore, mocks: store }
}

describe('admitEncodedImages', () => {
  it('decodes every member and delegates one ordered batch to saveImages', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [
      { mediaType: 'image/png', data: PNG, name: 'first.png' },
      { mediaType: 'image/jpeg', data: PNG, name: 'second.jpg' },
    ])
    expect(mocks.saveImages).toHaveBeenCalledTimes(1)
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect(batch.map(input => [input.name, input.mediaType, input.data.byteLength]))
      .toEqual([['first.png', 'image/png', 3], ['second.jpg', 'image/jpeg', 3]])
    expect(refs.map(ref => ref.attachmentId)).toEqual(['att-1', 'att-2'])
  })

  it('omits the name from store inputs when the upload has none', async () => {
    const { store, mocks } = storeOf()
    const refs = await admitEncodedImages(store, [{ mediaType: 'image/webp', data: PNG }])
    const batch = mocks.saveImages.mock.calls[0]?.[0] as readonly SaveImageAttachment[]
    expect('name' in (batch[0] as object)).toBe(false)
    expect(refs[0]?.name).toBeUndefined()
  })

  it('delegates an empty batch unchanged', async () => {
    const { store, mocks } = storeOf()
    await expect(admitEncodedImages(store, [])).resolves.toEqual([])
    expect(mocks.saveImages).toHaveBeenCalledWith([])
  })

  it('rejects non-canonical and empty base64 payloads before any store call', async () => {
    const { store, mocks } = storeOf()
    for (const data of ['', 'AAA', '!!!!']) {
      await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data }]))
        .rejects.toMatchObject({ name: 'AttachmentError', code: 'INVALID_IMAGE_BASE64' })
    }
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it('rejects an over-cap encoded image before decoding (no store call)', async () => {
    const { store, mocks } = storeOf()
    // 8 encoded chars decode to 6 bytes past the 3-byte per-image cap.
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: 'AAAAAAAA' }]))
      .rejects.toMatchObject({ name: 'AttachmentError', code: 'IMAGE_TOO_LARGE' })
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it('rejects an over-cap encoded batch before decoding (no store call)', async () => {
    // Loose per-image cap with a tight aggregate: each member fits alone at
    // the 16-char per-image bound, but the 32-char total exceeds the
    // aggregate bound (8 chars plus one padding quantum per member).
    const { store, mocks } = storeOf({ maxImageBytes: 12 })
    const batch: { mediaType: 'image/png'; data: string }[] = [
      { mediaType: 'image/png', data: 'AAAAAAAAAAAAAAAA' },
      { mediaType: 'image/png', data: 'AAAAAAAAAAAAAAAA' },
    ]
    await expect(admitEncodedImages(store, batch))
      .rejects.toMatchObject({ name: 'AttachmentError', code: 'IMAGES_TOO_LARGE' })
    expect(mocks.saveImages).not.toHaveBeenCalled()
  })

  it('admits separately padded members a naive summed bound would refuse', async () => {
    const { store, mocks } = storeOf()
    // 12 chars total past the 8-char single-string bound, but three separate
    // paddings decode to 3 bytes inside the 6-byte aggregate cap — the batch
    // reaches the store, where count and byte limits stay authoritative.
    const batch: { mediaType: 'image/png'; data: string }[] = [
      { mediaType: 'image/png', data: 'AQ==' },
      { mediaType: 'image/png', data: 'AQ==' },
      { mediaType: 'image/png', data: 'AQ==' },
    ]
    await expect(admitEncodedImages(store, batch)).resolves.toHaveLength(3)
    expect(mocks.saveImages).toHaveBeenCalledTimes(1)
  })

  it('propagates the store batch rejection unchanged', async () => {
    const { store, mocks } = storeOf()
    const refused = Object.assign(new Error('Image batch exceeds the configured image-count limit.'), { code: 'TOO_MANY_IMAGES' })
    mocks.saveImages.mockRejectedValueOnce(refused)
    await expect(admitEncodedImages(store, [{ mediaType: 'image/png', data: PNG }])).rejects.toBe(refused)
  })
})
