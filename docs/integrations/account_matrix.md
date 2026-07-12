# Production Account Registry: Rent A Coat & GO Mall

This file is the non-secret production registry for digital channels, tracking IDs, ad platforms, and API configuration references. Never store Channel Secrets, private keys, bearer tokens, or PAT values in this file.

## Account Matrix

| Brand | Business Unit | Branch | Platform | Account Name | ID Type | Account ID | URL | Owner | API Access | Permission | Secret Reference | Status | Migration Risk | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rent A Coat | Website | Main | Web Core | rentacoat.com | URL | `https://www.rentacoat.com` | https://www.rentacoat.com | Company | Active | Owner | N/A | Active | Low | Main website |
| GO Mall | Website | Main | Web Core | gomall.fashion | URL | `https://gomall.fashion` | https://gomall.fashion | Company | Active | Owner | N/A | Active | Low | Main website |
| Rent A Coat | Analytics | Main | GTM | Rent A Coat GTM | Container ID | `GTM-WXBWB59L` | - | Company | Active | Owner | N/A | Active | Low | IHAF plugin |
| GO Mall | Analytics | Main | GTM | GO Mall GTM | Container ID | `GTM-MF39N7WD` | - | Company | Active | Owner | N/A | Active | Low | Site Kit |
| Rent A Coat | Analytics | Main | GA4 | Rent A Coat Stream | Measurement ID | `G-9FJLGYT3N2` | - | Company | Active | Loaded via GTM | N/A | Active | Low | Stream ID `3479705535` |
| Rent A Coat | Analytics | Main | GA4 | Rent A Coat Property | Property ID | `313035476` | - | Company | Active | Owner | N/A | Active | Low | Numeric property ID |
| GO Mall | Analytics | Main | GA4 | GO Mall Stream | Measurement ID | `G-QLHRK4P2HS` | - | Company | Active | Loaded via GTM | N/A | Active | Low | Stream ID `12928906320` |
| GO Mall | Analytics | Main | GA4 | GO Mall Property | Property ID | `511801068` | - | Company | Active | Owner | N/A | Active | Low | Numeric property ID |
| Rent A Coat | SEO | Main | GSC | Rent A Coat Search | Property URL | `https://www.rentacoat.com/` | - | Company | API Active | siteFullUser | `gsc-private-key.json` | Active | Low | Search Console |
| GO Mall | SEO | Main | GSC | GO Mall Search | Property URL | `https://gomall.fashion/` | - | Company | API Active | siteFullUser | `gsc-private-key.json` | Active | Low | Search Console |
| Rent A Coat | Marketing | Main | Google Ads | Rent A Coat Tags | Tag / Conversion ID | `AW-16815269326` / `AW-10899011092` | - | Company | Active | Loaded via GTM | N/A | Active | Low | Conversion tags |
| Rent A Coat | Marketing | Main | Google Ads | Rent A Coat Ads Account | Customer ID | `888-950-6623` | - | Company | Active | Owner | N/A | Active | Low | Customer account |
| GO Mall | Marketing | Main | Google Ads | GO Mall Ads Account | Customer ID | `627-054-8325` | - | Company | Active | Owner | N/A | Active | Low | Customer account |
| Brandname Market | Marketing | Main | Google Ads | Manager Account | MCC Login ID | `218-829-6866` | - | Company | API Active | Owner | `googlesitekit_ads_settings` | Active | Low | Manager account |
| GO Mall | Marketing | Main | Google Ads | GO Mall Conversion | Conversion ID | `AW-17776629882` / `AW-17363835681` | - | Company | Active | Site Kit | N/A | Active | Low | Conversion tags |
| Rent A Coat | Local SEO | Vibhavadi | GBP | Rent A Coat วิภาวดี | Location ID | `4491824503494065306` | - | Company | Active | Owner | N/A | Active | High | High-value legacy location |
| Rent A Coat | Local SEO | Rama 9-Ratchada | GBP | Rent A Coat พระราม 9 | Location ID | `10256589618793598923` | - | Company | Active | Owner | N/A | Active | Low | Current location |
| GO Mall | Local SEO | Rama 9 | GBP | GoMall ร้านหลัก | Location ID | `7388636764878895753` | - | Company | Active | Owner | N/A | Active | Low | Current location |
| Rent A Coat | Social | Main | Facebook | rentacoatbkk | Page ID | `1685021191816839` | https://www.facebook.com/rentacoatbkk | Company | Active | Owner | N/A | Active | Low | - |
| GO Mall | Social | Main | Facebook | Gomallth | Page ID | `43880842639502` | https://www.facebook.com/Gomallth | Company | Active | Owner | N/A | Active | Low | - |
| Winterra | Social | Main | Facebook | Winterra | Page ID | `99171410694657` | - | Company | Active | Owner | N/A | Active | Low | Launch account |
| Rent A Coat | Social | Main | Instagram | rentacoatbkk | Business Account ID | `3974064429` | https://www.instagram.com/rentacoatbkk | Company | Active | Owner | N/A | Active | Low | - |
| GO Mall | Social | Main | Instagram | gomall_th | Business Account ID | `70110832646` | https://www.instagram.com/gomall_th | Company | Active | Owner | N/A | Active | Low | - |
| Rent A Coat | Marketing | Main | Meta Business | Rent A Coat Portfolio | Business Portfolio ID | `1581062245791402` | - | Company | Active | Owner | N/A | Active | Low | - |
| Rent A Coat | Marketing | Main | Meta Ads | Rent A Coat Ads Account | Ad Account ID | `ไม่มี (Agency ยิง)` | - | Agency | Organic only | No access | N/A | Active | High | Agency-managed paid media |
| GO Mall | Marketing | Main | Meta Ads | GO Mall Ads Account | Ad Account ID | `471767525213471` | - | Company | Active | Owner | N/A | Active | Low | Account name `mkt rac` |
| Rent A Coat | Marketing | Main | TikTok | Rent A Coat BC | Business Center ID | `7245126659546939394` | - | Company | Active | Owner | N/A | Active | Low | - |
| Rent A Coat | Marketing | Main | TikTok | Rent A Coat Ads | Ad Account ID | `7245294214857129985` | - | Company | Active | Owner | N/A | Active | Low | - |
| GO Mall | Marketing | Main | TikTok | GO Mall BC | Business Center ID | `7459240755937460240` | - | Company | Active | Owner | N/A | Active | Low | - |
| GO Mall | Marketing | Main | TikTok | GO Mall Ads | Ad Account ID | `7533483786189832193` | - | Company | Active | Owner | N/A | Active | Low | - |
| Rent A Coat | Social | Main | LINE | @Rentacoat | LINE OA ID | `@Rentacoat` | https://line.me/ti/p/~@Rentacoat | Company | Active | Owner | N/A | Active | Low | - |
| GO Mall | Social | Main | LINE | @gomall | LINE OA ID | `@gomall` | https://line.me/ti/p/~@gomall | Company | Active | Owner | N/A | Active | Low | - |
| Rent A Coat | Messaging | Main | LINE | Rent A Coat Login | Channel ID | `1660662825` | - | Company | Active | Owner | `LINE_CHANNEL_SECRET_RAC` / `LINE_CHANNEL_ACCESS_TOKEN_RAC` / `LINE_PROVIDER_ID_RAC` | Active | Low | - |
| GO Mall | Messaging | Main | LINE | GO Mall Login | Channel ID | `2006768650` | - | Company | Active | Owner | `LINE_CHANNEL_SECRET_GOMALL` / `LINE_CHANNEL_ACCESS_TOKEN_GOMALL` / `LINE_PROVIDER_ID_GOMALL` | Active | Low | - |
| Shared | Data Integration | Main | Airtable | Brandname Marketing | PAT & Base IDs | `[Referenced in .env.airtable.local]` | https://airtable.com | Company | Active | Owner | `AIRTABLE_PAT` / `AIRTABLE_BASE_IDS` | Active | Low | Airtable is operational source of truth |

## Production Gaps

- Rent A Coat Meta Ads is agency-managed; paid-media API access is not available locally.
- Meta Business Manager/App ID still needs confirmation if a custom connector will be used.
- TikTok Access Token still needs to be created through OAuth and stored as a secret reference.
- LINE credentials must exist in the project-local environment or Secret Manager; never place values in this registry.
- Verify that the Google Ads IDs are correctly classified as Manager Customer ID, Customer ID, Conversion ID, and Tag ID.

## Secret Handling

This file contains identifiers and variable names only. Keep all secrets in project-local ignored environment files or a production Secret Manager. Do not commit `.env*`, private keys, bearer tokens, or channel secrets.
