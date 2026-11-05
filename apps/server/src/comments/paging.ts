import { isNewerThan } from "./http.js";
import type { CommentPage, FetchedComment } from "./types.js";

const MAX_PAGES = 8;

/** Walk pages newest-first and stop once a comment is at or before `since`. */
export async function pullUntilOld(
  since: string | null,
  fetchPage: (pageToken: string | null) => Promise<CommentPage>,
): Promise<FetchedComment[]> {
  const out: FetchedComment[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(pageToken);
    let hitOld = false;
    for (const comment of result.comments) {
      if (!isNewerThan(comment.publishedAt, since)) {
        hitOld = true;
        continue;
      }
      out.push(comment);
    }
    if (hitOld || !result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  return out;
}
