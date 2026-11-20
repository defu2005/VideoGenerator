import type { FormatRecipeId } from "../formats/recipes.js";
import type { ResearchNotes } from "../schemas/script.js";

export interface StoryEngineBenchmarkFixture {
  id: string;
  topic: string;
  recipeId: FormatRecipeId;
  targetDurationSec: number;
  language: string;
  genre: string;
  research: ResearchNotes;
}

export const STORY_ENGINE_BENCHMARK_FIXTURES: StoryEngineBenchmarkFixture[] = [
  {
    id: "hist-babylon",
    topic: "Sự sụp đổ của thành Babylon cổ đại",
    recipeId: "story",
    targetDurationSec: 180,
    language: "vi",
    genre: "history",
    research: {
      summary: "Thành Babylon từng là đô thị vĩ đại nhất thế giới cổ đại trước khi thất thủ trước người Ba Tư năm 539 TCN mà gần như không tốn một mũi tên.",
      keyFacts: [
        { fact: "Babylon thất thủ vào năm 539 TCN trước quân đội vua Cyrus Đại đế của Ba Tư.", confidence: "high", sourceHint: "Biên niên sử Nabonidus" },
        { fact: "Quân Ba Tư đã nắn dòng sông Euphrates để lội qua cổng thành vào ban đêm.", confidence: "high", sourceHint: "Herodotus" },
        { fact: "Thành phố đang mải mê mở tiệc lễ hội khi quân địch tràn vào.", confidence: "medium", sourceHint: "Xenophon" },
        { fact: "Tường thành Babylon kiên cố đến mức được coi là bất khả xâm phạm thời bấy giờ.", confidence: "high", sourceHint: "Khảo cổ học Lưỡng Hà" },
        { fact: "Cyrus Đại đế ra tuyên ngôn tôn trọng tôn giáo và thả tự do cho người Do Thái lưu đày.", confidence: "high", sourceHint: "Trụ đá Cyrus" },
      ],
      timeline: [
        { date: "605 TCN", event: "Nebuchadnezzar II lên ngôi đỉnh cao đế chế" },
        { date: "539 TCN", event: "Cyrus Đại đế tiến vào Babylon" },
      ],
      angles: ["Chiến thuật nắn sông bất ngờ", "Sự chủ quan trong đêm tiệc", "Chính sách khoan hồng của Cyrus"],
      outline: [
        { section: "Mở đầu", purpose: "Giới thiệu Babylon tráng lệ và bí ẩn thất thủ", points: ["Thành phố không thể công phá", "Một đêm sụp đổ"] },
        { section: "Chiến thuật", purpose: "Kế sách nắn dòng sông Euphrates", points: ["Bí mật đào kênh", "Lội nước cạn vào thành"] },
        { section: "Kết cục", purpose: "Sự đổi thay vương triều và bài học lịch sử", points: ["Cyrus tha chết cho dân", "Tàn tích hôm nay"] },
      ],
      cautions: ["Tránh nhầm lẫn giữa Cyrus Đại đế và Darius"],
    },
  },
  {
    id: "sci-quantum-enc",
    topic: "How Quantum Computers Break Modern Encryption",
    recipeId: "explainer",
    targetDurationSec: 60,
    language: "en",
    genre: "science",
    research: {
      summary: "Quantum computers utilize Shor's algorithm to solve prime factorization in polynomial time, threatening RSA encryption.",
      keyFacts: [
        { fact: "RSA encryption relies on the extreme difficulty of factoring large prime numbers for classical computers.", confidence: "high", sourceHint: "MIT Technology Review" },
        { fact: "Peter Shor developed Shor's algorithm in 1994, showing quantum qubits could factor integers exponentially faster.", confidence: "high", sourceHint: "SIAM Journal on Computing" },
        { fact: "A quantum computer would need thousands of logical, error-corrected qubits to break 2048-bit RSA.", confidence: "high", sourceHint: "NIST Quantum Report" },
        { fact: "Post-quantum cryptography (PQC) standards are already being standardized by NIST to replace vulnerable algorithms.", confidence: "high", sourceHint: "NIST PQC Standards" },
        { fact: "Symmetric encryption like AES-256 remains largely safe against Grover's algorithm by doubling key sizes.", confidence: "medium", sourceHint: "Quantum Computing Hardware Review" },
      ],
      timeline: [
        { date: "1994", event: "Shor publishes quantum factoring algorithm" },
        { date: "2024", event: "NIST releases first post-quantum standards" },
      ],
      angles: ["The ticking clock on RSA", "Qubits vs binary bits", "How post-quantum math saves data"],
      outline: [
        { section: "Hook & Problem", purpose: "Show how all online secrets depend on prime math", points: ["RSA locks the internet", "Quantum can pick it"] },
        { section: "The Mechanism", purpose: "Explain superposition and Shor's algorithm simply", points: ["Qubits test combinations at once", "Factoring in minutes"] },
        { section: "The Solution", purpose: "Explain lattice cryptography and NIST's defensive response", points: ["Lattice math is quantum-proof", "The migration begins"] },
      ],
      cautions: ["Clarify that current quantum machines cannot yet break RSA today"],
    },
  },
  {
    id: "list-mars-facts",
    topic: "5 sự thật kỳ lạ về sao Hỏa mà sách giáo khoa chưa kể",
    recipeId: "listicle",
    targetDurationSec: 60,
    language: "vi",
    genre: "science",
    research: {
      summary: "Sao Hỏa chứa đựng những kỷ lục địa chất và hiện tượng thời tiết kỳ thú vượt xa trí tưởng tượng thông thường.",
      keyFacts: [
        { fact: "Núi lửa Olympus Mons trên sao Hỏa cao gấp gần 3 lần đỉnh Everest và rộng bằng cả nước Pháp.", confidence: "high", sourceHint: "NASA Mars Missions" },
        { fact: "Hoàng hôn trên sao Hỏa có màu xanh lam do bụi mịn trong bầu khí quyển tán xạ ánh sáng.", confidence: "high", sourceHint: "Curiosity Rover Data" },
        { fact: "Hẻm núi Valles Marineris dài gấp 4 lần và sâu gấp 5 lần Grand Canyon của Trái Đất.", confidence: "high", sourceHint: "ESA Mars Express" },
        { fact: "Trọng lực trên sao Hỏa chỉ bằng 38% trọng lực Trái Đất, bạn có thể nhảy cao gần gấp 3 lần.", confidence: "high", sourceHint: "Hành tinh học so sánh" },
        { fact: "Sao Hỏa thường xuyên hứng chịu những cơn bão bụi khổng lồ bao trùm toàn bộ bề mặt hành tinh.", confidence: "medium", sourceHint: "NASA Mars Reconnaissance Orbiter" },
      ],
      timeline: [
        { date: "1971", event: "Mariner 9 chụp ảnh núi lửa Olympus Mons" },
        { date: "2015", event: "Curiosity chụp hoàng hôn màu xanh lam" },
      ],
      angles: ["Kỷ lục vượt Trái Đất", "Cảnh tượng quang học kỳ thú", "Cảm giác con người khi đặt chân đến"],
      outline: [
        { section: "Mở đầu", purpose: "Giới thiệu hành tinh Đỏ với những điều bất ngờ", points: ["Không chỉ là sa mạc cát đỏ", "5 bất ngờ lớn"] },
        { section: "Danh sách", purpose: "Điểm qua 5 kỷ lục địa chất và thời tiết", points: ["Núi lửa khổng lồ", "Hoàng hôn màu xanh lam", "Bão bụi toàn cầu"] },
        { section: "Kết luận", purpose: "Lời mời gọi khám phá tương lai", points: ["Ngôi nhà thứ hai của nhân loại"] },
      ],
      cautions: ["Nhấn mạnh nước ở dạng băng hoặc ngầm, không có sông mở hiện tại"],
    },
  },
  {
    id: "story-alcatraz",
    topic: "Cuộc đào tẩu huyền thoại khỏi nhà tù Alcatraz",
    recipeId: "story",
    targetDurationSec: 180,
    language: "vi",
    genre: "history",
    research: {
      summary: "Năm 1962, ba tù nhân đã dùng thìa và áo mưa để thực hiện cuộc vượt ngục chấn động khỏi nhà tù kiên cố nhất nước Mỹ.",
      keyFacts: [
        { fact: "Frank Morris cùng hai anh em John và Clarence Anglin trốn khỏi Alcatraz đêm 11 tháng 6 năm 1962.", confidence: "high", sourceHint: "Hồ sơ FBI Alcatraz" },
        { fact: "Họ dùng thìa kim loại và lưỡi cưa tự chế để khoét thủng lỗ thông hơi trong buồng giam suốt nhiều tháng.", confidence: "high", sourceHint: "Bảo tàng Alcatraz" },
        { fact: "Các tù nhân làm hình nộm bằng thạch cao, tóc thật và màu vẽ đặt lên giường đánh lừa lính canh.", confidence: "high", sourceHint: "Báo cáo khám nghiệm nhà tù" },
        { fact: "Họ ghép hơn 50 chiếc áo mưa cao su thành bè cứu sinh và áo phao để vượt vịnh San Francisco.", confidence: "high", sourceHint: "Hiện vật FBI thu giữ" },
        { fact: "Cho đến nay tung tích ba người vẫn là bí ẩn chưa có lời giải chính thức.", confidence: "high", sourceHint: "Lệnh truy nã Cảnh sát Tư pháp Hoa Kỳ" },
      ],
      timeline: [
        { date: "Tháng 12/1961", event: "Kế hoạch vượt ngục bắt đầu được chuẩn bị" },
        { date: "11/06/1962", event: "Ba tù nhân biến mất vào màn đêm" },
      ],
      angles: ["Sự kiên nhẫn phi thường", "Hình nộm đánh lừa lính gác", "Bí ẩn sống sót giữa dòng nước lạnh"],
      outline: [
        { section: "Pháo đài bất khả", purpose: "Mô tả nhà tù Alcatraz và ý đồ đào tẩu", points: ["Không ai có thể trốn thoát", "Kế hoạch của Morris"] },
        { section: "Đêm vượt ngục", purpose: "Từng bước bò qua lỗ thông hơi lên mái nhà", points: ["Hình nộm ngủ say", "Bè áo mưa bơm hơi"] },
        { section: "Bí ẩn thế kỷ", purpose: "Dấu vết sót lại và câu hỏi liệu họ còn sống", points: ["Mảnh bè trên vịnh", "Bí ẩn chưa có hồi kết"] },
      ],
      cautions: ["Không khẳng định chắc chắn họ đã chết đuối hay đã trốn thoát thành công"],
    },
  },
  {
    id: "news-jwst-exoplanet",
    topic: "Khám phá mới về hành tinh ngoài hệ mặt trời từ kính James Webb",
    recipeId: "news_recap",
    targetDurationSec: 60,
    language: "vi",
    genre: "news",
    research: {
      summary: "Kính viễn vọng James Webb phát hiện dấu hiệu hóa học tiềm năng về sự sống trong khí quyển của ngoại hành tinh K2-18b.",
      keyFacts: [
        { fact: "K2-18b cách Trái Đất khoảng 120 năm ánh sáng, nằm trong vùng có thể sống được quanh sao lùn đỏ.", confidence: "high", sourceHint: "NASA JWST Science Release" },
        { fact: "Kính James Webb phát hiện dấu vết carbon dioxide và methane phong phú trong bầu khí quyển.", confidence: "high", sourceHint: "The Astrophysical Journal Letters" },
        { fact: "Các nhà khoa học ghi nhận khả năng xuất hiện dimethyl sulfide (DMS), chất trên Trái Đất chỉ do sinh vật sống tạo ra.", confidence: "medium", sourceHint: "Đại học Cambridge nghiên cứu" },
        { fact: "K2-18b được phân loại là hành tinh Hycean với đại dương bao phủ dưới khí quyển giàu hydro.", confidence: "high", sourceHint: "Mô hình khí quyển ngoại hành tinh" },
        { fact: "NASA nhấn mạnh cần thêm các đợt quan sát để xác thực 100% tín hiệu DMS.", confidence: "high", sourceHint: "Họp báo NASA" },
      ],
      timeline: [
        { date: "2019", event: "Hubble phát hiện hơi nước sơ khai trên K2-18b" },
        { date: "2023", event: "JWST phát hiện methane và dấu hiệu DMS" },
      ],
      angles: ["Dấu hiệu sinh học ngoài hệ Mặt Trời", "Thế giới đại dương Hycean", "Sức mạnh quang phổ của James Webb"],
      outline: [
        { section: "Bản tin chấn động", purpose: "Thông báo phát hiện phân tử sinh học", points: ["Tín hiệu từ 120 năm ánh sáng", "Kính James Webb lập công"] },
        { section: "Hành tinh Hycean", purpose: "Mô tả đại dương và khí quyển của K2-18b", points: ["Nước lỏng và khí hydro", "Phân tử DMS do vi sinh vật"] },
        { section: "Triển vọng", purpose: "Chờ đợi bằng chứng xác thực dứt khoát", points: ["Bước ngoặt tìm kiếm sự sống"] },
      ],
      cautions: ["Phải nêu rõ DMS mới chỉ là tín hiệu tiềm năng, chưa kết luận tìm thấy sự sống"],
    },
  },
  {
    id: "sci-dark-energy",
    topic: "The Mystery of Dark Energy Expanding the Universe",
    recipeId: "explainer",
    targetDurationSec: 180,
    language: "en",
    genre: "science",
    research: {
      summary: "Dark energy makes up roughly 68% of the universe and drives its accelerated expansion, yet its fundamental nature remains completely unknown.",
      keyFacts: [
        { fact: "In 1998, astronomers studying Type Ia supernovae discovered the universe's expansion is accelerating.", confidence: "high", sourceHint: "Nobel Prize in Physics 2011 citation" },
        { fact: "Dark energy constitutes approximately 68.3% of the total energy density of the observable cosmos.", confidence: "high", sourceHint: "Planck Space Telescope data" },
        { fact: "Einstein's cosmological constant lambda is the simplest mathematical candidate for dark energy.", confidence: "high", sourceHint: "General Relativity textbooks" },
        { fact: "Quantum field theory predicts vacuum energy that is roughly 120 orders of magnitude larger than observed.", confidence: "high", sourceHint: "Vacuum Catastrophe problem in physics" },
        { fact: "Alternative theories suggest quintessence, a dynamic scalar field that changes over cosmic time.", confidence: "medium", sourceHint: "Cosmology review papers" },
      ],
      timeline: [
        { date: "1929", event: "Edwin Hubble discovers cosmic expansion" },
        { date: "1998", event: "Accelerated expansion confirmed by Supernova teams" },
      ],
      angles: ["The 120-orders-of-magnitude error", "Cosmic fate: Big Freeze or Big Rip", "The invisible majority of our universe"],
      outline: [
        { section: "The Surprise", purpose: "Show how galaxies are flying apart faster and faster", points: ["Gravity was expected to slow things down", "Instead it speeds up"] },
        { section: "The Ghost in the Equations", purpose: "Explain Einstein's cosmological constant and quantum vacuum failure", points: ["Empty space has energy", "Worst prediction in physics"] },
        { section: "The Future of Everything", purpose: "Contrast eternal cold expansion with cosmic tearing", points: ["Dark skies in trillions of years", "The hunt for new physics"] },
      ],
      cautions: ["Distinguish dark energy (expansion) from dark matter (gravitational binding)"],
    },
  },
  {
    id: "bio-tesla",
    topic: "Nikola Tesla: Thiên tài cô độc và cuộc chiến dòng điện",
    recipeId: "story",
    targetDurationSec: 180,
    language: "vi",
    genre: "biography",
    research: {
      summary: "Nikola Tesla đã kiến tạo nền tảng lưới điện xoay chiều hiện đại, bất chấp những đòn cạnh tranh khốc liệt từ Thomas Edison.",
      keyFacts: [
        { fact: "Tesla phát minh động cơ cảm ứng và hệ thống phân phối điện xoay chiều (AC) đa pha.", confidence: "high", sourceHint: "Bằng sáng chế Hoa Kỳ số 381968" },
        { fact: "Cuộc chiến dòng điện nổ ra giữa dòng điện một chiều (DC) của Edison và dòng điện xoay chiều (AC) của Tesla - Westinghouse.", confidence: "high", sourceHint: "Lịch sử công nghiệp Hoa Kỳ" },
        { fact: "Hệ thống AC của Tesla đã thắp sáng Hội chợ Thế giới Chicago 1893 và nhà máy thủy điện thác Niagara.", confidence: "high", sourceHint: "Tài liệu lưu trữ Westinghouse" },
        { fact: "Tesla đã tự tay xé hợp đồng tiền bản quyền hàng triệu USD với George Westinghouse để cứu công ty khỏi phá sản.", confidence: "medium", sourceHint: "Hồi ký và tiểu sử Tesla" },
        { fact: "Ông qua đời trong cảnh bần hàn và cô độc tại khách sạn New Yorker năm 1943 ở tuổi 86.", confidence: "high", sourceHint: "Cáo phó New York Times" },
      ],
      timeline: [
        { date: "1888", event: "Tesla cấp phép bằng sáng chế AC cho Westinghouse" },
        { date: "1893", event: "Hội chợ Chicago tỏa sáng bằng điện AC" },
        { date: "1943", event: "Tesla qua đời tại New York" },
      ],
      angles: ["Cuộc đấu trí với Edison", "Sự hào hiệp làm mất tài sản", "Tầm nhìn vượt trước thời đại 100 năm"],
      outline: [
        { section: "Tia sét thiên tài", purpose: "Giới thiệu chàng trai nhập cư và ý tưởng dòng điện xoay chiều", points: ["Giấc mơ thác Niagara", "Edison gạt bỏ"] },
        { section: "Cuộc chiến dòng điện", purpose: "Đỉnh cao đối đầu giữa AC và DC", points: ["Chiến dịch bôi nhọ", "Chiến thắng ở Chicago"] },
        { section: "Di sản bất tử", purpose: "Cái chết cô độc và thế giới hiện đại mang ơn ông", points: ["Từ bỏ tiền bản quyền", "Nguồn điện thắp sáng mọi nhà"] },
      ],
      cautions: ["Tránh thổi phồng các thuyết âm mưu về tia chết hoặc người ngoài hành tinh"],
    },
  },
  {
    id: "manga-aot-secrets",
    topic: "3 chi tiết ẩn trong Attack on Titan bị bỏ qua",
    recipeId: "listicle",
    targetDurationSec: 60,
    language: "vi",
    genre: "culture",
    research: {
      summary: "Bộ truyện Attack on Titan chứa nhiều chi tiết cài cắm tinh vi ngay từ tập đầu tiên báo trước toàn bộ cái kết.",
      keyFacts: [
        { fact: "Tựa đề tập 1 'Gửi bạn, 2000 năm sau' liên kết trực tiếp với Ymir và tập 122 'Từ bạn, 2000 năm trước'.", confidence: "high", sourceHint: "Manga Shingeki no Kyojin vol 1 & 30" },
        { fact: "Giấc mơ của Eren dưới gốc cây ở chap 1 đã hé lộ hình bóng khăn quàng và cái chết của chính mình.", confidence: "high", sourceHint: "Phân tích khung hình Hajime Isayama" },
        { fact: "Hình bóng chim hải âu và chim bồ câu xuất hiện liên tục mỗi khi các nhân vật đưa ra quyết định về tự do.", confidence: "medium", sourceHint: "Họa tiết biểu tượng trong anime" },
        { fact: "Tác giả Isayama đã lên kế hoạch chi tiết cho kết thúc từ trước khi anime mùa đầu tiên phát sóng.", confidence: "high", sourceHint: "Phỏng vấn Bessatsu Shonen Magazine" },
        { fact: "Tên các bức tường Maria, Rose, Sina tương ứng với ba người con gái của Thủy tổ Ymir.", confidence: "high", sourceHint: "Cốt truyện chính thức" },
      ],
      timeline: [
        { date: "2009", event: "Manga bắt đầu đăng tải chap đầu tiên" },
        { date: "2021", event: "Manga chính thức kết thúc ở chap 139" },
      ],
      angles: ["Vòng lặp 2000 năm", "Hình bóng dưới gốc cây", "Ý nghĩa tên 3 bức tường"],
      outline: [
        { section: "Mở đầu", purpose: "Gợi sự tò mò về tài cài cắm của Isayama", points: ["Không có chi tiết thừa", "3 manh mối chấn động"] },
        { section: "3 Chi tiết", purpose: "Phân tích từng chi tiết từ tập 1 đến tập cuối", points: ["Tựa đề 2000 năm", "Giấc mơ dưới gốc cây", "3 cô con gái"] },
        { section: "Đánh giá", purpose: "Tổng kết sự chặt chẽ của kịch bản", points: ["Đỉnh cao xây dựng thế giới"] },
      ],
      cautions: ["Cảnh báo tiết lộ trước nội dung (spoiler) nhẹ cho khán giả chưa xem hết"],
    },
  },
  {
    id: "cult-ramen-origins",
    topic: "The Origins and Secret Alchemy of Traditional Japanese Ramen",
    recipeId: "explainer",
    targetDurationSec: 600,
    language: "en",
    genre: "culture",
    research: {
      summary: "How a humble Chinese wheat noodle dish evolved into Japan's master culinary craft spanning five foundational broth disciplines.",
      keyFacts: [
        { fact: "Ramen originated in Yokohama Chinatown in the late 19th century as 'Shina Soba' before Japanese adaptation.", confidence: "high", sourceHint: "Shin-Yokohama Ramen Museum records" },
        { fact: "Kansui, an alkaline mineral water solution, gives ramen noodles their signature yellow hue, springiness, and chew.", confidence: "high", sourceHint: "Food Chemistry and Gastronomy Studies" },
        { fact: "The four classic broth bases are Shoyu (soy sauce), Shio (salt), Miso (fermented paste), and Tonkotsu (pork bone).", confidence: "high", sourceHint: "Japanese Culinary Institute" },
        { fact: "Tonkotsu broth achieves its creamy milky consistency through hours of boiling bones to emulsify marrow fats and collagen.", confidence: "high", sourceHint: "Master Chefs of Fukuoka documentation" },
        { fact: "Tare (the concentrated seasoning base) and aroma oil (Koyu) are layered into the bowl before broth is poured.", confidence: "high", sourceHint: "Ramen formulation manual" },
      ],
      timeline: [
        { date: "1910", event: "Rairaiken opens in Tokyo, introducing modern Tokyo-style shoyu ramen" },
        { date: "1958", event: "Momofuku Ando invents instant ramen" },
      ],
      angles: ["The science of Kansui alkaline noodles", "Tare + Broth + Oil architecture", "From post-war survival to Michelin stars"],
      outline: [
        { section: "The Soul in a Bowl", purpose: "Deconstruct the myth and global love for ramen", points: ["More than fast food", "Architecture of taste"] },
        { section: "The Five Pillars", purpose: "Break down Broth, Tare, Oil, Noodles, and Toppings", points: ["Emulsifying bone marrow", "The magic of Kansui"] },
        { section: "Regional Masters", purpose: "Journey from Sapporo miso to Hakata tonkotsu", points: ["Geography shaping flavor", "Craftsmanship and obsession"] },
        { section: "Philosophy", purpose: "The culinary discipline of continuous perfection (Kaizen)", points: ["A lifetime to master a single broth"] },
      ],
      cautions: ["Differentiate authentic Japanese craftsmanship from instant noodle packets"],
    },
  },
  {
    id: "hist-terracotta-mercury",
    topic: "Bí ẩn lăng mộ Tần Thủy Hoàng và dòng sông thủy ngân",
    recipeId: "story",
    targetDurationSec: 600,
    language: "vi",
    genre: "history",
    research: {
      summary: "Sau hơn hai thiên niên kỷ, lăng mộ của vị hoàng đế đầu tiên Trung Hoa vẫn chưa bao giờ được khai quật hoàn chỉnh vì cạm bẫy và biển thủy ngân.",
      keyFacts: [
        { fact: "Sử ký Tư Mã Thiên ghi nhận trong lăng mộ có mô hình mô phỏng thiên hạ với sông biển bằng thủy ngân chảy cơ học.", confidence: "high", sourceHint: "Sử ký - Tần Thủy Hoàng bản kỷ" },
        { fact: "Các đo đạc địa hóa hiện đại phát hiện nồng độ hơi thủy ngân trên đỉnh gò lăng mộ cao gấp hàng chục lần mức tự nhiên.", confidence: "high", sourceHint: "Viện Hàn lâm Khoa học Trung Quốc" },
        { fact: "Đội quân đất nung hơn 8000 chiến binh được phát hiện năm 1974 chỉ là một phần nhỏ bên ngoài vành đai lăng mộ.", confidence: "high", sourceHint: "Bảo tàng Lăng mộ Tần Thủy Hoàng" },
        { fact: "Màu sơn nguyên bản của tượng đất nung bị oxy hóa và bong tróc chỉ vài phút sau khi tiếp xúc với không khí.", confidence: "high", sourceHint: "Báo cáo bảo tồn khảo cổ Thiểm Tây" },
        { fact: "Chính phủ Trung Quốc quyết định tạm dừng khai quật gian hầm chính cho đến khi có công nghệ bảo tồn tuyệt đối.", confidence: "high", sourceHint: "Cục Di sản Văn hóa Quốc gia Trung Quốc" },
      ],
      timeline: [
        { date: "210 TCN", event: "Tần Thủy Hoàng băng hà và được an táng" },
        { date: "1974", event: "Nông dân đào giếng phát hiện đội quân đất nung" },
      ],
      angles: ["Sử ký và kiểm chứng khoa học", "Cạm bẫy nỏ tự động và hơi độc thủy ngân", "Lý do nhân loại chưa dám mở cửa hầm chính"],
      outline: [
        { section: "Đế vương bất tử", purpose: "Khát vọng trường sinh và việc xây dựng lăng mộ từ năm 13 tuổi", points: ["70 vạn nhân công", "Bản thiết kế dưới lòng đất"] },
        { section: "Dòng sông chết chóc", purpose: "Khảo sát nồng độ thủy ngân và lời chứng của Tư Mã Thiên", points: ["Hơi độc bao phủ", "Bản đồ thiên hạ dưới lòng đất"] },
        { section: "Đội quân canh gác", purpose: "Ý nghĩa của 8000 chiến binh đất nung và bi kịch mất màu", points: ["Mỗi khuôn mặt một dáng vẻ", "Bài học bảo tồn"] },
        { section: "Cánh cửa khép chặt", purpose: "Vì sao lăng mộ chính vẫn sẽ ngủ yên thêm nhiều thế hệ", points: ["Tôn trọng lịch sử", "Chờ đợi công nghệ tương lai"] },
      ],
      cautions: ["Tránh khẳng định có quái vật hay bùa chú siêu nhiên, chỉ bám sát ghi chép lịch sử và khảo sát địa hóa"],
    },
  },
];
