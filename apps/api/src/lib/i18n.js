// Satori V2 — PL/EN strings. No mixed UI.
'use strict';
const STR = {
  en: {
    selectContest: 'Select contest', userProfile: 'User profile', affiliation: 'Affiliation',
    filenameHint: 'Use only A-Z a-z 0-9 . _ -.',
    queued: 'Queued', compiling: 'Compiling', testing: 'Testing', judged: 'Judged',
    queueEta: (pos, s) => `Queue position ${pos}, ETA ~${s}s`,
    tleHelp: (used, lim) => `Time limit exceeded: used ${used}, limit ${lim}. Try O(n log n), fast I/O, -O2.`,
    mleHelp: (used, lim) => `Memory exceeded: used ${used}, limit ${lim}. Shrink arrays, stream input.`,
    ceHelp: 'Compiler error. See first error line, check headers/flags.',
    simulatedRun: 'Simulated run (toolchain unavailable on this judge).',
  },
  pl: {
    selectContest: 'Wybierz konkurs', userProfile: 'Profil użytkownika', affiliation: 'Afiliacja',
    filenameHint: 'Używaj tylko A-Z a-z 0-9 . _ -.',
    queued: 'W kolejce', compiling: 'Kompilacja', testing: 'Testowanie', judged: 'Oceniono',
    queueEta: (pos, s) => `Pozycja w kolejce ${pos}, ETA ~${s}s`,
    tleHelp: (used, lim) => `Przekroczono limit czasu: użyto ${used}, limit ${lim}. Spróbuj O(n log n), szybkie I/O, -O2.`,
    mleHelp: (used, lim) => `Przekroczono limit pamięci: użyto ${used}, limit ${lim}. Zmniejsz tablice, strumieniuj wejście.`,
    ceHelp: 'Błąd kompilacji. Zobacz pierwszą linię błędu, sprawdź nagłówki/flagi.',
    simulatedRun: 'Uruchomienie symulowane (brak zestawu narzędzi na tym sędzim).',
  },
};
function t(lang, key, ...args) {
  const pack = STR[lang] || STR.en;
  const v = pack[key] ?? STR.en[key];
  if (typeof v === 'function') return v(...args);
  return v;
}
module.exports = { t, STR };
