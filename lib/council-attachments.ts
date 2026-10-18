import type { CouncilModel } from "./council";

export type CouncilAttachment = {
  id: string;
  name: string;
  kind: "image" | "text";
  mime: string;
  content: string;
  note: string;
};
export const ATTACHMENT_LIMITS = {
  files: 5,
  images: 2,
  imageBytes: 150000,
  textChars: 30000,
  serializedBytes: 600000,
  sourceBytes: 10000000,
};
// Conservative, verified API paths only. Other models can still discuss extracted text.
export function councilCanSeeImages(model: CouncilModel) {
  return ["openai", "anthropic", "gemini", "qwen"].includes(model.provider);
}
export function validateCouncilAttachments(raw: unknown): CouncilAttachment[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > ATTACHMENT_LIMITS.files)
    throw Error("每场最多添加 5 个附件。");
  let images = 0,
    chars = 0;
  const ids = new Set<string>();
  const clean = raw.map((v): CouncilAttachment => {
    if (
      !v ||
      typeof v !== "object" ||
      typeof v.id !== "string" ||
      !/^[a-f\d-]{36}$/i.test(v.id) ||
      ids.has(v.id) ||
      typeof v.name !== "string" ||
      !v.name.trim() ||
      v.name.length > 160 ||
      /[\x00-\x1f\x7f]/.test(v.name) ||
      typeof v.content !== "string" ||
      typeof v.note !== "string" ||
      v.note.length > 300 ||
      v.note.includes("\0") ||
      v.content.includes("\0")
    )
      throw Error("附件格式无效，请移除后重新添加。");
    ids.add(v.id);
    if (v.kind === "image") {
      images++;
      const match =
        /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
          v.content,
        );
      if (
        !match ||
        v.mime !== `image/${match[1]}` ||
        match[2].length % 4 !== 0 ||
        (match[2].length / 4) * 3 > ATTACHMENT_LIMITS.imageBytes + 2
      )
        throw Error("图片格式无效或过大，请重新添加 JPEG、PNG 或 WebP 图片。");
      // Header checks reject disguised HTML/SVG/URLs; providers also decode/validate pixels.
      const bytes = atob(match[2].slice(0, 24));
      if (
        !(v.mime === "image/jpeg"
          ? bytes.startsWith("\xff\xd8\xff")
          : v.mime === "image/png"
            ? bytes.startsWith("\x89PNG\r\n\x1a\n")
            : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP")
      )
        throw Error("图片内容与格式不符。");
    } else if (
      v.kind === "text" &&
      v.mime === "text/plain" &&
      v.content.trim()
    ) {
      chars += v.content.length;
    } else throw Error("附件类型无效；文档只保存提取后的纯文字。");
    return {
      id: v.id,
      name: v.name.trim(),
      kind: v.kind,
      mime: v.mime,
      content: v.content,
      note: v.note,
    };
  });
  if (images > ATTACHMENT_LIMITS.images || chars > ATTACHMENT_LIMITS.textChars)
    throw Error("每场最多 2 张图片，全部文档合计最多 30,000 字；请精简材料。");
  if (
    new TextEncoder().encode(JSON.stringify(clean)).byteLength >
    ATTACHMENT_LIMITS.serializedBytes
  )
    throw Error("附件合计过大，请移除部分材料或裁剪图片。");
  return clean;
}
