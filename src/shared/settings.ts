// Einstellungen und ihre Standardwerte. Ohne zod, damit die Oberfläche kein zod laden muss.
export type Settings = {
  birthDate: string;
  wakeTime: string;
  sleepTime: string;
  workDays: string;
  schoolDays: string;
  gymGoal: string;
  /** Monatslohn in CHF */
  salary: string;
  /** Fixe Einzahlung pro Monat ins Portfolio */
  investMonthly: string;
  /** Veraltet, wird nicht mehr gerechnet (der Startbestand ist der erste Depotwert). */
  investStart: string;
  /** Stichtag der monatlichen Einzahlung (1 bis 28) */
  investDay: string;
  /** Genau rechnen: Kürzel des gehaltenen ETF (US-Börse), Anzahl Anteile, Währung. Leer = Schätzung. */
  investSymbol: string;
  investShares: string;
  investCurrency: string;
  /** Mehrere bestätigte Positionen, JSON. Leer erhält die bisherige Einzelposition. */
  investHoldings: string;
  /** Wer die Hälfte der Mahlzeiten auswärts zurückzahlt (leer, bis eingetragen) */
  mamaName: string;
  /** "1" = Einträge, die mit "Hausaufgabe" beginnen, im Kalender ausblenden */
  hideHomework: string;
  /** Schulferien: bis und mit diesem Datum (YYYY-MM-DD) erscheinen keine Lektionen. Leer = keine Ferien. */
  schoolHolidayUntil: string;
  /** Trainings im Körper-Tab: "sport" (ohne Gehen) oder "alle" */
  workoutView: string;
  /** Konto, dem Buchungen aus dem Kurzbefehl zugeordnet werden (Name) */
  eingangKonto: string;
};
export const SETTING_DEFAULTS: Settings = { birthDate: "", wakeTime: "06:30", sleepTime: "22:00", workDays: "1,2,3", schoolDays: "4,5", gymGoal: "4", salary: "650", investMonthly: "350", investStart: "", investDay: "25", investSymbol: "", investShares: "", investCurrency: "USD", investHoldings: "", mamaName: "", hideHomework: "1", schoolHolidayUntil: "", workoutView: "sport", eingangKonto: "Revolut" };

