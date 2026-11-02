import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const drizzleDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

describe("Drizzle migration hygiene", () => {
  it("keeps journal entries, SQL files, snapshots, and timestamps in sync", () => {
    const journal = JSON.parse(readFileSync(join(drizzleDirectory, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const migrationFiles = new Set(readdirSync(drizzleDirectory).filter((file) => file.endsWith(".sql")));

    for (let index = 0; index < journal.entries.length; index += 1) {
      const entry = journal.entries[index];
      expect(migrationFiles.delete(`${entry.tag}.sql`), `journal entry ${entry.tag} must have a SQL migration`).toBe(true);
      expect(
        readFileSync(join(drizzleDirectory, "meta", `${String(entry.idx).padStart(4, "0")}_snapshot.json`), "utf8"),
        `journal entry ${entry.tag} must have a snapshot`,
      ).toBeTruthy();
      if (index > 0) {
        expect(entry.when, `migration ${entry.tag} timestamp must increase`)
          .toBeGreaterThan(journal.entries[index - 1].when);
      }
    }

    expect([...migrationFiles], "there must be no migration SQL outside the journal").toEqual([]);
  });
});
