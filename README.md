# 📣 ShoutYourBet

Sesli trade **kaos odaları**. Borsa bağlantısı yok, gerçek para yok — insanlar coin/endeks odalarında
sesli konuşur, LONG/SHORT bağırır, soundboard çalar, emoji yağdırır; fiyat sert oynayınca oda alarm verir.
Amaç: komedi, kaos, sohbet, eğlence.

## Neler var (Faz 1)
- **Lobi**: 10 sabit kaos odası (BTC, ETH, SOL, XRP, DOGE, Nasdaq 100, S&P 500, BIST 100, DXY, Altın) canlı fiyatla, kullanıcı odaları, oda açma (açık mikrofon / sahne modu), günlük skor tablosu.
- **Oda**: LiveKit ile sesli sohbet, konuşanın avatarı titrer, TradingView grafiği, kaos-metre.
- **🐂 LONG! / 🐻 SHORT!**: sunucu o anki fiyatı kaydeder, odada dev banner çıkar. `SHOUT_HORIZON_SEC` (varsayılan 15 dk) sonra puanlanır: "🎯 kâhin" ya da "💀 REKT".
- **Soundboard** (korna, REKT, aya!, kasa, ağla, alkış, siren, boing) — ElevenLabs ile üretilmiş kısa efektler (`apps/web/public/sfx`), yüklenemezse WebAudio yedeği.
- **Emoji yağmuru** 🚀💀🐻🐂🤡🔥😂🩸
- **Ani hareket alarmı**: 60 sn içinde enstrümana özel eşik aşılırsa (kripto ~%1, endeks ~%0.5) siren + ekran sarsıntısı + flaş.
- **Sahne modu**: host el kaldıranları sahneye alır/indirir, atar. Herkes istediğini sadece kendisi için susturabilir.
- LiveKit anahtarı yoksa da oda açılır: ses hariç her şey (efektler, bağırmalar, alarm, skor) SSE üzerinden çalışır.

## Mimari
```
apps/api      Fastify — LiveKit token, odalar, fiyatlar (SSE), alarm motoru, skorlama
apps/web      Next.js 15 — lobi + oda (LiveKit React bileşenleri)
packages/shared  enstrüman listesi, data-mesaj protokolü, soundboard listesi
db/schema.sql        PostgreSQL şeması (API açılışta kendisi uygular)
```
- İstemci → oda mesajları (SFX, REACT, RAISE_HAND) LiveKit data kanalı ile gider.
- Sunucu → oda mesajları (SHOUT, RESULT, ALARM) LiveKit `sendData` ile, LiveKit yoksa `/rooms/:name/events` SSE ile gider.
- Fiyat: `PRICE_MODE=live` → Binance WebSocket (kripto) + Yahoo Finance polling (endeks, gecikmeli). `PRICE_MODE=mock` → pump/dump'lı rastgele yürüyüş (offline geliştirme).
- Yeni coin/endeks eklemek = `packages/shared/src/instruments.ts` içine bir satır.

## Çalıştırma
```bash
pnpm install
cp .env.example .env   # LiveKit anahtarlarını gir (https://cloud.livekit.io, ücretsiz katman)
pnpm dev               # api :4000, web :3000
```
Geliştirme araçları (`DEV_TOOLS=1`): `GET /debug/alarm?symbol=BTC&pct=-3` odaya sahte alarm atar.

## Anahtarlar — nereden alınır?
Tek zorunlu anahtar **LiveKit** (sesli sohbet). Fiyatlar ve grafik anahtarsız.

