/** Nur verständliche Meldungen anzeigen, keine internen URLs oder Dateiinhalte. */
export function pdfReadError(error: unknown): string {
  const e = error as { name?: string; message?: string } | null;
  if (e?.name === 'PasswordException') return 'Das PDF ist mit einem Passwort geschützt. Bitte exportiere es ohne Passwort.';
  if (e?.name === 'InvalidPDFException') return 'Das PDF ist beschädigt oder unvollständig. Bitte lade den Kontoauszug nochmals aus der Bank App.';
  if (e?.message === 'PDF zu gross') return 'PDF zu gross. Maximal 20 MB.';
  if (e?.message === 'PDF zu lang') return 'Das PDF hat mehr als 80 Seiten. Bitte exportiere einen kürzeren Zeitraum.';
  if (e?.message === 'PDF ohne Text') return 'Das PDF enthält keinen lesbaren Text. Bitte verwende den Originalexport von Revolut oder Yuh statt eines Scans.';
  if (/worker|dynamically imported|module script|fetch/i.test(e?.message ?? '')) return 'Die PDF Lesekomponente konnte nicht geladen werden. Bitte öffne die App mit Internetverbindung neu und versuche es nochmals.';
  return 'Datei konnte nicht gelesen werden. Bitte lade den Originalauszug nochmals aus der Bank App herunter.';
}
