// Yine Bekleriz - Asil Kuyumculuk sadakat (damga/ödül) Worker'ı
// Gerekenler: KV namespace "BIRIKIM" ve gizli anahtar "ADMIN_KEY"
//
// Akış: Müşteri tezgâhtaki QR'ı okutur -> damga hemen eklenir (günde en fazla 1).
// Hedef sayıya ulaşınca ödül açılır; dükkân ödülü kullandırınca damgalar sıfırlanır.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
};

const VARSAYILAN = {
  dukkan: "Asil Kuyumculuk",
  hedef: 5,
  oduller: [
    { urun: "14 ayar", tip: "%", deger: 10 },
    { urun: "22 ayar", tip: "TL", deger: 300 },
    { urun: "24 ayar gram", tip: "TL", deger: 200 },
  ],
};

const GUN = 24 * 60 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

function yeniId(uzunluk = 12) {
  const harfler = "abcdefghjkmnpqrstuvwxyz23456789";
  const r = crypto.getRandomValues(new Uint8Array(uzunluk));
  return Array.from(r, (b) => harfler[b % harfler.length]).join("");
}

const telNorm = (t) => String(t || "").replace(/\D/g, "").slice(-10);
// Türkiye saatine göre bugünün tarihi (YYYY-AA-GG)
const bugunTR = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function ayarlarGetir(env) {
  const v = await env.BIRIKIM.get("ayarlar");
  return v ? { ...VARSAYILAN, ...JSON.parse(v) } : VARSAYILAN;
}

async function musteriGetir(env, id) {
  if (!id) return null;
  const v = await env.BIRIKIM.get("k:" + id);
  return v ? JSON.parse(v) : null;
}

async function musteriKaydet(env, m) {
  m.gecmis = (m.gecmis || []).slice(-50);
  await env.BIRIKIM.put("k:" + m.id, JSON.stringify(m));
}

// Son 24 saatte gelenler (panelde "Bugün gelenler")
async function gelenlerGetir(env) {
  const v = await env.BIRIKIM.get("gelenler");
  const sinir = Date.now() - GUN;
  return (v ? JSON.parse(v) : []).filter((g) => g.zaman > sinir);
}

async function gelenlerKaydet(env, liste) {
  await env.BIRIKIM.put("gelenler", JSON.stringify(liste.slice(-300)));
}

// Müşteriye gösterilen kart (telefon yok)
function kart(m, a) {
  return {
    id: m.id,
    ad: m.ad,
    damga: Math.min(m.damga, a.hedef),
    hedef: a.hedef,
    odulHazir: m.damga >= a.hedef,
    oduller: a.oduller,
    dukkan: a.dukkan,
    toplamGelis: m.toplamGelis || 0,
    odulSayisi: m.odulSayisi || 0,
    bugunAldi: m.sonDamgaGunu === bugunTR(),
  };
}

// Panelde gösterilen hâli (telefon ve geçmiş dahil)
function panelKart(m, a) {
  return { ...kart(m, a), tel: m.tel, olusturma: m.olusturma, gecmis: [...(m.gecmis || [])].reverse() };
}

