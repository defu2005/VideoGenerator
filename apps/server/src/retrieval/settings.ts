import type Database from "better-sqlite3";
import { RetrievalSettingsSchema, type RetrievalSettings } from "@vg/shared";
export function retrievalSettings(db: Database.Database): RetrievalSettings {
    const row = db.prepare("SELECT value FROM app_settings WHERE key='retrieval.settings'").get() as {
        value: string;
    } | undefined;
    try {
        return RetrievalSettingsSchema.parse(row ? JSON.parse(row.value) : {});
    }
    catch {
        return RetrievalSettingsSchema.parse({});
    }
}
export function saveRetrievalSettings(db: Database.Database, value: unknown) {
    const settings = RetrievalSettingsSchema.parse(value);
    db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('retrieval.settings',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(JSON.stringify(settings), new Date().toISOString());
    return settings;
}
