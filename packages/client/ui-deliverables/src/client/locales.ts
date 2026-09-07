/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'produced.label': '写入的文件',
  'delivered.label': '交付文件',
  'delivered.open': '打开',
  'delivered.preview': '预览',
  'delivered.download': '下载',
  'preview.loading': '正在生成预览…',
  'preview.unsupported': '该文件类型暂不支持预览，请下载或打开。',
  'preview.close': '关闭预览',
  'preview.sofficeMissing': '未检测到 LibreOffice，当前显示文本提取版。安装 LibreOffice 后可获得像素级还原的预览。',
  'produced.moreOne': '+ 1 个文件',
  'produced.more': '+ {count} 个文件',
  'produced.open': '打开 {name}',
  'produced.showInFolder': '在文件夹中显示',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Files written',
  'delivered.label': 'Deliverables',
  'delivered.open': 'Open',
  'delivered.preview': 'Preview',
  'delivered.download': 'Download',
  'preview.loading': 'Building preview…',
  'preview.unsupported': 'This file type has no preview yet — download or open it instead.',
  'preview.close': 'Close preview',
  'preview.sofficeMissing': 'LibreOffice not found — showing a text extraction. Install LibreOffice for the pixel-true preview.',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof zh
