import React, { useState, useRef, useEffect } from 'react';
import { ImageIcon, Video, Copy, Check, Loader2, X, Wand2, Sparkles, AlertCircle, Download, KeyRound, Eye, EyeOff, Upload } from 'lucide-react';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELS = {
  analyze: 'gemini-3.8-flash',
  image: 'gemini-3.1-flash-image',
  video: 'gemini-omni-1.1-flash',
};

const toBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const copyText = async (t) => {
  try { await navigator.clipboard.writeText(t); }
  catch {
    const a = document.createElement('textarea');
    a.value = t; document.body.appendChild(a); a.select();
    document.execCommand('copy'); a.remove();
  }
};

async function callApi(key, path, opts = {}) {
  const r = await fetch(path.startsWith('http') ? path : `${BASE}/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || `Permintaan gagal (${r.status})`);
  }
  return r;
}

const ANALYZE_PROMPT = (kind, lang) => {
  const L = lang === 'id' ? 'Bahasa Indonesia' : 'English';
  if (kind === 'video')
    return `Analisis video ini. Tulis satu prompt text-to-video yang detail: adegan, subjek, gerakan kamera, gaya visual, pencahayaan, suasana, dan dialog jika ada. Tulis dalam ${L}, satu paragraf, tanpa basa-basi.`;
  return `Analisis gambar ini. Tulis satu prompt text-to-image yang sangat detail: subjek utama, latar, gaya dan mood, pencahayaan, komposisi dan sudut pandang, palet warna, tekstur. Tulis dalam ${L}, satu paragraf, tanpa basa-basi.`;
};

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [tab, setTab] = useState('image');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [lang, setLang] = useState('id');
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [busy, setBusy] = useState(null); // 'analyze' | 'image' | 'video'
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [gallery, setGallery] = useState([]);
  const [copied, setCopied] = useState(false);
  const [drag, setDrag] = useState(false);
  const stageRef = useRef(null);

  const ratios = tab === 'image' ? ['1:1', '16:9', '9:16', '4:3'] : ['16:9', '9:16'];
  useEffect(() => { if (!ratios.includes(ratio)) setRatio(ratios[0]); }, [tab]); // eslint-disable-line

  const moveGlow = (e) => {
    const el = stageRef.current; if (!el) return;
    const b = el.getBoundingClientRect();
    el.style.setProperty('--x', `${e.clientX - b.left}px`);
    el.style.setProperty('--y', `${e.clientY - b.top}px`);
  };

  const pick = (f) => {
    if (!f) return;
    setError(null);
    if (!f.type.startsWith(tab + '/')) return setError(`Pilih file ${tab === 'image' ? 'gambar' : 'video'} yang valid.`);
    const max = tab === 'image' ? 10 : 18;
    if (f.size > max * 1024 * 1024) return setError(`Ukuran file maksimal ${max}MB.`);
    if (preview) URL.revokeObjectURL(preview);
    setFile(f); setPreview(URL.createObjectURL(f));
  };

  const clearFile = () => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview(null); };

  const needKey = () => {
    if (!apiKey.trim()) { setError('Masukkan Gemini API key dulu di bagian atas.'); return true; }
    return false;
  };

  const analyze = async () => {
    if (!file || needKey()) return;
    setBusy('analyze'); setError(null); setStatus('Menganalisis media…');
    try {
      const data = await toBase64(file);
      const r = await callApi(apiKey, `models/${MODELS.analyze}:generateContent`, {
        method: 'POST',
        body: JSON.stringify({
          contents: [{ parts: [{ text: ANALYZE_PROMPT(tab, lang) }, { inlineData: { mimeType: file.type, data } }] }],
        }),
      });
      const j = await r.json();
      const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      if (!t) throw new Error('Media tidak dapat dianalisis.');
      setPrompt(t);
    } catch (e) { setError(e.message); }
    setBusy(null); setStatus('');
  };

  const generateImage = async () => {
    if (!prompt.trim() || needKey()) return;
    setBusy('image'); setError(null); setStatus('Membuat gambar…');
    try {
      const r = await callApi(apiKey, `models/${MODELS.image}:generateContent`, {
        method: 'POST',
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } },
        }),
      });
      const j = await r.json();
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
      const d = part?.inlineData || part?.inline_data;
      if (!d) throw new Error('Tidak ada gambar dari API. Coba ubah prompt.');
      const url = `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
      setGallery((g) => [{ id: Date.now(), type: 'image', url, prompt }, ...g]);
    } catch (e) { setError(e.message); }
    setBusy(null); setStatus('');
  };

  const generateVideo = async () => {
    if (!prompt.trim() || needKey()) return;
    setBusy('video'); setError(null);
    const t0 = Date.now();
    const tick = setInterval(
      () => setStatus(`Omni sedang membuat video… ${Math.round((Date.now() - t0) / 1000)} detik`), 1000);
    setStatus('Omni sedang membuat video…');
    try {
      const r = await callApi(apiKey, 'interactions', {
        method: 'POST',
        body: JSON.stringify({
          model: MODELS.video,
          input: prompt,
          response_format: { type: 'video', aspect_ratio: ratio, resolution: '720p' },
        }),
      });
      const j = await r.json();
      const out = (j.steps || [])
        .filter((st) => st.type === 'model_output')
        .flatMap((st) => st.content || [])
        .find((c) => c.type === 'video') || j.output_video;
      if (!out) throw new Error('Omni tidak mengembalikan video. Prompt mungkin diblokir filter keamanan.');
      let blob;
      if (out.data) {
        const bin = atob(out.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        blob = new Blob([bytes], { type: out.mime_type || 'video/mp4' });
      } else if (out.uri) {
        blob = await (await callApi(apiKey, out.uri)).blob();
      } else throw new Error('Format respons video tidak dikenali.');
      setGallery((g) => [{ id: Date.now(), type: 'video', url: URL.createObjectURL(blob), prompt }, ...g]);
    } catch (e) { setError(e.message); }
    clearInterval(tick);
    setBusy(null); setStatus('');
  };

  const doCopy = async () => { await copyText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); };

  const chip = (on) =>
    `px-3.5 py-1.5 rounded-full text-sm font-medium border transition-all ${
      on ? 'bg-amber-400 text-stone-900 border-amber-400' : 'border-stone-700 text-stone-300 hover:border-amber-400/60'
    }`;

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 px-4 py-8 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 mb-8">
          <div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight">Studio Prompt Visual</h1>
            <p className="text-stone-400 mt-2">Unggah gambar atau video, ambil prompt-nya, lalu hasilkan karya baru.</p>
          </div>
          <div className="flex items-center gap-2 bg-stone-900 border border-stone-800 rounded-xl px-3 py-2 w-full sm:w-80 focus-within:border-amber-400 transition-colors">
            <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Gemini API key"
              className="bg-transparent flex-1 min-w-0 text-sm outline-none placeholder:text-stone-500"
              autoComplete="off"
            />
            <button onClick={() => setShowKey(!showKey)} className="text-stone-400 hover:text-stone-100" aria-label="Tampilkan key">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* LEFT: source */}
          <section className="space-y-5">
            <div className="flex gap-2">
              {[['image', 'Gambar', ImageIcon], ['video', 'Video', Video]].map(([k, l, I]) => (
                <button key={k} onClick={() => { setTab(k); clearFile(); setError(null); }}
                  className={`${chip(tab === k)} flex items-center gap-2`}>
                  <I className="w-4 h-4" />{l}
                </button>
              ))}
            </div>

            <div
              ref={stageRef}
              onMouseMove={moveGlow}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
              className={`relative overflow-hidden rounded-3xl border-2 border-dashed h-72 flex items-center justify-center transition-colors ${
                drag ? 'border-amber-400 bg-amber-400/10' : 'border-stone-700 bg-stone-900'
              }`}
              style={{ backgroundImage: 'radial-gradient(260px circle at var(--x,50%) var(--y,50%), rgba(251,191,36,0.16), transparent 70%)' }}
            >
              {preview ? (
                <>
                  {tab === 'image'
                    ? <img src={preview} alt="Pratinjau" className="max-h-full max-w-full object-contain" />
                    : <video src={preview} controls className="max-h-full max-w-full" />}
                  <button onClick={clearFile} className="absolute top-3 right-3 bg-stone-950/80 hover:bg-red-500 p-2 rounded-full transition-colors" aria-label="Hapus file">
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer text-center px-6">
                  <Upload className="w-10 h-10 text-amber-400 mb-3" />
                  <span className="font-semibold">Seret {tab === 'image' ? 'gambar' : 'video'} ke sini atau klik untuk memilih</span>
                  <span className="text-xs text-stone-500 mt-1">{tab === 'image' ? 'PNG, JPG, WEBP · maks 10MB' : 'MP4, WEBM · maks 18MB'}</span>
                  <input type="file" className="hidden" accept={tab === 'image' ? 'image/png,image/jpeg,image/webp' : 'video/mp4,video/webm'}
                    onChange={(e) => pick(e.target.files?.[0])} />
                </label>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-400 mr-1">Bahasa prompt</span>
              <button onClick={() => setLang('id')} className={chip(lang === 'id')}>Indonesia</button>
              <button onClick={() => setLang('en')} className={chip(lang === 'en')}>English</button>
            </div>

            <button onClick={analyze} disabled={!file || !!busy}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {busy === 'analyze' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5 text-amber-400" />}
              Ambil prompt dari media
            </button>
          </section>

          {/* RIGHT: prompt + generate */}
          <section className="space-y-5">
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Tulis prompt sendiri, atau ambil dari media di sebelah kiri. Anda bisa menyuntingnya sebelum membuat gambar atau video."
                className="w-full h-60 bg-stone-900 border border-stone-800 focus:border-amber-400 rounded-3xl p-5 pb-12 text-[15px] leading-relaxed outline-none resize-none transition-colors placeholder:text-stone-600"
              />
              <button onClick={doCopy} disabled={!prompt}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 disabled:opacity-30 transition-colors">
                {copied ? <><Check className="w-3.5 h-3.5 text-amber-400" />Tersalin</> : <><Copy className="w-3.5 h-3.5" />Salin</>}
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-stone-400 mr-1">Rasio</span>
              {ratios.map((r) => <button key={r} onClick={() => setRatio(r)} className={chip(ratio === r)}>{r}</button>)}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={generateImage} disabled={!prompt.trim() || !!busy}
                className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold bg-amber-400 text-stone-900 hover:bg-amber-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                {busy === 'image' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wand2 className="w-5 h-5" />}
                Buat gambar
              </button>
              <button onClick={generateVideo} disabled={!prompt.trim() || !!busy}
                className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold bg-amber-400 text-stone-900 hover:bg-amber-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                {busy === 'video' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
                Buat video
              </button>
            </div>

            {status && <p className="text-sm text-amber-300 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{status}</p>}
            {error && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-950/60 border border-red-900 text-red-200 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" /><span>{error}</span>
              </div>
            )}
          </section>
        </div>

        {/* Gallery */}
        <section className="mt-12">
          <h2 className="text-xl font-bold mb-4">Hasil</h2>
          {gallery.length === 0 ? (
            <p className="text-stone-500 text-sm border border-dashed border-stone-800 rounded-2xl p-8 text-center">
              Gambar dan video yang Anda buat akan muncul di sini. Video Omni biasanya butuh sekitar 1 menit.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {gallery.map((g) => (
                <figure key={g.id} className="group bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden">
                  {g.type === 'image'
                    ? <img src={g.url} alt={g.prompt} className="w-full object-cover" />
                    : <video src={g.url} controls loop className="w-full" />}
                  <figcaption className="p-3 flex items-start gap-3">
                    <p className="text-xs text-stone-400 line-clamp-2 flex-1">{g.prompt}</p>
                    <a href={g.url} download={`hasil-${g.id}.${g.type === 'image' ? 'png' : 'mp4'}`}
                      className="p-2 rounded-lg bg-stone-800 hover:bg-amber-400 hover:text-stone-900 transition-colors" aria-label="Unduh">
                      <Download className="w-4 h-4" />
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
