/**
 * 剧场正文的排版工具：把模型输出的纯文本切成自然段。
 * 只负责分段与去掉模型自带的段首缩进，不改写正文；界面统一给首行缩进 2em。
 */

/** 段首缩进由界面给两个汉字宽，模型自带的空格要先剥掉，免得多缩一遍。 */
const LEADING_INDENT = /^[ \t\u3000]+/
/** 段与段之间是一个空行；空行里夹着空格或全角空格也算。 */
const BLANK_LINE = /\n[ \t\u3000]*\n+/

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(BLANK_LINE)
    .map((paragraph) => paragraph.replace(LEADING_INDENT, '').trimEnd())
    .filter((paragraph) => paragraph.length > 0)
}
