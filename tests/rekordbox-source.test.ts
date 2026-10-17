import { describe, it, expect, vi } from "vitest";
import {
  readXMLSource,
  sourceKey,
  type XMLFileHandle,
} from "../lib/rekordbox-source";
const handle = (
  permission: PermissionState = "granted",
  text = "<xml>synthetic</xml>",
) => ({
  kind: "file" as const,
  name: "synthetic.xml",
  queryPermission: vi.fn(async () => permission),
  requestPermission: vi.fn(async () => "granted" as const),
  getFile: vi.fn(async () => new File([text], "synthetic.xml")),
});
describe("read-only device XML source", () => {
  it.each(["prompt", "denied"] as const)(
    "被动检查%s状态不请求权限也不读文件",
    async (permission) => {
      const h = handle(permission);
      expect(await readXMLSource(h, false)).toBeNull();
      expect(h.requestPermission).not.toHaveBeenCalled();
      expect(h.getFile).not.toHaveBeenCalled();
      expect(h.queryPermission).toHaveBeenCalledWith({ mode: "read" });
    },
  );
  it("只有用户点击才申请读取权限，从不申请写权限", async () => {
    const h = handle("prompt");
    const result = await readXMLSource(h, true);
    expect(h.requestPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(result?.text).toBe("<xml>synthetic</xml>");
  });
  it("拒绝交互授权不读取", async () => {
    const h: XMLFileHandle = {
      ...handle("prompt"),
      requestPermission: vi.fn(async () => "denied" as const),
    };
    expect(await readXMLSource(h, true)).toBeNull();
    expect(h.getFile).not.toHaveBeenCalled();
  });
  it("内容哈希能分辨同文件名同字节长度的更新", async () => {
    const a = await readXMLSource(handle("granted", "AAAA"), false),
      b = await readXMLSource(handle("granted", "BBBB"), false);
    expect(a?.hash).toHaveLength(64);
    expect(a?.hash).not.toBe(b?.hash);
    expect((await readXMLSource(handle("granted", "AAAA"), false))?.hash).toBe(
      a?.hash,
    );
  });
  it("超大文件在读文本前阻止，已移除文件报错不假称成功", async () => {
    const h = handle();
    const text = vi.fn();
    h.getFile.mockResolvedValue({
      name: "large.xml",
      size: 13 * 1024 * 1024,
      text,
    } as unknown as File);
    await expect(readXMLSource(h, false)).rejects.toThrow(/12MB/);
    expect(text).not.toHaveBeenCalled();
    h.getFile.mockRejectedValue(new Error("File removed"));
    await expect(readXMLSource(h, false)).rejects.toThrow(/removed/);
  });
  it("本机授权键同时隔离账号与家庭，无含混字符串拼接", () => {
    expect(sourceKey("user1", "home1")).not.toBe(sourceKey("user2", "home1"));
    expect(sourceKey("user1", "home1")).not.toBe(sourceKey("user1", "home2"));
    expect(sourceKey("a:b", "c")).not.toBe(sourceKey("a", "b:c"));
  });
  it("非XML文件在读取内容前阻止", async () => {
    const h = handle(),
      text = vi.fn();
    h.getFile.mockResolvedValue({
      name: "song.mp3",
      size: 10,
      text,
    } as unknown as File);
    await expect(readXMLSource(h, false)).rejects.toThrow(/xml/);
    expect(text).not.toHaveBeenCalled();
  });
});
