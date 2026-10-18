"use client";
import {
  ATTACHMENT_LIMITS,
  type CouncilAttachment,
} from "./council-attachments";

export async function prepareCouncilFile(
  file: File,
): Promise<CouncilAttachment> {
  if (!file.size || file.size > ATTACHMENT_LIMITS.sourceBytes)
    throw Error("文件为空或超过 10 MB，请选择较小的材料。");
  const name =
    file.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160) || "附件";
  const base = { id: crypto.randomUUID(), name };
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  if (["png", "jpg", "jpeg", "webp"].includes(ext || "")) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 40000000
      )
        throw Error("图片尺寸过大，请先裁剪到需要研讨的区域。");
      const canvas = document.createElement("canvas");
      let edge = 1800;
      for (let attempt = 0; attempt < 5; attempt++, edge *= 0.8) {
        const scale = Math.min(
          1,
          edge / Math.max(image.naturalWidth, image.naturalHeight),
        );
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw Error("此浏览器无法处理图片，请改用文字材料。");
        context.fillStyle = "white";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const content = canvas.toDataURL("image/jpeg", 0.84 - attempt * 0.08);
        if (
          (content.length - content.indexOf(",") - 1) * 0.75 <=
          ATTACHMENT_LIMITS.imageBytes
        )
          return {
            ...base,
            kind: "image",
            mime: "image/jpeg",
            content,
            note: `已去除元数据并压缩为 ${canvas.width} × ${canvas.height}；请预览确认小字清楚。`,
          };
      }
      throw Error("图片细节过多，请裁剪成局部截图后重试。");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  let text = "",
    note = "纯文字材料；只保存预览中的文字，不保存原始文件。";
  if (["txt", "md", "csv", "tsv", "json"].includes(ext || "")) {
    if (file.size > 240000)
      throw Error("文字文件过大，请节选至 30,000 字以内。");
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw Error("文字编码不是 UTF-8，请另存为 UTF-8 后添加。");
    }
    if (text.includes("\0"))
      throw Error("文件包含二进制内容，不是可读取的文字材料。");
  } else if (ext === "docx") {
    const { unzip, strFromU8 } = await import("fflate");
    const buffer = new Uint8Array(await file.arrayBuffer());
    const xml = await new Promise<string>((resolve, reject) => {
      let oversized = false;
      let cancel = () => {};
      const timer = setTimeout(() => {
        cancel();
        reject(Error("文档解压超时，请改用纯文字。"));
      }, 10000);
      // Extract only the bounded main document, never links/macros/media.
      cancel = unzip(
        buffer,
        {
          filter: (entry) => {
            if (entry.name !== "word/document.xml") return false;
            if (entry.originalSize > 2000000) {
              oversized = true;
              return false;
            }
            return true;
          },
        },
        (error, data) => {
          clearTimeout(timer);
          if (error || oversized || !data?.["word/document.xml"])
            reject(
              Error("DOCX 无法读取、内容过大或已加密，请另存为文字后重试。"),
            );
          else resolve(strFromU8(data["word/document.xml"]));
        },
      );
    });
    if (/<!DOCTYPE|<!ENTITY/i.test(xml))
      throw Error("DOCX 不允许包含 DTD 或实体声明。");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw Error("DOCX 文字结构无效。");
    text = Array.from(doc.getElementsByTagNameNS("*", "p"))
      .map((p) =>
        Array.from(p.getElementsByTagNameNS("*", "t"))
          .map((n) => n.textContent || "")
          .join(""),
      )
      .join("\n");
    note =
      "DOCX 提取正文；图片、批注、页眉页脚与复杂表格未包含。只保存提取文字。";
  } else if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      cMapUrl: `/vendor/pdfjs/${pdfjs.version}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `/vendor/pdfjs/${pdfjs.version}/standard_fonts/`,
    });
    const timeout = setTimeout(() => {
      void task.destroy();
    }, 20000);
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 30) throw Error("PDF 超过 30 页，请先节选相关页面。");
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        pages.push(
          `[第 ${i} 页]\n` +
            content.items
              .map((item) =>
                "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
              )
              .join(""),
        );
        if (pages.join("\n").length > ATTACHMENT_LIMITS.textChars)
          throw Error("PDF 文字超过 30,000 字，请先节选。");
        page.cleanup();
      }
      text = pages.join("\n\n");
      if (text.replace(/\[第 \d+ 页\]/g, "").trim().length < 10)
        throw Error(
          "此 PDF 没有足够可提取文字，可能为扫描件；请添加关键页截图供看图模型研讨。",
        );
      note = `${pdf.numPages} 页 PDF 提取文字，保留页码；不包含扫描内容、图像或完整表格排版。只保存提取文字。`;
    } catch (e) {
      if (e instanceof Error && /30|扫描|提取/.test(e.message)) throw e;
      throw Error("PDF 读取失败、已加密或超时。请解密、节选或改用截图。");
    } finally {
      clearTimeout(timeout);
      await task.destroy();
    }
  } else
    throw Error(
      "支持 JPEG / PNG / WebP、PDF、DOCX、TXT、Markdown、CSV、TSV 和 JSON；暂不支持 XLSX、旧版 DOC 或音视频。",
    );
  text = text.trim();
  if (!text || text.length > ATTACHMENT_LIMITS.textChars)
    throw Error("文档为空或超过 30,000 字，请先节选；不会静默截断材料。");
  return { ...base, kind: "text", mime: "text/plain", content: text, note };
}