function yeniMusteri(ad, tel) {
  return {
    id: yeniId(),
    ad,
    tel,
    damga: 0,
    toplamGelis: 0,
    odulSayisi: 0,
    sonDamgaGunu: null,
    olusturma: new Date().toISOString(),
    gecmis: [{ t: new Date().toISOString(), tur: "kayit" }],
  };
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const yol = url.pathname.replace(/\/+$/, "") || "/";

    let govde = {};
    if (req.method === "POST") {
      try {
        govde = await req.json();
      } catch {
        return json({ hata: "Geçersiz veri" }, 400);
      }
    }

    const a = await ayarlarGetir(env);

    // ================= MÜŞTERİ TARAFI =================

    if (req.method === "GET" && yol === "/") {
      return json({ uygulama: "Yine Bekleriz", durum: "çalışıyor" });
    }

    if (req.method === "GET" && yol === "/ayarlar") {
      return json({ dukkan: a.dukkan, hedef: a.hedef, oduller: a.oduller });
    }

    // İlk kayıt ya da telefonla karta geri dönme
    if (req.method === "POST" && yol === "/kayit") {
      const ad = String(govde.ad || "").trim().slice(0, 60);
      const tel = telNorm(govde.tel);
      if (tel.length !== 10) return json({ hata: "Telefon numarasını 10 hane yazın (5xx xxx xx xx)" }, 400);
      const varId = await env.BIRIKIM.get("t:" + tel);
      if (varId) {
        const m = await musteriGetir(env, varId);
        if (m) return json(kart(m, a));
      }
      if (!ad) return json({ hata: "Adınızı yazın" }, 400);
      if (!govde.onay) return json({ hata: "Kayıt için onay kutusunu işaretleyin" }, 400);
      const m = yeniMusteri(ad, tel);
      await musteriKaydet(env, m);
      await env.BIRIKIM.put("t:" + tel, m.id);
      return json(kart(m, a));
    }

    const kartEslesme = yol.match(/^\/m\/([a-z0-9]{8,20})(\/istek)?$/);
    if (kartEslesme) {
      const m = await musteriGetir(env, kartEslesme[1]);
      if (!m) return json({ hata: "Kart bulunamadı" }, 404);

      if (req.method === "GET" && !kartEslesme[2]) return json(kart(m, a));

      // Tezgâh QR'ı okutuldu: damga hemen eklenir, günde en fazla bir kez
      if (req.method === "POST" && kartEslesme[2]) {
        const bugun = bugunTR();
        if (m.sonDamgaGunu === bugun) return json({ ...kart(m, a), sonuc: "zaten" });

        const odulHazirdi = m.damga >= a.hedef;
        if (!odulHazirdi) m.damga++;
        m.toplamGelis = (m.toplamGelis || 0) + 1;
        m.sonDamgaGunu = bugun;
        const t = new Date().toISOString();
        m.gecmis.push({ t, tur: odulHazirdi ? "gelis" : "damga" });
        await musteriKaydet(env, m);

        const liste = await gelenlerGetir(env);
        liste.push({ id: m.id, zaman: Date.now(), damgaEklendi: !odulHazirdi });
        await gelenlerKaydet(env, liste);

        return json({ ...kart(m, a), sonuc: odulHazirdi ? "odulHazir" : "eklendi" });
      }
    }

    // ================= DÜKKÂN (ADMIN) =================

    if (!yol.startsWith("/admin")) return json({ hata: "Bulunamadı" }, 404);
    if (!env.ADMIN_KEY || req.headers.get("X-Admin-Key") !== env.ADMIN_KEY) {
      return json({ hata: "Yetkisiz" }, 401);
    }

    // Son 24 saatte gelenler + ayarlar (panel bunu birkaç saniyede bir sorar)
    if (req.method === "GET" && yol === "/admin/durum") {
      const liste = await gelenlerGetir(env);
      const gelenler = [];
      for (const g of [...liste].reverse()) {
        const m = await musteriGetir(env, g.id);
        if (m) gelenler.push({ ...panelKart(m, a), zaman: g.zaman, damgaEklendi: g.damgaEklendi });
      }
      return json({ gelenler, ayarlar: a });
    }

    if (req.method === "GET" && yol === "/admin/musteriler") {
      const liste = [];
      let cursor;
      do {
        const r = await env.BIRIKIM.list({ prefix: "k:", cursor });
        for (const k of r.keys) {
          const m = await musteriGetir(env, k.name.slice(2));
          if (m) liste.push(panelKart(m, a));
        }
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      liste.sort((x, y) => x.ad.localeCompare(y.ad, "tr"));
      return json(liste);
    }

    if (req.method === "POST" && yol === "/admin/ayarlar") {
      const hedef = Math.min(50, Math.max(1, parseInt(govde.hedef) || a.hedef));
      const oduller = (Array.isArray(govde.oduller) ? govde.oduller : [])
        .map((o) => ({
          urun: String(o.urun || "").trim().slice(0, 60),
          tip: ["TL", "%", "$"].includes(o.tip) ? o.tip : "TL",
          deger: Math.max(0, Number(o.deger) || 0),
        }))
        .filter((o) => o.urun && o.deger > 0)
        .slice(0, 20);
      const yeni = { dukkan: String(govde.dukkan || a.dukkan).trim().slice(0, 60), hedef, oduller };
      await env.BIRIKIM.put("ayarlar", JSON.stringify(yeni));
      return json(yeni);
    }

    // Elle müşteri ekleme (QR okutamayan müşteri için)
    if (req.method === "POST" && yol === "/admin/musteri") {
      const ad = String(govde.ad || "").trim().slice(0, 60);
      const tel = telNorm(govde.tel);
      if (!ad) return json({ hata: "İsim gerekli" }, 400);
      if (tel.length !== 10) return json({ hata: "Telefon 10 hane olmalı" }, 400);
      if (await env.BIRIKIM.get("t:" + tel)) return json({ hata: "Bu telefon zaten kayıtlı" }, 400);
      const m = yeniMusteri(ad, tel);
      await musteriKaydet(env, m);
      await env.BIRIKIM.put("t:" + tel, m.id);
      return json(panelKart(m, a));
    }

    if (req.method === "DELETE" && yol === "/admin/musteri") {
      const m = await musteriGetir(env, url.searchParams.get("id"));
      if (m) {
        await env.BIRIKIM.delete("k:" + m.id);
        await env.BIRIKIM.delete("t:" + m.tel);
        await gelenlerKaydet(env, (await gelenlerGetir(env)).filter((g) => g.id !== m.id));
      }
      return json({ tamam: true });
    }

    // Tek müşteri üzerinde işlemler
    const islemler = ["/admin/geri-al", "/admin/damga", "/admin/odul"];
    if (req.method === "POST" && islemler.includes(yol)) {
      const m = await musteriGetir(env, govde.id);
      if (!m) return json({ hata: "Müşteri yok" }, 404);
      const t = new Date().toISOString();

      if (yol === "/admin/geri-al") {
        // Bugünkü okutmayı geri al (alışveriş yapmadan okuttuysa)
        const liste = await gelenlerGetir(env);
        const i = liste.map((g) => g.id).lastIndexOf(m.id);
        if (i < 0) return json({ hata: "Bugün okutma yok" }, 400);
        const [g] = liste.splice(i, 1);
        await gelenlerKaydet(env, liste);
        if (g.damgaEklendi && m.damga > 0) m.damga--;
        m.toplamGelis = Math.max(0, (m.toplamGelis || 0) - 1);
        m.sonDamgaGunu = null;
        m.gecmis.push({ t, tur: "geri" });
      } else if (yol === "/admin/damga") {
        // Elle düzeltme: +1 / -1
        const fark = Number(govde.fark) > 0 ? 1 : -1;
        const once = m.damga;
        m.damga = Math.min(a.hedef, Math.max(0, m.damga + fark));
        if (m.damga !== once) {
          m.toplamGelis = Math.max(0, (m.toplamGelis || 0) + fark);
          m.gecmis.push({ t, tur: fark > 0 ? "elle+" : "elle-" });
        }
      } else if (yol === "/admin/odul") {
        if (m.damga < a.hedef) return json({ hata: "Ödül henüz hazır değil" }, 400);
        m.damga = 0;
        m.odulSayisi = (m.odulSayisi || 0) + 1;
        m.gecmis.push({ t, tur: "odul" });
      }

      await musteriKaydet(env, m);
      return json(panelKart(m, a));
    }

    return json({ hata: "Bulunamadı" }, 404);
  },
};
