import i18n from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

// Vite static glob: every JSON under ./<lang>/*.json is bundled and exposed
// at module load. Adding a new language is "drop a folder + import works" —
// no manual registration here.
const modules = import.meta.glob<{ default: Record<string, unknown> }>(
  './*/*.json',
  { eager: true },
);

export type Locale = 'es' | 'en' | 'pt';
export const SUPPORTED_LOCALES: { value: Locale; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
];
export const DEFAULT_LOCALE: Locale = 'es';
export const FALLBACK_LOCALE: Locale = 'en';

// Build the i18next `resources` shape: { es: { common: {...} }, en: {...}, ... }
function buildResources(): Record<string, Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const [path, mod] of Object.entries(modules)) {
    // path = './es/common.json'
    const m = /^\.\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!m) continue;
    const lang = m[1]!;
    const ns = m[2]!;
    if (!out[lang]) out[lang] = {};
    out[lang][ns] = mod.default;
  }
  return out;
}

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && SUPPORTED_LOCALES.some((l) => l.value === v);
}

// Pick a starting language. Source of truth on first launch is the main
// process (settings.json). Locally cached in localStorage for instant
// startup before the IPC round-trip; the IPC value wins if it differs.
async function detectInitialLocale(): Promise<Locale> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage?.getItem('simulador.locale');
    if (isLocale(stored)) return stored;
    try {
      const fromMain = await window.simulador?.getLocale();
      if (isLocale(fromMain)) return fromMain;
    } catch {
      // Non-fatal — preload not ready or in dev with no IPC.
    }
  }
  return DEFAULT_LOCALE;
}

export async function initI18n(): Promise<typeof i18n> {
  const lng = await detectInitialLocale();
  await i18n
    .use(ICU)
    .use(initReactI18next)
    .init({
      resources: buildResources(),
      lng,
      fallbackLng: FALLBACK_LOCALE,
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
  return i18n;
}

export function setLocale(locale: Locale): Promise<unknown> {
  if (typeof window !== 'undefined') {
    window.localStorage?.setItem('simulador.locale', locale);
  }
  return i18n.changeLanguage(locale);
}

export { i18n };
