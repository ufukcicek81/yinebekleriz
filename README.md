# Yine Bekleriz

Asil Kuyumculuk'un düzenli altın biriktiren müşterileri için QR kartlı birikim ve ödül sistemi. Müşteri uygulama yüklemez; kartındaki QR'ı kamerayla okutup kendi sayfasını görür.

- `index.html` – Müşteri sayfası (QR ile açılır)
- `admin.html` – Dükkân paneli (müşteri ekle, alım kaydet, QR kart yazdır)
- `worker/worker.js` + `wrangler.toml` – Cloudflare Worker (veriler Cloudflare KV'de). Cloudflare GitHub'a bağlı: repoya yüklenen her değişiklik otomatik yayına çıkar.

## Kurulum

### 1) GitHub Pages'i aç
Repo → **Settings** → **Pages** → Branch: `main`, klasör: `/ (root)` → **Save**.
Birkaç dakika sonra adres: `https://ufukcicek81.github.io/yinebekleriz/`

### 2) Worker'ı yayına al (bilgisayardan, CMD)
`worker` klasöründeki iki dosyayı bir klasöre koy (ör. `C:\yinebekleriz`):

```
cd C:\yinebekleriz
wrangler kv namespace create BIRIKIM
```
Çıkan `id` değerini Notepad ile `wrangler.toml` içindeki `BURAYA_KV_ID` yerine yapıştır.

```
wrangler secret put ADMIN_KEY
wrangler deploy
```
`ADMIN_KEY` panel şifren olur. Deploy sonunda `https://yinebekleriz.XXXX.workers.dev` adresi çıkar.

### 3) Adresi sayfalara yaz
`index.html` ve `admin.html` içindeki `WORKER_URL` satırında `KULLANICI` yerine kendi Cloudflare alt alan adını yaz.

## Kullanım
- Panel: `https://ufukcicek81.github.io/yinebekleriz/admin.html` → şifreyle gir.
- Müşteri ekle → hedef ay ve ödülü yaz → **QR kart yazdır** (kartvizit boyutu).
- Müşteri her geldiğinde: isminden bul → ürünü seç (çeyrek/yarım/tam gramı kendi dolar) → Kaydet.
- Aynı ay içindeki birden fazla alım tek ay sayılır. Hedef dolunca "Ödül hak etti" çıkar; ödülü verince "Ödül verildi"ye bas.

## Notlar
- Bilezik ve "Diğer" seçince gramı elle yaz.
- Müşteri sayfasında telefon numarası görünmez; her kartın linki tahmin edilemez bir kod içerir.
- KVKK: müşteriden isim/telefon kaydı için onay al.
