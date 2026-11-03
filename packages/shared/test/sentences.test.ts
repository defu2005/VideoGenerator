import { describe, expect, it } from "vitest";
import { splitSentences } from "../src/scenes/sentences.js";

describe("splitSentences", () => {
  it.each([
    ["English periods", "One sentence. Two sentences.", ["One sentence.", "Two sentences."], "en"],
    ["English exclamation and question", "Really! Are you sure?", ["Really!", "Are you sure?"], "en"],
    ["mixed terminal punctuation", "Wait?! Really...", ["Wait?!", "Really..."], "en"],
    ["Unicode ellipsis", "Not yet… Now.", ["Not yet…", "Now."], "en"],
    ["decimal point", "The value is 3.5 today. Next item.", ["The value is 3.5 today.", "Next item."], "en"],
    ["thousands separator", "Population is 1.000 people. Continue.", ["Population is 1.000 people.", "Continue."], "vi"],
    ["Vietnamese city abbreviation", "Tôi sống ở TP.HCM hôm nay. Ngày mai.", ["Tôi sống ở TP.HCM hôm nay.", "Ngày mai."], "vi"],
    ["Mr abbreviation", "Mr. Smith arrived. He left.", ["Mr. Smith arrived.", "He left."], "en"],
    ["Dr abbreviation", "Dr. Jane spoke. The talk ended.", ["Dr. Jane spoke.", "The talk ended."], "en"],
    ["St abbreviation", "St. Paul is nearby. We can walk.", ["St. Paul is nearby.", "We can walk."], "en"],
    ["versus abbreviation", "Cats vs. dogs? Choose.", ["Cats vs. dogs?", "Choose."], "en"],
    ["Vietnamese abbreviation", "Đúng v.v. như đã nói. Tiếp tục.", ["Đúng v.v. như đã nói.", "Tiếp tục."], "vi"],
    ["for example abbreviation", "Use e.g. a short title. Keep going.", ["Use e.g. a short title.", "Keep going."], "en"],
    ["that is abbreviation", "It is i.e. the same thing. Next.", ["It is i.e. the same thing.", "Next."], "en"],
    ["United States abbreviation", "The U.S. economy grew. Markets reacted.", ["The U.S. economy grew.", "Markets reacted."], "en"],
    ["initials", "A. Turing worked here. He left.", ["A. Turing worked here.", "He left."], "en"],
    ["lowercase after quoted ellipsis", "She said, “wait... a little longer” before leaving. Then she went.", ["She said, “wait... a little longer” before leaving.", "Then she went."], "en"],
    ["quoted normal ellipsis", "He said, “Enough...” Then he left.", ["He said, “Enough...”", "Then he left."], "en"],
    ["line break", "First line\nSecond line", ["First line", "Second line"], "en"],
    ["CRLF line break", "Câu một.\r\nCâu hai.", ["Câu một.", "Câu hai."], "vi"],
    ["collapse spaces", "  Hello   world.   Next. ", ["Hello world.", "Next."], "en"],
    ["Vietnamese diacritics", "Tôi rất vui! Bạn khỏe không?", ["Tôi rất vui!", "Bạn khỏe không?"], "vi"],
    ["punctuation at end", "Finished.", ["Finished."], "en"],
    ["empty content", " \n  ", [], "vi"],
  ])("%s", (_name, text, expected, language) => {
    expect(splitSentences(text, language)).toEqual(expected);
  });
});
