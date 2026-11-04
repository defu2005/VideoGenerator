import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

const MAX_STORE_BYTES = 0xffff_ffff; // ZIP64 not supported — reject above 4 GiB

export type ZipEntry = {
  name: string;
  path: string;
};

type PreparedEntry = ZipEntry & {
  size: number;
  crc: number;
  localHeaderOffset: number;
};

function encodeName(name: string): Buffer {
  return Buffer.from(name.replace(/\\/g, "/"), "utf8");
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function localHeader(nameBuf: Buffer, when: Date): Buffer {
  const { time, date } = dosDateTime(when);
  const header = Buffer.alloc(30 + nameBuf.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0808, 6); // data descriptor + UTF-8
  header.writeUInt16LE(0, 8); // store
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  nameBuf.copy(header, 30);
  return header;
}

function dataDescriptor(crc: number, size: number): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(0x08074b50, 0);
  buf.writeUInt32LE(crc >>> 0, 4);
  buf.writeUInt32LE(size, 8);
  buf.writeUInt32LE(size, 12);
  return buf;
}

function centralHeader(entry: PreparedEntry, nameBuf: Buffer, when: Date): Buffer {
  const { time, date } = dosDateTime(when);
  const header = Buffer.alloc(46 + nameBuf.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(entry.crc >>> 0, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);
  nameBuf.copy(header, 46);
  return header;
}

function endOfCentral(count: number, size: number, offset: number): Buffer {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(0, 4);
  buf.writeUInt16LE(0, 6);
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(size, 12);
  buf.writeUInt32LE(offset, 16);
  buf.writeUInt16LE(0, 20);
  return buf;
}

function pushChunk(queue: Readable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (queue.destroyed) {
      reject(new Error("Zip stream destroyed"));
      return;
    }
    if (queue.push(chunk)) {
      resolve();
      return;
    }
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      queue.off("drain", onDrain);
      queue.off("error", onError);
    };
    queue.once("drain", onDrain);
    queue.once("error", onError);
  });
}

async function streamFile(
  queue: Readable,
  path: string,
): Promise<{ size: number; crc: number }> {
  const size = statSync(path).size;
  if (size > MAX_STORE_BYTES) {
    const error = new Error("EXPORT_TOO_LARGE");
    error.name = "EXPORT_TOO_LARGE";
    throw error;
  }
  let crc = 0;
  let seen = 0;
  await new Promise<void>((resolve, reject) => {
    const file = createReadStream(path);
    file.on("data", (chunk: string | Buffer) => {
      const buf = chunk as Buffer;
      crc = crc32(buf, crc);
      seen += buf.length;
      file.pause();
      void pushChunk(queue, buf).then(() => file.resume(), reject);
    });
    file.on("error", reject);
    file.on("end", () => {
      if (seen !== size) {
        reject(new Error(`Zip size mismatch for ${path}`));
        return;
      }
      resolve();
    });
  });
  return { size, crc };
}

/** Store-only ZIP stream with data descriptors (no full-file buffering). */
export function createZipStream(entries: ZipEntry[], when: Date = new Date()): Readable {
  const queue = new Readable({ read() {} });

  void (async () => {
    try {
      const prepared: PreparedEntry[] = [];
      let offset = 0;
      for (const entry of entries) {
        const nameBuf = encodeName(entry.name);
        const header = localHeader(nameBuf, when);
        const localOffset = offset;
        await pushChunk(queue, header);
        const { size, crc } = await streamFile(queue, entry.path);
        await pushChunk(queue, dataDescriptor(crc, size));
        prepared.push({ ...entry, size, crc, localHeaderOffset: localOffset });
        offset += header.length + size + 16;
      }

      const centralStart = offset;
      let centralSize = 0;
      for (const entry of prepared) {
        const nameBuf = encodeName(entry.name);
        const header = centralHeader(entry, nameBuf, when);
        centralSize += header.length;
        await pushChunk(queue, header);
      }
      await pushChunk(queue, endOfCentral(prepared.length, centralSize, centralStart));
      queue.push(null);
    } catch (error) {
      queue.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return queue;
}

/** Parse central-directory entries from a store-only zip buffer (for tests). */
export function listZipCentralDirectory(buffer: Buffer): Array<{ name: string; crc: number; size: number }> {
  const entries: Array<{ name: string; crc: number; size: number }> = [];
  let i = 0;
  while (i + 4 <= buffer.length) {
    const sig = buffer.readUInt32LE(i);
    if (sig === 0x02014b50) {
      const crc = buffer.readUInt32LE(i + 16);
      const size = buffer.readUInt32LE(i + 24);
      const nameLen = buffer.readUInt16LE(i + 28);
      const extraLen = buffer.readUInt16LE(i + 30);
      const commentLen = buffer.readUInt16LE(i + 32);
      const name = buffer.subarray(i + 46, i + 46 + nameLen).toString("utf8");
      entries.push({ name, crc, size });
      i += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    if (sig === 0x06054b50) break;
    i += 1;
  }
  return entries;
}
