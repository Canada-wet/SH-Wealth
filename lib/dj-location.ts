// File addresses are metadata only: never fetch, stat or open them in the browser.
export function normalizeFileLocation(input: string): string {
  let value = input.trim();
  if (!value || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value))
    throw new Error(
      "请填写完整的本地音乐文件路径（Mac、Windows 或 file://），不能是网络链接。",
    );
  if (/^[a-z]:[\\/]/i.test(value)) value = "/" + value.replaceAll("\\", "/");
  if (value.startsWith("/"))
    value =
      "file://localhost" +
      value
        .split("/")
        .map((p, i) =>
          i === 1 && /^[a-z]:$/i.test(p) ? p : encodeURIComponent(p),
        )
        .join("/");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("音乐路径必须是绝对路径，不能只填写文件名。");
  }
  if (
    url.protocol !== "file:" ||
    (url.hostname && url.hostname !== "localhost") ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    /%(?:2f|5c|00)/i.test(url.pathname)
  )
    throw new Error(
      "仅支持本机 file://localhost/ 路径；远程共享、网址、查询参数或片段不支持。",
    );
  let parts: string[];
  try {
    parts = url.pathname.split("/").map(decodeURIComponent);
  } catch {
    throw new Error("音乐路径中的 URI 编码无效。");
  }
  if (
    parts.length < 2 ||
    !parts.at(-1) ||
    parts.some((p) => /[\x00-\x1f\x7f\\]/.test(p))
  )
    throw new Error("路径必须包含音乐文件名。");
  const result =
    "file://localhost" +
    parts
      .map((p, i) =>
        i === 1 && /^[a-z]:$/i.test(p)
          ? p.toUpperCase()
          : encodeURIComponent(p),
      )
      .join("/");
  if (result.length > 2048) throw new Error("编码后的音乐路径超过 2048 字符。");
  return result;
}
export function validFileLocation(value: unknown): value is string {
  try {
    return typeof value === "string" && normalizeFileLocation(value) === value;
  } catch {
    return false;
  }
}
