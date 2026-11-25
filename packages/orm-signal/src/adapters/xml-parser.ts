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

const WHITESPACE_RE = /\s/;

interface ParsedTag {
  readonly closing: boolean;
  readonly name: string;
  readonly attrs: Array<readonly [string, string]>;
  readonly selfClosing: boolean;
  readonly end: number;
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && WHITESPACE_RE.test(char);
}

function skipWhitespace(xml: string, index: number): number {
  while (isWhitespace(xml[index])) index += 1;
  return index;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameStart(code: number, attribute: boolean): boolean {
  return isAsciiLetter(code) || (attribute && (code === 95 || code === 58));
}

function isNameChar(code: number, attribute: boolean): boolean {
  return (
    isAsciiLetter(code) ||
    (code >= 48 && code <= 57) ||
    code === 58 ||
    code === 95 ||
    code === 45 ||
    (attribute && code === 46)
  );
}

function readName(
  xml: string,
  index: number,
  attribute: boolean
): { name: string; end: number } | undefined {
  if (!isNameStart(xml.charCodeAt(index), attribute)) return undefined;
  let cursor = index + 1;
  while (isNameChar(xml.charCodeAt(cursor), attribute)) cursor += 1;
  return { name: xml.slice(index, cursor), end: cursor };
}

function parseTag(xml: string, start: number): ParsedTag | undefined {
  let cursor = skipWhitespace(xml, start + 1);
  let closing = false;
  if (xml[cursor] === '/') {
    closing = true;
    cursor = skipWhitespace(xml, cursor + 1);
  }

  const rawName = readName(xml, cursor, false);
  if (!rawName) return undefined;
  cursor = rawName.end;
  const attrs: Array<readonly [string, string]> = [];

  while (true) {
    const beforeWhitespace = cursor;
    cursor = skipWhitespace(xml, cursor);

    if (xml[cursor] === '>') {
      return { closing, name: rawName.name, attrs, selfClosing: false, end: cursor + 1 };
    }
    if (xml[cursor] === '/') {
      cursor = skipWhitespace(xml, cursor + 1);
      if (xml[cursor] !== '>') return undefined;
      return { closing, name: rawName.name, attrs, selfClosing: true, end: cursor + 1 };
    }
    if (cursor === beforeWhitespace) return undefined;

    const attrName = readName(xml, cursor, true);
    if (!attrName) return undefined;
    cursor = skipWhitespace(xml, attrName.end);
    if (xml[cursor] !== '=') return undefined;
    cursor = skipWhitespace(xml, cursor + 1);

    const quote = xml[cursor];
    let value: string;
    if (quote === '"' || quote === "'") {
      const valueStart = cursor + 1;
      cursor = valueStart;
      while (cursor < xml.length && xml[cursor] !== quote) cursor += 1;
      if (cursor >= xml.length) return undefined;
      value = xml.slice(valueStart, cursor);
      cursor += 1;
    } else {
      const valueStart = cursor;
      while (cursor < xml.length && !isWhitespace(xml[cursor]) && xml[cursor] !== '>') cursor += 1;
      if (cursor === valueStart) return undefined;
      value = xml.slice(valueStart, cursor);
    }
    attrs.push([attrName.name, value]);
  }
}

type XmlNode = { _text: string } | ({ _name: string } & Record<string, unknown>);

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

      const tag = parseTag(xml, nextTag);
      if (!tag) {
        appendText(xml.slice(nextTag, nextTag + 1));
        cursor = nextTag + 1;
        continue;
      }

      const name = tag.name.replace(/^[a-zA-Z]+:/, '');
      cursor = tag.end;

      if (tag.closing) {
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
      for (const [attrName, value] of tag.attrs) {
        attrs[attrName] = decodeEntities(value);
      }

      if (tag.selfClosing) {
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
