import type Database from "better-sqlite3";
const states = new WeakMap<Database.Database, boolean>();
export function initializeFts(db: Database.Database, logger: {
    warn(message: string): void;
} = console): boolean {
    if (states.has(db))
        return states.get(db)!;
    try {
        db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_fts USING fts5(title, text, content='retrieval_chunks', content_rowid='id', tokenize="unicode61 remove_diacritics 2")`);
        // External-content COUNT(*) reads the source; vocab counts actual indexed documents, including orphans.
        db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.retrieval_vocab USING fts5vocab(main, retrieval_fts, instance)");
        const indexed = (db.prepare("SELECT count(DISTINCT doc) n FROM retrieval_vocab").get() as {
            n: number;
        }).n;
        const chunks = (db.prepare("SELECT count(*) n FROM retrieval_chunks WHERE text <> ''").get() as {
            n: number;
        }).n;
        if (indexed !== chunks)
            rebuildFts(db);
        states.set(db, true);
        return true;
    }
    catch {
        logger.warn("FTS5 unavailable; knowledge uses text scoring.");
        states.set(db, false);
        return false;
    }
}
export function rebuildFts(db: Database.Database) { db.exec("INSERT INTO retrieval_fts(retrieval_fts) VALUES('rebuild')"); }
export function deleteFts(db: Database.Database, row: {
    id: number;
    title: string;
    text: string;
}) {
    if (initializeFts(db))
        db.prepare("INSERT INTO retrieval_fts(retrieval_fts,rowid,title,text) VALUES('delete',?,?,?)").run(row.id, row.title, row.text);
}
export function insertFts(db: Database.Database, row: {
    id: number;
    title: string;
    text: string;
}) {
    if (initializeFts(db))
        db.prepare("INSERT INTO retrieval_fts(rowid,title,text) VALUES(?,?,?)").run(row.id, row.title, row.text);
}
