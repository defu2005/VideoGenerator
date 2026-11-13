# Danh mục thay đổi bên ngoài

Các detector D1–D7 là điểm tích hợp theo guide. Trong 073a dùng kiểm tra thủ công. R0–R5 là mức phản ứng mặc định, chưa tự thực thi.

| ID | Nhóm | Kind | Detector | Phản ứng thấp/vừa/cao |
|---|---|---|---|---|
| A1 | Content and community policy | guideline_pack, law | D1, D3, D7, manual | R0 / R1 / R2 |
| A2 | Monetization programs | monetization_program | D1, D3, D7, manual | R0 / R1 / R2 |
| A3 | Originality, AI and automation policy | guideline_pack, creator_tactic | D1, D3, D4, manual | R0 / R1 / R2 |
| A4 | Ad suitability and brand safety | guideline_pack | D1, D3, manual | R0 / R1 / R2 |
| A5 | Rights and licensing | guideline_pack, provider_terms | D1, D2, D3, manual | R0 / R1 / R2 |
| A6 | Audience-specific rules | guideline_pack, law | D1, D7, manual | R0 / R1 / R2 |
| B1 | Format and metadata specs | platform_capability | D1, D2, manual | R0 / R1 / R2 |
| B2 | Platform APIs | platform_capability, api_contract | D1, D2, manual | R0 / R1 / R2 |
| B3 | Platform features | platform_capability | D1, D2, manual | R0 / R1 / R2 |
| B4 | Ranking and recommendation | creator_tactic | D4, D5, exploration, manual | R0 / R1 / R2 |
| B5 | Platform availability and rise/decline | market, platform_capability | D1, D5, D7, manual | R0 / R1 / R2 |
| C1 | Audience behaviour | market | D4, exploration, manual | R0 / R1 / R2 |
| C2 | Topics, formats, niches | — | D5, D4, exploration, manual | R0 / R1 / R2 |
| C3 | Calendar and news | market | D5, D1, manual | R0 / R1 / R2 |
| C4 | Ad market and money | market, monetization_program | D3, D1, D6, manual | R0 / R1 / R2 |
| C5 | Local law | market, law | D1, D6, D7, manual | R0 / R1 / R2 |
| D1 | LLM providers | provider_terms | D2, provider_intel, manual | R0 / R1 / R2 |
| D2 | TTS, footage, image and music sources | provider_terms | D1, D2, D6, manual | R0 / R1 / R2 |
| D3 | Tools and dependencies | dependency | D2, D6, D7, manual | R0 / R1 / R2 |
| E1 | Account health | account_policy | D3, D2, manual | R0 / R1 / R2 |
| E2 | Video health | — | D3, manual | R0 / R1 / R2 |
| E3 | Channel milestones | monetization_program | D3, manual | R0 / R1 / R2 |
| E4 | Unexplained performance change | — | D4, manual | R0 / R5 / R5 |
| F1 | Our cost and budget | provider_terms | D2, provider_intel, manual | R0 / R1 / R2 |
| F2 | The user's goals | — | D7, settings, manual | R0 / R1 / R2 |
| G1 | Knowledge quality | — | D1, D4, D6, manual | R0 / R1 / R2 |
| B6 | Data meaning changes, schema stays | api_contract | D1, D2, manual | R0 / R1 / R1 |
| B7 | Alias or upstream changes while requests still work | api_contract, provider_terms | D1, D4, provider_intel, manual | R0 / R2 / R2 |
| B8 | Quota units or buckets change | api_contract | D1, D2, manual | R0 / R4 / R4 |
| D4 | New sign-ups or one account group lose access | api_contract, provider_terms, dependency | D1, D7, manual | R0 / R1 / R1 |
| E5 | Consent or scope migration | api_contract, account_policy | D1, D2, D7, manual | R0 / R2 / R2 |
| G2 | A source changes how it is reached, data still exists | api_contract | D1, D6, manual | R0 / R2 / R2 |
