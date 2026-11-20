import type { Script } from "../../schemas/script.js";

function script(partial: Pick<Script, "hook" | "outro"> & { sections: Array<{ id: string; narration: string }> }): Script {
  return {
    title: "Fixture",
    hook: partial.hook,
    outro: partial.outro,
    sections: partial.sections.map((s) => ({
      id: s.id,
      heading: s.id,
      narration: s.narration,
      visualQueries: { primary: "x", alternatives: [] },
      visualNotes: "",
      musicMood: "",
      energy: "medium" as const,
      estDurationSec: 0,
    })),
    music: { mood: "", energy: "medium", keywords: [] },
  };
}

/** Wikipedia-style: every sentence opens with a year (cut from a real product script, no ids). */
export const dateListScript = script({
  hook: "Điều gì khiến một bức tường kéo dài hàng nghìn cây số còn đứng đến hôm nay?",
  sections: [
    {
      id: "s1",
      narration: "Năm 221 TCN, Tần Thủy Hoàng thống nhất Trung Hoa. Năm 214 TCN, ông ra lệnh nối các đoạn tường cũ. Năm 1368, nhà Minh xây lại toàn bộ. Năm 1987 UNESCO công nhận di sản này.",
    },
  ],
  outro: "Bức tường đứng đó vì người ta không ngừng sửa nó, và câu hỏi về cái giá phải trả vẫn còn bỏ ngỏ.",
});

export const templateOutroScript = script({
  hook: "Một ban nhạc bốn cô gái đã làm được điều gì mà chưa ai làm?",
  sections: [{ id: "s1", narration: "Cô gái đầu tiên bước lên sân khấu một mình. Đèn tắt. Cả sân vận động nín thở trước tiếng trống." }],
  outro: "Cảm ơn bạn đã đồng hành cùng video này. Đừng quên like và đăng ký kênh. Hẹn gặp lại trong video tới.",
});

export const clicheScript = script({
  hook: "Tại sao anh ta bước vào trận chiến cuối cùng một mình?",
  sections: [{ id: "s1", narration: "Đó là một cái kết bi tráng. Anh ta cầm kiếm đứng giữa đồng tuyết. Gió lạnh cắt vào mặt." }],
  outro: "Anh ta đi một mình vì không còn ai tin vào lời hứa cũ của hội kiếm sĩ.",
});

export const repeatedHookScript = script({
  hook: "Bức tường này được xây để ngăn ai?",
  sections: [{ id: "s1", narration: "Bức tường này được xây để ngăn ai? Câu trả lời nằm trong một bức thư viết vội của một người lính gác." }],
  outro: "Người lính gác ấy đã trả lời: ngăn nỗi sợ chứ không phải kẻ thù.",
});

/** Hand-written, concrete, rhythm mixed, outro pays off the hook. */
export const cleanScript = script({
  hook: "Một người lính gác viết thư về nhà từ đỉnh tường. Bức thư ấy hỏi ai thực sự cần bức tường này?",
  sections: [
    {
      id: "s1",
      narration: "Đêm đó gió rất lạnh. Người lính gác tên Lương ngồi co ro cạnh ngọn đuốc gần tắt, viết bức thư mà anh biết sẽ không gửi đi được. Tuyết đã chặn đường về nhà. Anh viết ngắn thôi. Một câu hỏi duy nhất: ai cần bức tường này hơn, nhà vua hay chúng ta?",
    },
    {
      id: "s2",
      narration: "Sáng hôm sau, một đoàn thương nhân đến chân tường. Họ không mang gươm. Họ mang muối, vải và tin tức từ phương nam, và người lính mở cổng cho họ, dù lệnh trên nói phải đóng. Cổng mở, câu hỏi của Lương bắt đầu có lời đáp.",
    },
  ],
  outro: "Vậy ai cần bức tường này hơn? Lương mất cả đời mới hiểu: bức tường cần có người gác cổng, và người gác cổng quyết định ai được bước qua. Đó là điều chưa sử sách nào ghi lại trọn vẹn.",
});
