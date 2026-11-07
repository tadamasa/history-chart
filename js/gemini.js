// Gemini API を端末から直接呼ぶ。APIキーは端末内(IndexedDB の meta)にだけ保存する。
// 無料枠では入力がGoogleの製品改善に使われうるため、呼ぶのはボタンを押したときだけ。
// 下敷き: github.com/tadamasa/reading-memo の js/gemini.js

export const DEFAULT_MODEL = 'gemini-3.8-flash';

function endpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`;
}

async function call(apiKey, model, body) {
  if (!apiKey) { const e = new Error('設定でGemini APIキーを入れてください'); e.code = 'nokey'; throw e; }
  const res = await fetch(endpoint(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(`Geminiの呼び出しに失敗しました: ${data.error ? data.error.message : res.statusText}`);
    e.status = res.status;
    throw e;
  }
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map(p => p.text || '').join('').trim();
}

// 構造化出力(JSONスキーマ)。スキーマが通らないモデルなら、スキーマなしのJSON指定で呼び直す。
export async function generateJson({ apiKey, model, system, prompt, schema }) {
  const base = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  try {
    return await call(apiKey, model, { ...base, generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.2 } });
  } catch (e) {
    if (e.status !== 400) throw e;
    return call(apiKey, model, { ...base, generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
  }
}

// 会話。messages: [{role:'user'|'assistant', content}]
export function chat({ apiKey, model, system, messages }) {
  return call(apiKey, model, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { temperature: 0.5 },
  });
}

export async function ping({ apiKey, model }) {
  return call(apiKey, model, { contents: [{ role: 'user', parts: [{ text: '「接続できました」とだけ返してください。' }] }] });
}
