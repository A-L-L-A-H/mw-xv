const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITY_MAP[body.toLowerCase()] ?? match;
  });
}

const TAG_RE = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:_-]*)((?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/?)\s*>/;
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

type XmlNode =
  | { _text: string }
  | ({ _name: string } & Record<string, unknown>);

interface StackEntry {
  name: string;
  node: Record<string, unknown>;
}

function pushChild(parent: Record<string, unknown>, name: string, value: unknown): void {
  const existing = parent[name];
  if (existing === undefined) {
    parent[name] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    parent[name] = [existing, value];
  }
}

export const XMLParser = {
  parse(xml: string): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    const stack: StackEntry[] = [];
    let cursor = 0;

    const appendText = (raw: string): void => {
      const decoded = decodeEntities(raw);
      if (decoded.trim().length === 0) return;
      const top = stack[stack.length - 1];
      if (!top) return;
      const existing = top.node._text;
      pushChild(top.node, '_text', existing === undefined ? decoded : `${existing}${decoded}`);
    };

    while (cursor < xml.length) {
      const nextTag = xml.indexOf('<', cursor);
      if (nextTag < 0) {
        appendText(xml.slice(cursor));
        break;
      }
      if (nextTag > cursor) appendText(xml.slice(cursor, nextTag));

      if (xml.startsWith('<!--', nextTag)) {
        const end = xml.indexOf('-->', nextTag + 4);
        cursor = end < 0 ? xml.length : end + 3;
        continue;
      }
      if (xml.startsWith('<![CDATA[', nextTag)) {
        const end = xml.indexOf(']]>', nextTag + 9);
        const cdata = xml.slice(nextTag + 9, end < 0 ? xml.length : end);
        const top = stack[stack.length - 1];
        if (top) pushChild(top.node, '_text', cdata);
        cursor = end < 0 ? xml.length : end + 3;
        continue;
      }
      if (xml.startsWith('<?', nextTag)) {
        const end = xml.indexOf('?>', nextTag + 2);
        cursor = end < 0 ? xml.length : end + 2;
        continue;
      }
      if (xml.startsWith('<!', nextTag)) {
        const end = xml.indexOf('>', nextTag + 2);
        cursor = end < 0 ? xml.length : end + 1;
        continue;
      }

      const match = TAG_RE.exec(xml.slice(nextTag));
      if (!match) {
        appendText(xml.slice(nextTag, nextTag + 1));
        cursor = nextTag + 1;
        continue;
      }

      const [full, closing, rawName, rawAttrs, selfClosing] = match;
      const name = rawName.replace(/^[a-zA-Z]+:/, '');
      cursor = nextTag + full.length;

      if (closing) {
        const topIndex = stack.findLastIndex((entry) => entry.name === name);
        if (topIndex >= 0) {
          const [closed] = stack.splice(topIndex);
          if (stack.length === 0) {
            pushChild(root, name, closed.node);
          } else {
            pushChild(stack[stack.length - 1].node, name, closed.node);
          }
        }
        continue;
      }

      const attrs: Record<string, unknown> = {};
      let attrMatch: RegExpExecArray | null;
      ATTR_RE.lastIndex = 0;
      while ((attrMatch = ATTR_RE.exec(rawAttrs ?? '')) !== null) {
        attrs[attrMatch[1]] = decodeEntities(attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '');
      }

      if (selfClosing) {
        const node: XmlNode = { _name: name, ...attrs };
        const parent = stack[stack.length - 1];
        if (!parent) pushChild(root, name, node);
        else pushChild(parent.node, name, node);
        continue;
      }

      stack.push({ name, node: { ...attrs } });
    }

    return root;
  },
};
