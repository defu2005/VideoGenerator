import type { SceneWord } from "@vg/shared";
import type { FootageHit } from "../../src/providers/footage/types.js";

const WORD_SEC = 0.28;

export function speak(text: string): { words: SceneWord[]; durationSec: number } {
  let t = 0.1;
  const words = text.split(/\s+/).filter(Boolean).map((token, i): SceneWord => {
    const startSec = t;
    const endSec = t + WORD_SEC;
    const punct = /[,;:.!?…]$/u.test(token);
    t = endSec + (punct ? 0.24 : 0.04);
    return { i, text: token, startSec, endSec, sentenceEnd: /[.!?…]$/u.test(token), punct };
  });
  return { words, durationSec: Math.round((t + 0.2) * 30) / 30 };
}

export function hit(id: string): FootageHit {
  return {
    provider: "pixabay", clipId: id, url: `https://video.example/${id}.mp4`, width: 1280, height: 720, durationSec: 12,
    author: "An", licenseName: "Pixabay License", pageUrl: `https://pixabay.com/videos/${id}`, previewImage: "", tags: ["city"], files: [],
  };
}

export const SCENES = [
  "Bạn có biết, mỗi ngày chúng ta lãng phí hàng giờ đồng hồ cho điện thoại mà không hề nhận ra điều đó.",
  "Người Việt dùng mạng xã hội rất nhiều. Facebook chiếm 45%, YouTube 30%, TikTok 25%. Con số này vẫn đang thay đổi từng tháng.",
  "Chuyến đi năm ngoái đưa chúng tôi tới Hà Nội, rồi vào Đà Nẵng và cuối cùng là thành phố Hồ Chí Minh trong một tuần dài.",
  "Bốn thói quen tốt. Thứ nhất, uống nước ấm. Thứ hai, vận động nhẹ. Thứ ba, ăn sáng đủ chất. Thứ tư, ngủ đúng giờ.",
  "Cách làm rất đơn giản. Bước một, chuẩn bị nguyên liệu. Bước hai, trộn đều hỗn hợp. Bước ba, nướng trong lò mười phút.",
  "Xe điện đắt hơn nhiều so với xe xăng nhưng chi phí vận hành thấp hơn hẳn trong suốt mười năm sử dụng.",
  "Trước đây người ta tin vào tin đồn, sau này mọi người mới hiểu ra rằng đó chỉ là chuyện bịa đặt mà thôi.",
  "Nhiều người nghĩ rằng ăn đêm làm béo nhưng thực ra tổng lượng calo cả ngày mới là điều quyết định mọi thứ.",
  "Ông Nam nói “mọi thành công lớn đều bắt đầu từ một quyết định nhỏ bé nhưng rất kiên trì” trước đông đảo khán giả. Thật khó quên!",
  "Tây Ninh có nhiều vườn điều và nhà máy đường. Câu này kéo dài thêm để cảnh đủ thời gian xem.",
  "Cà phê máy khác với cà phê phin ở độ đậm. Phần còn lại của cảnh nói về cách pha cho đủ dài.",
  "An nói: “Uống nước đều mỗi ngày giúp cơ thể tỉnh táo hơn hẳn.” Phần còn lại của cảnh chỉ là hình minh hoạ cho lời vừa đọc và giữ câu trích dưới một nửa thời lượng.",
  "1. Ngủ đủ giấc. 2. Uống nước. 3. Đi bộ mỗi ngày. Ba việc này giữ sức khoẻ lâu dài hơn và phần còn lại chỉ để danh sách nằm dưới một nửa thời lượng của cảnh.",
  "Hãy thử đặt điện thoại ở phòng khác trong một giờ đầu tiên của buổi sáng, rồi quan sát xem bạn làm được bao nhiêu việc.",
];

export const GENRE_IDS = ["explainer", "listicle", "story", "news_recap", "myth_vs_fact", "how_to", "short_hook", "history", "finance", "travel"];

