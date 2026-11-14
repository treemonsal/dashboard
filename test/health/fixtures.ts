// Nachgestellte Antworten der Google Health API (v4), nach dem Discovery-Dokument (health.googleapis.com/$discovery/rest?version=v4).
// Werte erfunden. Int64 kommen als Text, Dauer als "…s", Datum als {year, month, day}.
export const stepsRollup = {
  rollupDataPoints: [
    { civilStartTime: { date: { year: 2026, month: 11, day: 12 } }, civilEndTime: { date: { year: 2026, month: 11, day: 13 } }, steps: { countSum: "8421" } },
    { civilStartTime: { date: { year: 2026, month: 11, day: 13 } }, civilEndTime: { date: { year: 2026, month: 11, day: 14 } }, steps: { countSum: "10032" } },
  ],
};
export const restingHr = {
  dataPoints: [
    { dailyRestingHeartRate: { beatsPerMinute: "58", date: { year: 2026, month: 11, day: 13 }, dailyRestingHeartRateMetadata: { calculationMethod: "SLEEP" } } },
    { dailyRestingHeartRate: { beatsPerMinute: "61", date: { year: 2026, month: 11, day: 12 } } },
  ],
};
// 12. November: zwei Wägungen (morgens und abends); 23:30 UTC am 13. ist schon der 14. in Zürich (UTC+1).
export const weight = {
  dataPoints: [
    { weight: { weightGrams: 68400, sampleTime: { physicalTime: "2026-11-12T06:10:00Z", utcOffset: "3600s" } } },
    { weight: { weightGrams: 68900, sampleTime: { physicalTime: "2026-11-12T19:00:00Z", utcOffset: "3600s" } } },
    { weight: { weightGrams: 68000, sampleTime: { physicalTime: "2026-11-13T23:30:00Z", utcOffset: "3600s" } } },
  ],
};
// Nacht auf den 13.: einschlafen 12.11. 22:05 Zürich, aufwachen 13.11. 06:30 Zürich (05:30 UTC). Schlaf zählt zum 13.
// Dazu ein Nickerchen am 12. und eine Nacht auf den 14., die kurz nach Mitternacht Zürcher Zeit endet.
export const sleep = {
  dataPoints: [
    {
      sleep: {
        interval: { startTime: "2026-11-12T21:05:00Z", endTime: "2026-11-13T05:30:00Z", startUtcOffset: "3600s", endUtcOffset: "3600s" },
        summary: { minutesAsleep: "441", minutesAwake: "34", minutesInSleepPeriod: "505" },
        metadata: { mainSleep: true, nap: false, processed: true },
        type: "STAGES",
      },
    },
    {
      sleep: {
        interval: { startTime: "2026-11-12T13:00:00Z", endTime: "2026-11-12T13:30:00Z" },
        summary: { minutesAsleep: "25" },
        metadata: { nap: true },
      },
    },
    {
      sleep: {
        interval: { startTime: "2026-11-13T22:50:00Z", endTime: "2026-11-13T23:20:00Z" },
        summary: { minutesAsleep: "30" },
        metadata: { nap: false, mainSleep: false },
      },
    },
  ],
};
export const exercise = {
  dataPoints: [
    {
      exercise: {
        exerciseType: "STRENGTH_TRAINING",
        displayName: "Krafttraining",
        interval: { startTime: "2026-11-13T16:30:00Z", endTime: "2026-11-13T17:40:00Z" },
        activeDuration: "3900s",
        metricsSummary: { caloriesKcal: 312.4, averageHeartRateBeatsPerMinute: "118" },
      },
    },
    { exercise: { exerciseType: "WALKING", interval: { startTime: "2026-11-12T10:00:00Z", endTime: "2026-11-12T10:20:00Z" }, metricsSummary: {} } },
  ],
};
