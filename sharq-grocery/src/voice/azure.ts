/**
 * Optional cloud voices: Azure Speech neural voices in Gulf, Levantine and Egyptian
 * Arabic for every character, and Azure speech-to-text for browsers without their own
 * recognition. Needs the player's own Speech key and region (kept in this browser).
 */

export interface AzureConfig {
  key: string;
  region: string;
}

/** Each character's neural voice; pitch/rate tweaks give two characters on one voice their own sound. */
const VOICES: Record<string, { name: string; pitch?: number; rate?: number }> = {
  sanad: { name: 'ar-AE-HamdanNeural' },
  mum: { name: 'ar-AE-FatimaNeural' },
  dad: { name: 'ar-SA-HamedNeural' },
  grandpa: { name: 'ar-KW-FahedNeural', pitch: -14, rate: -10 },
  partner: { name: 'ar-KW-FahedNeural', pitch: -4 },
  grocer: { name: 'ar-YE-SalehNeural' },
  karak: { name: 'ar-QA-MoazNeural' },
  shawarma: { name: 'ar-SY-LaithNeural' },
  carwash: { name: 'ar-BH-AliNeural' },
  umali: { name: 'ar-BH-LailaNeural' },
  ali: { name: 'ar-OM-AbdullahNeural', pitch: 30, rate: 8 },
  hamad: { name: 'ar-OM-AbdullahNeural', pitch: -6 },
  electro: { name: 'ar-LB-RamiNeural' },
  barber: { name: 'ar-EG-ShakirNeural' },
  hr: { name: 'ar-QA-AmalNeural' },
  platform: { name: 'ar-SA-ZariyahNeural' },
};
const MALE = ['ar-BH-AliNeural', 'ar-QA-MoazNeural', 'ar-OM-AbdullahNeural', 'ar-YE-SalehNeural', 'ar-JO-TaimNeural'];
const FEMALE = ['ar-KW-NouraNeural', 'ar-OM-AyshaNeural', 'ar-SA-ZariyahNeural', 'ar-JO-SanaNeural', 'ar-AE-FatimaNeural'];

export function azureVoice(key: string, gender: 'm' | 'f'): { name: string; pitch: number; rate: number } {
  const v = VOICES[key];
  if (v) return { name: v.name, pitch: v.pitch ?? 0, rate: v.rate ?? 0 };
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const list = gender === 'f' ? FEMALE : MALE;
  return { name: list[h % list.length], pitch: 0, rate: 0 };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Synthesise a line; resolves with MP3 audio. */
export async function azureSpeak(cfg: AzureConfig, text: string, voice: { name: string; pitch: number; rate: number }, signal?: AbortSignal): Promise<Blob> {
  const lang = voice.name.slice(0, 5);
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice.name}"><prosody pitch="${pct(voice.pitch)}" rate="${pct(voice.rate)}">${esc(text)}</prosody></voice></speak>`;
  const res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
    body: ssml,
    signal,
  });
  if (!res.ok) throw new Error(`azure-tts ${res.status}`);
  return res.blob();
}

/** Recognise one recorded utterance (16 kHz WAV). */
export async function azureRecognize(cfg: AzureConfig, wav: Blob, lang: string): Promise<string> {
  const res = await fetch(`https://${cfg.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(lang)}&format=simple`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': cfg.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' },
    body: wav,
  });
  if (!res.ok) throw new Error(`azure-stt ${res.status}`);
  const j = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string };
  return j.RecognitionStatus === 'Success' ? (j.DisplayText ?? '').trim() : '';
}
