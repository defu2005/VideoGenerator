import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { ArtifactService } from "../src/node/artifactService.js";
import { NodeUploadStore } from "../src/node/uploadStore.js";
import { createPipelineHarness } from "./pipelineFixtures.js";
import { createProjectDir } from "../src/storage/paths.js";

it("continues a partial output across a store restart and links known bytes", async () => {
  const h = createPipelineHarness();
  try {
    const job = h.repository.createJob({ projectId: h.projectId, stage: "RENDER", maxAttempts: 2, previousState: "PENDING" });
    const bytes = Buffer.from("0123456789"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const output = { jobId: job.id, leaseId: "fixture-lease", name: "final.mp4", sha256, size: bytes.length };
    const directory = createProjectDir(h.config.DATA_DIR, h.projectId);
    const path = join(directory, "partial.mp4");
    const guard = () => {};
    const store = () => new NodeUploadStore(h.sqlite, new ArtifactService(h.sqlite), 1000, h.clock);
    const first = store();
    expect(await first.append(output, path, 0, Readable.from([bytes.subarray(0, 4)]), guard)).toMatchObject({ status: "partial", receivedBytes: 4 });
    expect(first.ready(job.id, output.leaseId).size).toBe(0);
    const restarted = store();
    expect(await restarted.offset(job.id, output.leaseId, output.name)).toEqual({ receivedBytes: 4, size: 10 });
    await expect(restarted.append(output, path, 2, Readable.from([bytes.subarray(4)]), guard)).rejects.toMatchObject({ statusCode: 409, code: "UPLOAD_OFFSET_MISMATCH" });
    expect(await restarted.offset(job.id, output.leaseId, output.name)).toMatchObject({ receivedBytes: 4 });
    expect(await restarted.append(output, path, 4, Readable.from([bytes.subarray(4)]), guard)).toMatchObject({ status: "ready", receivedBytes: 10 });
    expect(store().ready(job.id, output.leaseId).get(output.name)).toMatchObject({ sha256, size: 10, path });
    expect(store().ready(job.id, "other-lease").size).toBe(0);

    const known = join(directory, "known.mp4");
    writeFileSync(known, bytes);
    await new ArtifactService(h.sqlite).register(known);
    expect(store().linkKnown({ ...output, leaseId: "new-fixture-lease" })).toBe(true);
    expect(store().ready(job.id, "new-fixture-lease").get(output.name)).toMatchObject({ status: "linked", path: known });
  } finally { h.close(); }
});
