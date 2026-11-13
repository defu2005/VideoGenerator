# Cách render thay thế

Kiểm tra nguồn và chạy thử ngày **2026-11-11**. Tất cả số đo dưới đây là cảnh 3 giây, 90 frame, 1080×1920, không âm thanh; trung vị 3 lượt, gồm encode H.264 CPU. `null` nghĩa là chưa đo, không phải tốc độ bằng 0. Prototype viết riêng trong OS temp, không sao chép mã thư viện vào repo.

| Phương án | Phiên bản / giấy phép | Windows, độ trưởng thành | Kinetic bold / bar (giây) CPU-only | Công viết lại template |
|---|---|---|---|---|
| FFmpeg ASS/libass | FFmpeg binary 6.1.1; bản build GPL-3.0+; libass ISC, version nhúng null | Binary hiện có chạy thật; hệ thống filter/subtitle lâu đời | 0.664 / 0.621 | Cao: tự viết fit chữ, ngắt dòng, safe zone, màu, timing; ASS prototype chart chưa đếm số |
| FFmpeg drawtext | Cùng binary; không sao chép mã GPL | Filter có trong binary; cần escape văn bản/font; biểu thức enable/x/y/alpha cho hiệu ứng đơn giản | null / null: chưa làm bản tương đương; ASS là prototype được đo | Cao; khó thay GSAP/CSS đầy đủ; không dùng kết quả ASS để nhận là drawtext |
| @napi-rs/canvas | 1.1.0, MIT; phát hành 2026-10-30 | Skia/N-API, có binary Windows; cài và chạy thật trong temp | 2.722 / 2.593 | Cao: viết renderer riêng cho hai template; tái dùng dữ liệu/word timing, không tái dùng DOM/CSS/GSAP |
| skia-canvas | 4.0.0, MIT; 2026-10-12 | Skia; prebuilt Windows x64/arm64; hỗ trợ CPU/GPU | null / null: chưa port/install renderer tương đương; không suy ra từ @napi-rs/canvas | Cao; cần chọn CPU rõ ràng nếu làm benchmark |
| node-canvas | stable 3.2.3, MIT; 2026-03-31 | Cairo, dự án lâu đời; prebuilt Windows x64 theo phiên bản, build nguồn cần Cairo/Pango | null / null: chưa có prototype tương đương; tránh thêm vòng native build | Cao; API canvas gần tương tự, text shaping/đo chữ cần kiểm riêng |
| lottie-web | 5.13.0, MIT; 2025-05-21 | Player SVG/canvas trong browser; Windows qua Chromium; hệ sinh thái Bodymovin | null / null: không có bản Lottie tương đương để đo công bằng | Rất cao: cần tạo/export JSON animation, thay text động và font; vẫn chịu chi phí browser/capture |
| rlottie | MIT core; kèm nhiều notice bên thứ ba; version đo null | C++ CPU renderer; có hướng dẫn build trên Windows | null / null: không cài binary/binding Node, chưa port animation | Rất cao: pipeline Lottie + binding/native distribution + text/font/feature support |
| Skottie | Skia BSD-3-Clause; version đo null | Player Lottie của Skia; native/CanvasKit; Windows cần build/binding phù hợp | null / null: không có native build/animation tương đương trên máy | Rất cao: viết pipeline/binding, kiểm hỗ trợ JSON/effect/font |
| Motion Canvas | @motion-canvas/core 3.17.2, MIT; 2024-12-14 | TypeScript/canvas, editor và export ảnh/video; Windows qua Node/browser | null / null: chưa viết lại template/project/exporter | Cao: chuyển GSAP timeline sang generator/signals; không có bằng chứng nhanh hơn tại đây |
| Remotion | 4.0.542; **giấy phép riêng**, không phải MIT; 2026-11-09 | React/Chromium, tooling render phong phú; Windows được hỗ trợ | null / null: chưa port React compositions; không suy luận từ benchmark quảng bá | Cao: viết React/frame-based animation, font/layout mới; vẫn browser capture |

## Hai prototype đã chạy

FFmpeg ASS: nền màu đặc, font Be Vietnam Pro Bold, 6 từ vào lần lượt bằng fade/scale; bar vẽ vector tăng chiều rộng. Có đúng nội dung và nhấn màu, nhưng **không tương đương hình ảnh**: thiếu radial gradient/beam, layout chữ khác, bar dùng số cuối thay vì counter. Nhanh hơn không có nghĩa thay thế nguyên template hiện tại. `drawtext`/`karaoke` là hướng có thể dùng, chưa có số đo riêng.

