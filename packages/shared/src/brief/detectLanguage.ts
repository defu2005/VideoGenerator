const VIETNAMESE_DIACRITICS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

export function detectLanguage(text: string): { language: "vi" | "en"; reason: string } {
  if (VIETNAMESE_DIACRITICS.test(text)) {
    return { language: "vi", reason: "Detected Vietnamese characters in the topic" };
  }
  return { language: "en", reason: "No Vietnamese diacritics detected; using English" };
}
