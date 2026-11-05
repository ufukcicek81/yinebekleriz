// Yine Bekleriz - Asil Kuyumculuk sadakat (damga/ödül) Worker'ı
// Gerekenler: KV namespace "BIRIKIM" ve gizli anahtar "ADMIN_KEY"
//
// Akış: Müşteri tezgâhtaki QR'ı okutur -> damga isteği düşer ->
// dükkân panelden onaylar -> damga eklenir. Hedef sayıya ulaşınca ödül açılır,
// ödül kullanılınca damgalar sıfırlanır.

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

const BEKLEME_SURESI = 12 * 60 * 60 * 1000; // 12 saatten eski istekler düşer

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

async function bekleyenGetir(env) {
  const v = await env.BIRIKIM.get("bekleyen");
  const liste = v ? JSON.parse(v) : [];
  const sinir = Date.now() - BEKLEME_SURESI;
  return liste.filter((b) => b.zaman > sinir);
}

async function bekleyenKaydet(env, liste) {
  await env.BIRIKIM.put("bekleyen", JSON.stringify(liste));
}

async function bekleyendenCikar(env, id) {
  const liste = await bekleyenGetir(env);
  await bekleyenKaydet(env, liste.filter((b) => b.id !== id));
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
    bekliyor: !!(m.bekliyor && m.bekliyor > Date.now() - BEKLEME_SURESI),
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
    bekliyor: null,
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

      // Damga isteği (tezgâhta QR okutunca)
      if (req.method === "POST" && kartEslesme[2]) {
        const simdi = Date.now();
        if (!(m.bekliyor && m.bekliyor > simdi - BEKLEME_SURESI)) {
          m.bekliyor = simdi;
          await musteriKaydet(env, m);
          const liste = (await bekleyenGetir(env)).filter((b) => b.id !== m.id);
          liste.push({ id: m.id, zaman: simdi });
          await bekleyenKaydet(env, liste);
        }
        return json(kart(m, a));
      }
    }

    // ================= DÜKKÂN (ADMIN) =================

    if (!yol.startsWith("/admin")) return json({ hata: "Bulunamadı" }, 404);
    if (!env.ADMIN_KEY || req.headers.get("X-Admin-Key") !== env.ADMIN_KEY) {
      return json({ hata: "Yetkisiz" }, 401);
    }

    // Bekleyen istekler + ayarlar (panel bunu birkaç saniyede bir sorar)
    if (req.method === "GET" && yol === "/admin/durum") {
      const liste = await bekleyenGetir(env);
      const bekleyen = [];
      for (const b of liste) {
        const m = await musteriGetir(env, b.id);
        if (m) bekleyen.push({ ...panelKart(m, a), zaman: b.zaman });
      }
      bekleyen.sort((x, y) => x.zaman - y.zaman);
      return json({ bekleyen, ayarlar: a });
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
        await bekleyendenCikar(env, m.id);
      }
      return json({ tamam: true });
    }

    // Buradan sonrakiler tek müşteri üzerinde işlem
    const islemler = ["/admin/onay", "/admin/reddet", "/admin/damga", "/admin/odul"];
    if (req.method === "POST" && islemler.includes(yol)) {
      const m = await musteriGetir(env, govde.id);
      if (!m) return json({ hata: "Müşteri yok" }, 404);
      const t = new Date().toISOString();

      if (yol === "/admin/onay") {
        // Ödül hazırsa damga birikmez, ama geliş sayılır
        if (m.damga < a.hedef) m.damga++;
        m.toplamGelis = (m.toplamGelis || 0) + 1;
        m.gecmis.push({ t, tur: "damga" });
      } else if (yol === "/admin/reddet") {
        m.gecmis.push({ t, tur: "red" });
      } else if (yol === "/admin/damga") {
        // Elle düzeltme: +1 / -1
        const fark = Number(govde.fark) > 0 ? 1 : -1;
        const once = m.damga;
        m.damga = Math.min(a.hedef, Math.max(0, m.damga + fark));
        if (m.damga !== once) {
          if (fark > 0) m.toplamGelis = (m.toplamGelis || 0) + 1;
          else m.toplamGelis = Math.max(0, (m.toplamGelis || 0) - 1);
          m.gecmis.push({ t, tur: fark > 0 ? "elle+" : "elle-" });
        }
      } else if (yol === "/admin/odul") {
        if (m.damga < a.hedef) return json({ hata: "Ödül henüz hazır değil" }, 400);
        m.damga = 0;
        m.odulSayisi = (m.odulSayisi || 0) + 1;
        m.gecmis.push({ t, tur: "odul" });
      }

      // Onay, red veya ödül kullanımı bekleyen isteği kapatır
      if (yol !== "/admin/damga") {
        m.bekliyor = null;
        await bekleyendenCikar(env, m.id);
      }
      await musteriKaydet(env, m);
      return json(panelKart(m, a));
    }

    return json({ hata: "Bulunamadı" }, 404);
  },
};
