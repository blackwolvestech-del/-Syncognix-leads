/*
 * A small, forgiving HTML tokenizer. It never throws on malformed markup and
 * builds no DOM: the analyzer only needs tags, attributes and text in order.
 */

export type HtmlToken =
  | { type: "open"; tag: string; attrs: Record<string, string> }
  | { type: "close"; tag: string }
  | { type: "text"; text: string }
  /** Unparsed content of <script>/<style>, with the attributes of its tag. */
  | { type: "raw"; tag: "script" | "style"; attrs: Record<string, string>; text: string }

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®",
  trade: "™", bull: "•", middot: "·", raquo: "»", laquo: "«",
}

export function decodeEntities(text: string) {
  if (!text.includes("&")) return text
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? match
    const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  })
}

const ATTRIBUTE = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y
const TAG_NAME = /[a-zA-Z][a-zA-Z0-9:-]*/y

function parseAttributes(html: string, from: number) {
  const attrs: Record<string, string> = {}
  let index = from
  for (;;) {
    ATTRIBUTE.lastIndex = index
    const match = ATTRIBUTE.exec(html)
    if (!match) break
    index = ATTRIBUTE.lastIndex
    const name = match[1].toLowerCase()
    // First occurrence wins, as in browsers.
    if (!(name in attrs)) attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")
  }
  return { attrs, index }
}

export function tokenize(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = []
  const length = html.length
  let index = 0

  const pushText = (text: string) => {
    if (text.trim()) tokens.push({ type: "text", text: decodeEntities(text) })
  }

  while (index < length) {
    const open = html.indexOf("<", index)
    if (open === -1) {
      pushText(html.slice(index))
      break
    }
    if (open > index) pushText(html.slice(index, open))

    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4)
      index = end === -1 ? length : end + 3
      continue
    }

    const next = html[open + 1]
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", open)
      index = end === -1 ? length : end + 1
      continue
    }

    if (next === "/") {
      TAG_NAME.lastIndex = open + 2
      const name = TAG_NAME.exec(html)
      const end = html.indexOf(">", open)
      if (name) tokens.push({ type: "close", tag: name[0].toLowerCase() })
      index = end === -1 ? length : end + 1
      continue
    }

    TAG_NAME.lastIndex = open + 1
    const name = TAG_NAME.exec(html)
    if (!name) {
      // A stray "<" in text.
      pushText("<")
      index = open + 1
      continue
    }

    const tag = name[0].toLowerCase()
    const parsed = parseAttributes(html, TAG_NAME.lastIndex)
    const end = html.indexOf(">", parsed.index)
    index = end === -1 ? length : end + 1

    if (tag === "script" || tag === "style") {
      const closing = new RegExp(`</${tag}\\s*>`, "gi")
      closing.lastIndex = index
      const close = closing.exec(html)
      const text = html.slice(index, close ? close.index : length)
      tokens.push({ type: "raw", tag, attrs: parsed.attrs, text })
      index = close ? closing.lastIndex : length
      continue
    }

    tokens.push({ type: "open", tag, attrs: parsed.attrs })
  }

  return tokens
}
