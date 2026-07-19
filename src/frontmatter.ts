const BLOCK_SCALAR_INDICATOR = /^[>|][+-]?$/;

export function unquoteFrontmatterScalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

export function normalizeFrontmatterScalar(
  lines: string[],
  lineIndex: number,
  rawValue: string,
): { value: string; nextIndex: number } {
  if (!BLOCK_SCALAR_INDICATOR.test(rawValue)) {
    return { value: unquoteFrontmatterScalar(rawValue), nextIndex: lineIndex + 1 };
  }

  const blockLines: string[] = [];
  let nextIndex = lineIndex + 1;

  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    blockLines.push(line);
    nextIndex += 1;
  }

  const contentIndents = blockLines
    .filter((line) => line.trim() !== "")
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const indent = contentIndents.length > 0 ? Math.min(...contentIndents) : 0;
  const value = blockLines
    .map((line) => line.slice(Math.min(indent, line.length)))
    .join("\n")
    .trim()
    .replace(/\s+/g, " ");

  return { value, nextIndex };
}
