// Yine Bekleriz - Asil Kuyumculuk altın birikim kartı Worker'ı
// Gerekenler: KV namespace "BIRIKIM" ve gizli anahtar "ADMIN_KEY"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function yeniId(uzunluk = 10) {
  const harfler = "abcdefghjkmnpqrstuvwxyz23456789";
  const rastgele = crypto.getRandomValues(new Uint8Array(uzunluk));
  return Array.from(rastgele, (b) => harfler[b % harfler.length]).join("");
}

// Kayıtları olan farklı ay sayısı ve şu anki aralıksız seri
function ozet(m) {
  const aylar = new Set(m.kayitlar.map((k) => k.tarih.slice(0, 7)));
  let seri = 0;
  const d = new Date();
  let ay = d.toISOString().slice(0, 7);
  // Bu ay henüz gelmediyse seri geçen aydan sayılır
  if (!aylar.has(ay)) {
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    ay = d.toISOString().slice(0, 7);
  }
  while (aylar.has(ay)) {
    seri++;
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    ay = d.toISOString().slice(0, 7);
  }
  const toplamGram = m.kayitlar.reduce((t, k) => t + Number(k.gram || 0), 0);
  return {
    aySayisi: aylar.size,
    seri,
    toplamGram: Math.round(toplamGram * 100) / 100,
    hedefTamam: aylar.size >= m.hedefAy,
  };
}

// Müşteriye gösterilecek kısım (telefon yok)
function herkeseAcik(m) {
  return {
    id: m.id,
    ad: m.ad,
    hedefAy: m.hedefAy,
    odul: m.odul,
    odulVerildi: !!m.odulVerildi,
    baslangic: m.olusturma,
    kayitlar: [...m.kayitlar].sort((a, b) => b.tarih.localeCompare(a.tarih)),
    ...ozet(m),
  };
}

async function getir(env, id) {
  const veri = await env.BIRIKIM.get("m:" + id);
  return veri ? JSON.parse(veri) : null;
}

async function kaydet(env, m) {
  await env.BIRIKIM.put("m:" + m.id, JSON.stringify(m), {
    metadata: { ad: m.ad },
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
    const yol = url.pathname.replace(/\/+$/, "");

    // --- Müşteri sayfası (herkese açık, sadece ID ile) ---
    const musteriEslesme = yol.match(/^\/m\/([a-z0-9]{6,20})$/);
    if (req.method === "GET" && musteriEslesme) {
      const m = await getir(env, musteriEslesme[1]);
      if (!m) return json({ hata: "Kart bulunamadı" }, 404);
      return json(herkeseAcik(m));
    }

    // --- Buradan sonrası sadece dükkân (admin) ---
    if (!yol.startsWith("/admin")) return json({ hata: "Bulunamadı" }, 404);
    if (!env.ADMIN_KEY || req.headers.get("X-Admin-Key") !== env.ADMIN_KEY) {
      return json({ hata: "Yetkisiz" }, 401);
    }

    let govde = {};
    if (req.method === "POST") {
      try {
        govde = await req.json();
      } catch {
        return json({ hata: "Geçersiz veri" }, 400);
      }
    }

    // Tüm müşteriler (özetli)
    if (req.method === "GET" && yol === "/admin/musteriler") {
      const liste = [];
      let cursor;
      do {
        const r = await env.BIRIKIM.list({ prefix: "m:", cursor });
        for (const k of r.keys) {
          const m = await getir(env, k.name.slice(2));
          if (m) liste.push({ ...herkeseAcik(m), tel: m.tel || "" });
        }
        cursor = r.list_complete ? null : r.cursor;
      } while (cursor);
      liste.sort((a, b) => a.ad.localeCompare(b.ad, "tr"));
      return json(liste);
    }

    // Yeni müşteri
    if (req.method === "POST" && yol === "/admin/musteri") {
      const ad = String(govde.ad || "").trim();
      if (!ad) return json({ hata: "İsim gerekli" }, 400);
      const m = {
        id: yeniId(),
        ad,
        tel: String(govde.tel || "").trim(),
        hedefAy: Math.max(1, parseInt(govde.hedefAy) || 12),
        odul: String(govde.odul || "").trim(),
        odulVerildi: false,
        olusturma: new Date().toISOString().slice(0, 10),
        kayitlar: [],
      };
      await kaydet(env, m);
      return json({ ...herkeseAcik(m), tel: m.tel });
    }

    // Müşteri bilgisi güncelle (hedef, ödül, ödül verildi)
    if (req.method === "POST" && yol === "/admin/guncelle") {
      const m = await getir(env, govde.id);
      if (!m) return json({ hata: "Müşteri yok" }, 404);
      for (const alan of ["ad", "tel", "odul"]) {
        if (govde[alan] !== undefined) m[alan] = String(govde[alan]).trim();
      }
      if (govde.hedefAy !== undefined) m.hedefAy = Math.max(1, parseInt(govde.hedefAy) || 12);
      if (govde.odulVerildi !== undefined) m.odulVerildi = !!govde.odulVerildi;
      await kaydet(env, m);
      return json({ ...herkeseAcik(m), tel: m.tel });
    }

    // Yeni alım kaydı
    if (req.method === "POST" && yol === "/admin/kayit") {
      const m = await getir(env, govde.id);
      if (!m) return json({ hata: "Müşteri yok" }, 404);
      const gram = Number(govde.gram);
      if (!(gram > 0)) return json({ hata: "Gram girilmeli" }, 400);
      m.kayitlar.push({
        kid: yeniId(8),
        tarih: /^\d{4}-\d{2}-\d{2}$/.test(govde.tarih || "")
          ? govde.tarih
          : new Date().toISOString().slice(0, 10),
        urun: String(govde.urun || "Altın").trim(),
        adet: Math.max(1, parseInt(govde.adet) || 1),
        gram: Math.round(gram * 100) / 100,
        not: String(govde.not || "").trim(),
      });
      await kaydet(env, m);
      return json({ ...herkeseAcik(m), tel: m.tel });
    }

    // Kayıt sil
    if (req.method === "DELETE" && yol === "/admin/kayit") {
      const id = url.searchParams.get("id");
      const kid = url.searchParams.get("kid");
      const m = await getir(env, id);
      if (!m) return json({ hata: "Müşteri yok" }, 404);
      m.kayitlar = m.kayitlar.filter((k) => k.kid !== kid);
      await kaydet(env, m);
      return json({ ...herkeseAcik(m), tel: m.tel });
    }

    // Müşteri sil
    if (req.method === "DELETE" && yol === "/admin/musteri") {
      await env.BIRIKIM.delete("m:" + url.searchParams.get("id"));
      return json({ tamam: true });
    }

    return json({ hata: "Bulunamadı" }, 404);
  },
};
