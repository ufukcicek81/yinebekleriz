# Yine Bekleriz

Asil Kuyumculuk sadakat programı. Tezgâhta tek bir QR durur. Müşteri her alışverişinde onu okutur, dükkân onaylar ve müşteriye bir damga eklenir. Belirlenen sayıda damgaya (ör. 5) ulaşan müşteri, bir sonraki alışverişinde kalem kalem indirim kazanır (ör. 14 ayar %10, 24 ayar 200 TL). Müşterinin uygulama yüklemesi gerekmez.

- `index.html` – Müşteri sayfası (tezgâh QR'ı buraya açılır)
- `admin.html` – Dükkân paneli
- `worker/worker.js` + `wrangler.toml` – Cloudflare Worker (veriler Cloudflare KV'de). Cloudflare bu repoya bağlı: yüklenen her değişiklik otomatik yayına çıkar.

## Adresler
- Müşteri: https://ufukcicek81.github.io/yinebekleriz/
- Panel: https://ufukcicek81.github.io/yinebekleriz/admin.html
- Worker: https://yinebekleriz.ufuk87900.workers.dev

## Nasıl çalışır
1. **Tezgâh QR** sekmesinden A5 afişi yazdırıp tezgâha koy.
2. Müşteri ilk okuttuğunda adını ve telefonunu bir kez yazar. Telefonu onu hatırlar. Telefon değişirse aynı numarayı yazınca kartı geri gelir.
3. Her okutmada **Bekleyenler** sekmesine düşer (yeni istek gelince panel kısa bir ses çıkarır). Alışveriş yaptıysa **Onayla +1**, yapmadıysa **Reddet**.
4. Damgalar tamamlanınca hem müşteride hem panelde "ÖDÜL HAZIR" çıkar. Ödülü kullandırınca **Ödülü kullandır**'a bas, damgalar sıfırlanır.
5. **Ödül ayarları** sekmesinden kaç gelişte ödül verileceğini ve ürün ürün indirimleri (TL, % veya $) değiştirebilirsin.
6. **Müşteriler** sekmesinden elle müşteri ekleyebilir, damga ekleyip silebilir, geçmişi görebilirsin.

## Kurulum notları
- Cloudflare'de Worker adı `yinebekleriz`, KV bağlantısı `BIRIKIM`, panel şifresi `ADMIN_KEY` adlı **Secret**.
- GitHub Pages: Settings → Pages → `main` / root.
- KVKK: müşteri kayıt ekranında onay kutusu vardır.