Canvas native: gradient, sáu từ fade/translate/scale, nhấn từ, ba bar tăng kèm counter; 90 frame RGBA pipe sang libx264 `veryfast -crf 20 -threads 2`. Đã dùng font TTF Be Vietnam Pro chính thức. Tổng process 2.722 / 2.593 giây; thời gian paint và chờ pipe ở bảng cuối trang này. Vẫn thiếu safe zones/fit text/multi-locale giống hệt app. Không dùng GPU; browser HF mặc định lại dùng Intel D3D11 nên nhãn CPU-only không áp cho baseline HF.

## Đề xuất

Giữ HyperFrames cho QUALITY/MAX trước: MP4 opaque, static option, cache đúng, hạn chế concurrency. Đây là thay đổi nhỏ hơn việc duy trì hai bộ renderer. Chỉ cân nhắc @napi-rs/canvas như fast path giới hạn hai mẫu sau khi được duyệt trong guide và có golden images, timing, font/fallback/RTL và test frame count. Ngưỡng nghiệm thu đề xuất: nhanh ít nhất 2× so với **HF đã tối ưu**, không chỉ so với WebM cũ; so lại cùng load và mức chất lượng. ASS phù hợp text/caption đơn giản, chưa đề xuất thay toàn bộ chart.

Không thêm dependency nào vào app. Font [Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro) dùng OFL; giữ giấy phép font khi phân phối. Bản FFmpeg hiện có bật `--enable-gpl --enable-version3 --enable-libx264`; dùng executable có sẵn khác với vendor mã GPL. Nếu đóng gói lại phải xét license của cả binary và thư viện, không gắn nhãn toàn bộ pipeline là MIT.

## Nguồn chính thức (tất cả kiểm ngày 2026-11-11)


- [FFmpeg 6.1.1 licence](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n6.1.1/LICENSE.md), [filter source/docs](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/doc/filters.texi), [libass ISC](https://raw.githubusercontent.com/libass/libass/master/COPYING). Các filter/binary còn được xác nhận bằng lệnh chạy thật trong temp.
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas), [MIT/third-party notice](https://raw.githubusercontent.com/Brooooooklyn/canvas/main/LICENSE), [registry version](https://registry.npmjs.org/%40napi-rs%2Fcanvas).
- [skia-canvas Windows và binary](https://skia-canvas.org/getting-started), [MIT](https://raw.githubusercontent.com/samizdatco/skia-canvas/main/LICENSE), [registry](https://registry.npmjs.org/skia-canvas).
- [node-canvas README](https://github.com/Automattic/node-canvas), [stable metadata/license](https://registry.npmjs.org/canvas). README main có thể nói bản 4 prerelease; bảng này lấy stable tag registry.
- [lottie-web](https://github.com/airbnb/lottie-web), [MIT](https://raw.githubusercontent.com/airbnb/lottie-web/master/LICENSE.md), [registry](https://registry.npmjs.org/lottie-web).
- [rlottie](https://github.com/Samsung/rlottie), [COPYING/third parties](https://raw.githubusercontent.com/Samsung/rlottie/master/COPYING), [build Windows](https://github.com/Samsung/rlottie/wiki/Instruction-to-web-player-developlement-environment-on-Windows).
- [Skottie](https://docs.skia.org/docs/user/modules/skottie/), [Skia BSD](https://raw.githubusercontent.com/google/skia/main/LICENSE).
- [Motion Canvas rendering](https://motioncanvas.io/docs/rendering/), [MIT](https://raw.githubusercontent.com/motion-canvas/motion-canvas/main/LICENSE), [registry](https://registry.npmjs.org/%40motion-canvas%2Fcore).
- [Remotion pricing/eligibility](https://www.remotion.dev/docs/license/pricing), [terms FAQ](https://www.remotion.dev/docs/license/faq), [Windows screenshot path](https://convert.remotion.dev/docs/shared-memory-capture), [registry](https://registry.npmjs.org/remotion): cá nhân/công ty tối đa 3 người thuộc diện Free License theo điều kiện; ngoài diện miễn phí cần Company License. Không vendor mã theo giả định permissive.


## Chi tiết prototype canvas (3 lượt, giây)

| Mẫu | Process wall | Vòng paint/pipe/encode nội bộ | Paint median | Đợi pipe median |
|---|---|---|---:|---:|
| kinetic_text | 10.235 / 2.722 / 2.495 | 4.388 / 2.514 / 2.281 | 2.065 | 0.294 |
| chart | 2.593 / 2.611 / 2.429 | 2.296 / 2.406 / 2.240 | 1.841 | 0.295 |
