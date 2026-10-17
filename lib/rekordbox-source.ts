import { REKORDBOX_XML_LIMIT } from "./rekordbox";

/** Device-only, read-only user-selected XML. Never included in family backups. */
export type XMLFileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};
export type XMLSource = {
  handle: XMLFileHandle;
  lastImportedHash: string;
  autoCheck: boolean;
};
export type XMLPickerWindow = Window & {
  showOpenFilePicker?: (options: {
    multiple: false;
    types: { description: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption: boolean;
  }) => Promise<XMLFileHandle[]>;
};
const DB = "together-rekordbox-source-v1";
export function sourceKey(userId: string, householdId: string) {
  return JSON.stringify([userId, householdId]);
}
async function transactSourceStorage(
  key: string,
  action: "get" | "put" | "delete",
  value?: XMLSource,
): Promise<XMLSource | null> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("sources");
    open.onerror = () =>
      reject(new Error("无法使用本机文件记忆；仍可直接导入 XML。"));
    open.onblocked = () => {
      expired = true;
      reject(new Error("本机文件记忆暂不可用，请关闭旧的 App 标签页再试。"));
    };
    open.onsuccess = () => {
      const db = open.result;
      if (expired) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      try {
        const tx = db.transaction(
          "sources",
          action === "get" ? "readonly" : "readwrite",
        );
        const store = tx.objectStore("sources");
        const request =
          action === "get"
            ? store.get(key)
            : action === "put"
              ? store.put(value, key)
              : store.delete(key);
        let result: XMLSource | null = null;
        request.onsuccess = () => {
          if (action === "get") result = request.result ?? null;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(new Error("无法保存本机文件授权；仍可直接导入 XML。"));
        };
      } catch {
        db.close();
        reject(new Error("浏览器无法记住这个文件；仍可直接导入 XML。"));
      }
    };
  });
}
// Serialize transactions, including opens, so a queued save cannot resurrect a forgotten handle.
let storageQueue: Promise<unknown> = Promise.resolve();
export function sourceStorage(
  key: string,
  action: "get" | "put" | "delete",
  value?: XMLSource,
) {
  const task = storageQueue.then(() =>
    transactSourceStorage(key, action, value),
  );
  storageQueue = task.catch(() => undefined);
  return task;
}
export async function readXMLSource(
  handle: XMLFileHandle,
  interactive: boolean,
) {
  let permission = await handle.queryPermission({ mode: "read" });
  if (permission !== "granted" && interactive)
    permission = await handle.requestPermission({ mode: "read" });
  if (permission !== "granted") return null;
  const file = await handle.getFile();
  if (!/\.xml$/i.test(file.name))
    throw new Error("请选择 rekordbox 导出的 .xml 文件，不读取音频文件。");
  if (file.size > REKORDBOX_XML_LIMIT)
    throw new Error("XML 不能超过 12MB，请缩小导出范围。");
  const text = await file.text();
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > REKORDBOX_XML_LIMIT)
    throw new Error("XML 不能超过 12MB。");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return { file, text, hash };
}
