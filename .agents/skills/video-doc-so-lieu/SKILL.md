---
name: video-doc-so-lieu
description: >-
  Đọc số liệu kênh trong app Video Agent và biến chúng thành việc cần làm:
  giữ chân 30 giây, CTR, Shorts bị lướt qua, doanh thu, tiến độ điều kiện kiếm
  tiền. Dùng khi người dùng hỏi kênh đang thế nào, video nào tốt/kém, báo cáo
  tuần/tháng, hay nên đổi gì.
operator: true
area: kenh
triggers:
  - số liệu
  - so lieu
  - báo cáo kênh
  - kênh đang thế nào
  - video nào tốt
  - doanh thu
  - analytics
antiTriggers:
  - xoá
  - xoa
tools:
  - analytics_overview
  - dashboard_stats
  - list_publications
  - video_metrics
  - profile_insights
  - run_insight
  - finance_summary
  - monthly_report
  - add_revenue_entry
  - get_goal_progress
  - apply_insight
risk: confirm
---

# Đọc số liệu và cải thiện

## Ngưỡng tham khảo (kinh nghiệm, không phải số chính thức)

| Chỉ số | Tốt | Cần xem lại |
|---|---|---|
| Còn xem sau 30 giây (video dài) | ≥ 50% | < 40% → sửa mở đầu |
| Thời lượng xem trung bình (video dài) | ≥ 40% | < 30% → thiếu nhắc móc câu hoặc hình đứng lâu |
| Shorts: tỉ lệ xem thay vì lướt | ≥ 50% | < 30% → câu đầu yếu |
| Shorts: thời lượng xem trung bình | ≥ 65% (dưới 30 giây) | thấp hơn nhiều → cắt ngắn lại |

Chỉ dùng chỉ số mà app thật sự có. Thiếu số liệu thì nói thiếu, không đoán.

## Các bước

1. Tổng quan: `analytics_overview` (7, 28 hoặc 90 ngày), `dashboard_stats`.
2. Từng video: `list_publications`, rồi `video_metrics` cho top 3 và bottom 3.
3. Bài học: `profile_insights`. Nếu cũ hơn một tuần, `run_insight` (tối đa một lần mỗi giờ).
4. Tiền: `finance_summary`, `monthly_report`. Người dùng báo doanh thu ngoài app (affiliate, tài trợ) → `add_revenue_entry`.
5. Mục tiêu: `get_goal_progress`; so với điều kiện kiếm tiền (xem `video-chien-luoc-kenh`).
6. Viết báo cáo ngắn:
   - 3 điều đang tốt (kèm số);
   - 3 điều cần sửa, mỗi điều có một việc cụ thể (sửa câu mở kiểu nào, recipe nào nên làm nhiều hơn, chủ đề nào nên làm phần tiếp);
   - khoảng cách tới điều kiện kiếm tiền.
7. Đề xuất áp dụng bài học bằng `apply_insight` (confirm) chỉ khi người dùng đồng ý.

## Quy tắc ra quyết định

- Một video kém chưa đủ kết luận. Cần ít nhất 3 video cùng kiểu.
- Shorts nhiều view → đề xuất chủ đề đó thành video dài.
- Recipe nào retention thấp liên tục → giảm tần suất, không bỏ hẳn khi mẫu còn nhỏ.
- Video đăng chưa đủ 48 giờ thì chưa đánh giá.

## Không làm

- Không bịa số liệu hay so sánh với kênh khác khi không có dữ liệu.
- Không tự đổi hướng kênh; đổi hướng đi qua `video-chien-luoc-kenh`.

## Báo cáo

Làm theo skill `video-bao-cao-thu-nghiem`: đọc báo cáo cũ và nhận việc trước, lưu báo cáo sau, kể cả khi bị chặn.

- Mỗi đề xuất trong báo cáo số liệu là một giả thuyết (ví dụ "làm thêm recipe A thì giờ xem tăng").
- Chỉ số để kiểm: đúng chỉ số mà đề xuất nhắm tới, so với số trong báo cáo này.
- Ngày kiểm: lần đọc số liệu kế tiếp, tối thiểu 7 ngày.

## Nguồn

- https://socialrails.com/blog/youtube-audience-retention-complete-guide
- https://vidiq.com/blog/post/youtube-shorts-algorithm/
- https://gyre.pro/blog/understanding-the-youtube-shorts-algorithm-a--guide