| Ne için | Servis | Nasıl alınır | Ücret |
|---|---|---|---|
| Sesli sohbet (zorunlu) | **LiveKit Cloud** | cloud.livekit.io → Google/GitHub ile kayıt ol → **Create project** → sol menü **Settings → API Keys** → **Create key**. Ekranda çıkan `URL` (wss://…livekit.cloud), `API Key`, `API Secret` değerlerini `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` olarak gir. Secret bir kez gösterilir, sakla. | Ücretsiz katman başlangıç için yeterli |
| Kripto fiyatları | Binance public WebSocket | Anahtar gerekmez | Ücretsiz |
| Endeks fiyatları | Yahoo Finance chart endpoint | Anahtar gerekmez (gecikmeli) | Ücretsiz |
| Grafik | TradingView widget | Anahtar gerekmez | Ücretsiz |
| $SHOUT ekonomisi | PostgreSQL | Railway → **+ New → Database → PostgreSQL** (ya da Supabase) → `DATABASE_URL` | Hobby planında |
| $SHOUT ekonomisi | `SESSION_SECRET` | Kendin üret: `openssl rand -hex 32` | — |
| $SHOUT, $SPEAK, Mikrofon NFT'leri | Solana devnet | `pnpm --filter @syb/api chain:setup` (aşağıda) | Ücretsiz (devnet) |

Anahtarlar **sadece api servisine** girilir; web'e girilmez (tarayıcıya sızmasın).

## $SHOUT token ekonomisi (Solana)
**Ücretsiz oyna, kazan, harca.** Kimse tahmine para yatırmaz; doğru tahminler hazineden $SHOUT kazandırır.

| | |
|---|---|
| Token | **$SHOUT**, Solana Token-2022, 6 ondalık, zincir üstü metadata |
| Arz | 1.000.000.000, tek seferde basılır, **basım yetkisi iptal** (yeni token basılamaz) |
| Dağılım | Ödül havuzu %50 (hazine) · Ekosistem %20 · Likidite %15 · Ekip %15 |
| Kazanma | Pozitif puan başına 1 $SHOUT, günde en fazla 500 · haftalık ilk 10'a sezon bonusu (1000 → 60) |
| Çekme | Kazanılan bakiye cüzdana çekilir (en az 100, günde en fazla 2000), ücreti hazine öder |
| Harcama | Mağaza: Megafon (50), Altın lakap (100), Neon oda teması (200), Degen ses paketi (500) — bakiyeden ya da cüzdandan zincir üstü ödeme |
| Bahşiş | Odada konuşmacıya cüzdandan cüzdana $SHOUT |

Kurallar tek dosyada: `packages/shared/src/economy.ts`.

**Nasıl çalışır**
- Giriş: cüzdan bir mesaj imzalar (işlem değil, ücret yok) → API imzayı doğrular, tek kullanımlık nonce, 7 günlük oturum.
- Kazançlar zincir dışı bir **defterde** (`ledger`, append-only, idempotent) tutulur; kullanıcı istediğinde hazineden cüzdanına gönderilir. Çekimde cüzdan başına kilit var (paralel istekle çift harcama yok); transfer başarısız olursa bakiye otomatik iade edilir.
- Cüzdandan ödemeler zincirde doğrulanır: imzalayan, mint, alıcı (hazine) ve tutar birebir kontrol edilir; aynı işlem ikinci kez kullanılamaz.

## Konuşarak kazan: Mikrofon NFT'leri + $SPEAK (StepN modeli)
StepN'de yürüyerek kazanılıyordu; burada **konuşarak**. StepN ayakkabı satıyordu; burada **mikrofon NFT'si**.

| | |
|---|---|
| Mikrofon | Metaplex Core NFT ("ShoutYourBet Mics" koleksiyonu, %5 royalty hazineye). Pazar yerlerinde (Magic Eden, Tensor) alınıp satılabilir. Fabrika kutusu **1000 $SHOUT**. |
| Tipler | Kondansatör (verim), Dinamik (dayanıklılık), Şerit (şans), Megafon (karizma) |
| Kalite | Sıradan → Nadir → Ender → Destansı → Efsanevi (stat aralığı, seviye başı puan, enerji bonusu) |
| Statlar | **Verim**: dakika başı $SPEAK · **Şans**: sürpriz kutu · **Dayanıklılık**: yavaş aşınma · **Karizma**: kalabalık oda bonusu |
| Enerji | 1 mikrofon → 2, 3 → 4, 9 → 9, 15 → 12, 30 → 20 (+ kalite bonusu). **1 enerji = 5 dk** doğrulanmış konuşma. 6 saatte bir %25 dolar. |
| $SPEAK | Oyun içi token, **sınırsız arz**. Konuşunca zincir dışı bakiyeye yazılır; çekince zincirde basılır (mint yetkisi hazinede). |
| Harcama | Seviye atlama ($SPEAK; 5, 10, 15… seviyelerde ayrıca $SHOUT), tamir ($SPEAK), iki mikrofondan yeni mikrofon basma ($SPEAK + $SHOUT, mikrofon başına 7 basım) |

Bütün sayılar tek dosyada: `packages/shared/src/mics.ts`.

**Konuşma nasıl sayılır (hile koruması)**
- Sunucudaki gizli bir LiveKit katılımcısı (`apps/api/src/talk/bot.ts`, `@livekit/rtc-node`) 3+ kişilik odalara girer, her konuşmacının sesini 16 kHz mono alır.
- `SpeechAnalyzer` (`apps/api/src/talk/analyzer.ts`) her saniye için karar verir: yeterli ses etkinliği, konuşma aralığında sıfır-geçiş oranı, hece ritminde ses dalgalanması, ünlü/ünsüz değişimi. Sessizlik, sabit ton, beyaz gürültü, açık-kapa bip **sayılmaz** (gerçek seslerle test edildi: konuşma ~%86 sayılıyor).
- Konuşma sadece odada **en az 2 başka kişi** varken sayılır; takılı mikrofonun zincirdeki sahibi kontrol edilir (satılan mikrofonla kazanılmaz).
- Tarayıcının "konuşuyorum" bilgisine hiç güvenilmez.
- Bilinen sınırlama: müzik ve önceden kaydedilmiş konuşma kısmen geçebilir; dinleyici şartı, enerji tavanı ve şikayet bunu sınırlar. Mainnet öncesi: dinleyicilerin farklı cüzdan/cihaz olması, rastgele "söyle" doğrulaması, ses parmak izi.

**Zinciri kur (devnet)**
```bash
pnpm --filter @syb/api chain:setup
```
Tek komut, kaldığı yerden devam eder: $SHOUT (sabit arz, basım yetkisi iptal), $SPEAK (sınırsız) ve Mikrofon koleksiyonunu oluşturur. İlk çalıştırmada hazine cüzdanı üretilir; devnet'in RPC faucet'i kapalı olduğu için komut adresi yazıp durur: o adrese https://faucet.solana.com üzerinden (devnet) 1 SOL gönder ve tekrar çalıştır. Çıktıdaki `SHOUT_MINT`, `SPEAK_MINT`, `MIC_COLLECTION` ve `.secrets/devnet/treasury.json` içeriğini (`SOLANA_TREASURY_SECRET`) api'nin ortam değişkenlerine koy. Metadata adresleri `METADATA_BASE_URL` (varsayılan `https://shoutyourbet.app`) altındadır; NFT metadata'sı API'den canlı gelir (`PUBLIC_API_URL/nft/mic/<no>.json`), görseller web'den (`PUBLIC_WEB_URL/mics/...`).

**Lokal test (faucet gerektirmez)**
```bash
# Solana: Metaplex Core programını devnet'ten klonlayarak
solana-test-validator --reset --url https://api.devnet.solana.com --clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d
SOLANA_CLUSTER=localnet SOLANA_RPC_URL=http://127.0.0.1:8899 pnpm --filter @syb/api chain:setup
# LiveKit: livekit-server --dev  (LIVEKIT_URL=ws://127.0.0.1:7880, LIVEKIT_API_KEY=devkey, LIVEKIT_API_SECRET=secret)
# api: DATABASE_URL, SESSION_SECRET, DEV_TOOLS=1, TALK_FLUSH_SEC=10, SOLANA_*, SHOUT_MINT, SPEAK_MINT, MIC_COLLECTION, SOLANA_TREASURY_SECRET
pnpm --filter @syb/api test                                    # konuşma dedektörü, gerçek ses dosyalarıyla (6 test)
pnpm --filter @syb/api exec tsx scripts/e2e-economy.ts        # $SHOUT ekonomisi (24 kontrol)
pnpm --filter @syb/api exec tsx scripts/e2e-mics.ts           # mikrofon NFT, enerji, seviye, tamir, basım, $SPEAK çekme (31 kontrol)
pnpm --filter @syb/api exec tsx scripts/e2e-talk.ts           # gerçek LiveKit sesi: konuşma kazanır, gürültü ve tek dinleyici kazanmaz
node apps/web/e2e/wallet.e2e.cjs ./out                         # tarayıcı: cüzdan, çekim, mağaza, megafon
node apps/web/e2e/mics.e2e.cjs ./out                           # tarayıcı: kutu aç, tak, seviye, puan, sahte mikrofonla odada konuş ve kazan
```

> **Ekonomik risk.** Kazanmak için satın alma şartı + sınırsız arzlı ödül token'ı, StepN'in 2022'deki çöküşünü yaşatan yapıdır: yeni oyuncu gelişi yavaşlayınca $SPEAK satış baskısı artar, mikrofon talebi düşer. Harcama yolları (seviye, tamir, basım) bunu yavaşlatır ama durdurmaz; fiyatları ve emisyonu metrik izleyerek ayarla.

> **Hukuki not.** Tahmine para yatırılmıyor (kumar modeli bilerek kurulmadı). Ancak **kazanç amacıyla satın alınan NFT** ve satılan token, birçok ülkede menkul kıymet/yatırım sözleşmesi olarak değerlendirilebilir. Mainnet'e çıkmadan, mikrofon veya token satmadan, likidite açmadan önce hukuk görüşü al (Türkiye'de 7518 sayılı kanun / SPK, AB'de MiCA). App Store ve Google Play'in NFT/kripto kuralları da ayrıca kontrol edilmeli.

## Railway'e deploy
Ses **LiveKit Cloud**'da kalır (Railway WebRTC/UDP medya sunucusu için uygun değil). Railway'de iki servis açılır: `api` ve `web`.

1. Railway → **New Project → Deploy from GitHub repo** → bu repo. İki servis oluştur (aynı repo, ikisinde de **Root Directory boş** kalsın, pnpm workspace kökten çözülür).
2. Her serviste **Settings → Config-as-code → Railway config file**:
   - api servisi: `apps/api/railway.json`
   - web servisi: `apps/web/railway.json`
3. **api servisi → Settings → Region: EU West (Amsterdam) veya Southeast Asia (Singapore).** Binance ABD IP'lerini engeller (HTTP 451); ABD bölgesinde kripto fiyatı gelmez.
4. Her iki servise **Networking → Generate Domain**.
5. Değişkenler:

| Servis | Değişken | Değer |
|---|---|---|
| api | `LIVEKIT_URL` | `wss://<proje>.livekit.cloud` |
| api | `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | LiveKit Cloud → Settings → Keys |
| api | `PRICE_MODE` | `live` |
| api | `SHOUT_HORIZON_SEC` | `900` |
| web | `NEXT_PUBLIC_API_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` (servis adın `api` değilse onu yaz) |

`PORT`'u Railway kendisi verir, ekleme. `DEV_TOOLS` ekleme (prod'da `/debug` kapalı kalsın).

**Notlar**
- `NEXT_PUBLIC_API_URL` build sırasında gömülür: API domaini değişirse web'i yeniden deploy et.
- `DATABASE_URL` verildiğinde tahminler, skorlar ve $SHOUT bakiyeleri Postgres'te kalıcıdır. Kullanıcı odaları hâlâ bellekte: api'yi **tek replika** çalıştır.
- Railway'de api servisine Postgres'i bağla: değişken `DATABASE_URL=${{Postgres.DATABASE_URL}}`, ayrıca `SESSION_SECRET`, `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SHOUT_MINT`, `SPEAK_MINT`, `MIC_COLLECTION`, `SOLANA_TREASURY_SECRET`, `PUBLIC_API_URL` (api'nin kendi https adresi) ve `PUBLIC_WEB_URL`.
- Konuşma botu api servisinin içinde çalışır (ayrı servis gerekmez); LiveKit Cloud anahtarları tanımlıysa kendiliğinden başlar.
- Yahoo Finance bulut IP'lerini ara ara sınırlayabilir (429) → endeks fiyatı geç gelebilir; kalıcı çözüm Finnhub/Twelve Data provider'ı.
- Maliyet: iki küçük servis Railway Hobby planına sığar; LiveKit Cloud ücretsiz katmanı ayrıca.

## Yol haritası
- **Faz 2**: Expo mobil uygulama (`@livekit/react-native`, dev build gerekir), moderasyon paneli, sybil koruması, $SHOUT mainnet lansman hazırlığı (hukuk görüşü sonrası).
- **Faz 3**: talep gelen coin/endeksler, oda içi anketler, "günün balinası" rozetleri, klip paylaşımı.

> Yatırım tavsiyesi değildir. Puanlar sanaldır; uygulama para/ödül içermez.
