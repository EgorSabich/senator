/**
 * Wszystkie teksty widoczne dla użytkownika — tylko po polsku.
 * Nowe teksty dodajemy wyłącznie tutaj, nigdy bezpośrednio w komponentach.
 */
export const pl = {
  app: {
    name: 'SENATOR',
    subtitle: 'Academy',
    loading: 'Ładowanie…',
    offline: 'Tryb offline',
    errorGeneric: 'Coś poszło nie tak. Spróbuj ponownie za chwilę.',
    errorNetwork: 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.',
  },
  status: {
    passed: 'Zaliczony',
    failed: 'Niezaliczony',
    inProgress: 'W trakcie',
    toRepeat: 'Do powtórki',
    completed: 'Ukończone',
    todo: 'Do zrobienia',
    overdue: 'Po terminie',
    updated: 'Zaktualizowano',
  },
  nav: {
    start: 'Start',
    learning: 'Nauka',
    serviceBook: 'Service Book',
    tests: 'Testy',
    documents: 'Regulaminy i SOP',
    menu: 'Menu',
  },
  common: {
    back: 'Wstecz',
    continue: 'Kontynuuj',
    save: 'Zapisz',
    cancel: 'Anuluj',
    search: 'Szukaj',
    clear: 'Wyczyść',
    acknowledge: 'Zapoznałem(-am) się',
    acknowledgeDocument: 'Zapoznałem(-am) się z dokumentem',
    confirm: 'Potwierdzam',
    askKitchen: 'O skład i alergeny zawsze pytaj kuchnię.',
  },
  shell: {
    stageNote: 'Wersja w budowie. Logowanie pojawi się w kolejnym etapie.',
    healthOk: 'Serwer działa',
    healthDb: 'Baza danych',
    healthFail: 'Brak połączenia z serwerem',
  },
} as const;

export type Strings = typeof pl;
