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
  login: {
    title: 'Logowanie',
    loginLabel: 'Login',
    loginHint: 'Na przykład anna.kowalska',
    pinLabel: 'PIN',
    passwordLabel: 'PIN lub hasło',
    submit: 'Zaloguj się',
    submitting: 'Logowanie…',
    forgot: 'Nie pamiętasz PIN-u? Poproś menedżera zmiany o nowy.',
  },
  changeSecret: {
    titlePin: 'Ustaw swój PIN',
    titlePassword: 'Ustaw swoje hasło',
    introPin: 'Otrzymany PIN jest tymczasowy. Ustaw własny, 6-cyfrowy PIN — tylko Ty go znasz.',
    introPassword: 'Otrzymane hasło jest tymczasowe. Ustaw własne hasło — co najmniej 10 znaków.',
    currentPin: 'Obecny PIN',
    currentPassword: 'Obecne hasło',
    newPin: 'Nowy PIN (6 cyfr)',
    newPassword: 'Nowe hasło',
    repeat: 'Powtórz',
    mismatch: 'Wpisane wartości się różnią.',
    submit: 'Zapisz',
    pinRules: 'Nie używaj powtórzeń ani ciągów, np. 000000, 123456.',
  },
  home: {
    hello: (name: string) => `Dzień dobry, ${name}`,
    stageNote: 'Szkolenia, Service Book i menu pojawią się w kolejnych etapach.',
    logout: 'Wyloguj',
    roleOwner: 'Właściciel',
    roleManager: 'Menedżer',
    roleEmployee: 'Pracownik',
  },
  errors: {
    invalid_credentials: 'Nieprawidłowy login lub PIN.',
    locked: 'Zbyt wiele nieudanych prób. Spróbuj ponownie za 15 minut albo poproś menedżera o odblokowanie.',
    too_many_attempts: 'Zbyt wiele prób z tego urządzenia. Spróbuj ponownie za 15 minut.',
    wrong_current_secret: 'Obecny PIN lub hasło jest nieprawidłowe.',
    pin_format: 'PIN musi mieć dokładnie 6 cyfr.',
    pin_too_simple: 'Ten PIN jest zbyt prosty. Wybierz inny.',
    password_too_short: 'Hasło musi mieć co najmniej 10 znaków.',
    same_secret: 'Nowy PIN musi być inny niż obecny.',
    unauthorized: 'Sesja wygasła. Zaloguj się ponownie.',
    forbidden: 'Nie masz uprawnień do tej czynności.',
    not_found: 'Nie znaleziono.',
    bad_origin: 'Żądanie odrzucone ze względów bezpieczeństwa. Odśwież stronę.',
    network: 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.',
    generic: 'Coś poszło nie tak. Spróbuj ponownie za chwilę.',
  } as Record<string, string>,
} as const;

export type Strings = typeof pl;

export function errorText(code: string): string {
  return pl.errors[code] ?? pl.errors.generic!;
}
