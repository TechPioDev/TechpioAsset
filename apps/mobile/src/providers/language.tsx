import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SqliteStore } from '../lib/sqlite-store';
import { LANGUAGES, translate, type Lang, type StringKey } from '../i18n/strings';

/**
 * The language this phone shows (Phase 8, v2.84).
 *
 * Saved on the device, like the theme: one person's phone in Punjabi does not
 * change anyone else's, and it survives a sign-out. English until somebody
 * chooses otherwise - nothing changes for anyone who does not go looking.
 */
const store = new SqliteStore();
const KEY = 'language';

interface LanguageState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageState | null>(null);

const known = (value: string | null): value is Lang => LANGUAGES.some((l) => l.code === value);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    void store
      .get(KEY)
      .then((saved) => {
        if (known(saved)) setLangState(saved);
      })
      .catch(() => undefined);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void store.set(KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo<LanguageState>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/** Outside the provider (a test harness, a screen rendered alone) this is English. */
export function useLanguage(): LanguageState {
  return (
    useContext(LanguageContext) ?? {
      lang: 'en',
      setLang: () => undefined,
      t: (key, vars) => translate('en', key, vars),
    }
  );
}

/** Shorthand for screens that only need the words. */
export function useT(): LanguageState['t'] {
  return useLanguage().t;
}
