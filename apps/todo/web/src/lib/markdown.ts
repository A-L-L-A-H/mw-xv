// Markdown rendering utilities ported from app.js

// Inline markdown: **bold**, *italic*, `code`, [text](url)
export function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// Emphasis: _text_ -> <em>text</em>
export function emphasis(text: string): string {
  return text.replace(/_([^_]+)_/g, "<em>$1</em>");
}

// Table cells: | a | b | -> <td>a</td><td>b</td>
export function tableCells(text: string): string {
  return text
    .split("|")
    .slice(1, -1)
    .map((c) => `<td>${inline(c.trim())}</td>`)
    .join("");
}

// Full markdown renderer
export function markdown(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode) {
        inCode = true;
        codeLang = line.slice(3).trim();
        codeBuffer = [];
      } else {
        inCode = false;
        const code = codeBuffer.join("\n");
        out.push(
          `<pre><code class="language-${codeLang}">${escapeHtml(code)}</code></pre>`
        );
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }

    // Horizontal rule
    if (line.trim() === "---") {
      out.push("<hr>");
      continue;
    }

    // Unordered list
    const ul = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ul) {
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    // Ordered list
    const ol = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (ol) {
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    // Blockquote
    const bq = line.match(/^>\s*(.+)$/);
    if (bq) {
      out.push(`<blockquote>${inline(bq[1])}</blockquote>`);
      continue;
    }

    // Table row
    if (line.includes("|") && line.trim().startsWith("|")) {
      out.push(`<tr>${tableCells(line)}</tr>`);
      continue;
    }

    // Paragraph
    if (line.trim()) {
      out.push(`<p>${inline(line)}</p>`);
    }
  }

  return out.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, '&#039;');
}

// Plain text extraction (for search snippets)
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^>\s*/gm, "")
    .replace(/^[\s]*[-*]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .trim();
}
