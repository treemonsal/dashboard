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
  /** Fixe Einzahlung pro Monat in den S&P 500 */
  investMonthly: string;
  /** Datum der ersten Einzahlung (leer = noch nicht eingetragen) */
  investStart: string;
  /** Wer die Hälfte der Mahlzeiten auswärts zurückzahlt (leer, bis eingetragen) */
  mamaName: string;
  /** "1" = Einträge, die mit "Hausaufgabe" beginnen, im Kalender ausblenden */
  hideHomework: string;
  /** Schulferien: bis und mit diesem Datum (YYYY-MM-DD) erscheinen keine Lektionen. Leer = keine Ferien. */
  schoolHolidayUntil: string;
};
export const SETTING_DEFAULTS: Settings = { birthDate: "", wakeTime: "06:30", sleepTime: "22:00", workDays: "1,2,3", schoolDays: "4,5", gymGoal: "4", salary: "650", investMonthly: "350", investStart: "", mamaName: "", hideHomework: "1", schoolHolidayUntil: "" };

