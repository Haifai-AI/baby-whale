/**
 * Locale dictionaries for the Skills settings section (zh source, en mirror).
 * @module @deepseek-ai/dsh-client-ui-settings-skills/src/client/locales
 */

/** Chinese dictionary. */
export const zh = {
  nav: '技能',
  'col.name': '名称',
  'col.desc': '描述',
  'col.state': '状态',
  'state.on': '启用',
  'state.off': '已禁用',
  'tag.modelOnly': '模型',
  'tag.userOnly': '手动',
  'scope.unavailable': '打开一个工作区会话后即可管理技能。',
  'scope.none': '尚未发现任何技能。把技能文件夹放进 ~/.dsh/skills、项目的 .dsh/skills，或随应用内置（启动后自动出现）。',
  'scope.loading': '正在读取技能目录…',
  'save.failed': '保存失败，请重试',
  'hint.disable': '关闭后，模型目录与 /调用 都不再提供该技能；重新开启立即恢复。',
} as const

/** English dictionary. */
export const en = {
  nav: 'Skills',
  'col.name': 'Name',
  'col.desc': 'Description',
  'col.state': 'State',
  'state.on': 'Enabled',
  'state.off': 'Disabled',
  'tag.modelOnly': 'model',
  'tag.userOnly': 'manual',
  'scope.unavailable': 'Open a workspace session to manage skills.',
  'scope.none': 'No skills discovered yet. Drop skill folders into ~/.dsh/skills, your project\'s .dsh/skills, or ship them with the app (they appear automatically at launch).',
  'scope.loading': 'Loading skill catalog…',
  'save.failed': 'Saving failed; try again',
  'hint.disable': 'Disabled skills leave the model catalog and stop responding to /name; re-enabling restores both instantly.',
}

/** The zh dictionary type drives the en mirror's exhaustiveness. */
export type SkillsSettingsLocaleKey = keyof typeof zh
