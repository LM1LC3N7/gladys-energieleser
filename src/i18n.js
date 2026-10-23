// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the reader: only our own words, error codes and the values
// we checked (the device id passed DEVICE_ID of src/energieleser/model.js).
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our names of the readers we do not read yet. */
const READER = {
  gasleser: 'gasleser',
  'gasleser.pulse': 'gasleser.pulse',
  wasserleser: 'wasserleser',
  waermeleser: 'wärmeleser',
};

/** Our words for an error code of src/energieleser/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  not_found: {
    en: 'no data page at this address (is it an energieleser reader?)',
    fr: 'pas de page de données à cette adresse (est-ce bien un lecteur energieleser ?)',
  },
  server: { en: 'error of the reader', fr: 'erreur du lecteur' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_data: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an energieleser answer',
    fr: 'ce n’est pas une réponse d’un lecteur energieleser',
  },
};

export function reason(err) {
  if (err?.code === 'unsupported') {
    const name = READER[err.readerType] ?? 'energieleser';
    return {
      en: `this reader is a ${name}: only the stromleser (electricity) is supported for now`,
      fr: `ce lecteur est un ${name} : seul le stromleser (électricité) est pris en charge pour l’instant`,
    };
  }
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const kwh = (value) => Math.round(value * 1000) / 1000;

/** `ago` ms ago, or undefined for a read made by this click. */
const when = (ago) =>
  ago === undefined
    ? { en: 'Read now', fr: 'Lu à l’instant' }
    : { en: `Last read ${delay(ago).en} ago`, fr: `Dernière lecture il y a ${delay(ago).fr}` };

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

export const T = {
  incomplete: {
    en: 'Enter the address of your energieleser reader (its IP address on your network, e.g. 192.168.1.70).',
    fr: 'Saisissez l’adresse de votre lecteur energieleser (son adresse IP sur votre réseau, ex. 192.168.1.70).',
  },
  badAddress: {
    en: 'The reader address is not valid: enter an IP address or a host name, with an optional port (e.g. 192.168.1.70).',
    fr: 'L’adresse du lecteur n’est pas valide : saisissez une adresse IP ou un nom d’hôte, avec un port éventuel (ex. 192.168.1.70).',
  },
  /** `notes`: { en, fr } texts added after the failure (an index held back). */
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The energieleser reader at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `Le lecteur energieleser à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The energieleser reader at ${address} asks to wait (${reason(err).en}): reads paused, new try in ${delay(wait).en}.`,
        fr: `Le lecteur energieleser à l’adresse ${address} demande d’attendre (${reason(err).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  noDevice: (deviceId) => ({
    en: `stromleser ${deviceId} found: create its device from the "Discover" tab to receive its values.`,
    fr: `stromleser ${deviceId} trouvé : créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.`,
  }),
  waiting: (address) => ({
    en: `Waiting for the first answer of the energieleser reader at ${address}.`,
    fr: `En attente de la première réponse du lecteur energieleser à l’adresse ${address}.`,
  }),
  /** `notes`: { en, fr } texts added after the connection message. */
  ok: (address, notes = []) =>
    withNotes(
      {
        en: `Connected to the energieleser reader (${address}).`,
        fr: `Connecté au lecteur energieleser (${address}).`,
      },
      notes,
    ),
  notes: {
    pinLocked: {
      en: 'The meter gives no power: it is probably PIN-locked (enter the PIN given by your grid operator on the meter to unlock its extended data). The indexes go on.',
      fr: 'Le compteur ne donne pas de puissance : il est sans doute verrouillé par PIN (saisissez sur le compteur le PIN donné par votre gestionnaire de réseau pour débloquer ses données étendues). Les index continuent.',
    },
    stale: {
      en: 'The reader gives no new reading of the meter (optical head moved?): the power is no longer sent.',
      fr: 'Le lecteur ne donne plus de nouveau relevé du compteur (tête optique déplacée ?) : la puissance n’est plus envoyée.',
    },
    noIndex: {
      en: 'The meter gives no consumption index (1.8.0) with a known unit right now: the consumption index waits for it.',
      fr: 'Le compteur ne donne pas d’index de consommation (1.8.0) avec une unité connue en ce moment : l’index de consommation l’attend.',
    },
    otherReader: (deviceId) => ({
      en: `Another reader answers at this address (${deviceId}): its values go to its own device, never to the previous one.`,
      fr: `Un autre lecteur répond à cette adresse (${deviceId}) : ses valeurs vont à son propre appareil, jamais au précédent.`,
    }),
    held: ({ direction, from, to }) => {
      if (direction === 'down') {
        return {
          en: `The consumption index dropped from ${kwh(from)} to ${kwh(to)} kWh: held back, the last accepted value is sent again. If the meter was really replaced, click "Accept the held index" in the configuration of the integration: nothing is billed for the drop, the consumption goes on from there. Saving the configuration accepts nothing.`,
          fr: `L’index de consommation a baissé de ${kwh(from)} à ${kwh(to)} kWh : retenu, la dernière valeur acceptée est renvoyée. Si le compteur a vraiment été remplacé, cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration : rien n’est facturé pour la baisse, la consommation repart de là. Enregistrer la configuration n’accepte rien.`,
        };
      }
      const diff = kwh(to - from);
      return {
        en: `The consumption index jumped from ${kwh(from)} to ${kwh(to)} kWh: held back, not sent to the energy monitoring. If you click "Accept the held index" in the configuration of the integration, ${diff} kWh will be counted at once as consumption; accept only if this energy was really consumed. Saving the configuration accepts nothing.`,
        fr: `L’index de consommation a sauté de ${kwh(from)} à ${kwh(to)} kWh : retenu, non envoyé au suivi énergétique. Si vous cliquez sur « Accepter l’index retenu » dans la configuration de l’intégration, ${diff} kWh seront comptés d’un coup comme consommation ; n’acceptez que si cette énergie a vraiment été consommée. Enregistrer la configuration n’accepte rien.`,
      };
    },
  },
  accept: {
    nothing: {
      en: 'No consumption index is held back: nothing to accept.',
      fr: 'Aucun index de consommation n’est retenu : rien à accepter.',
    },
    up: ({ from, to }) => ({
      en: `Accepted: the index ${kwh(to)} kWh will be sent at the next read, and ${kwh(to - from)} kWh (plus what the home uses meanwhile) will be counted at once as consumption. A different value stays held.`,
      fr: `Accepté : l’index ${kwh(to)} kWh sera envoyé à la prochaine lecture, et ${kwh(to - from)} kWh (plus ce que le foyer consomme d’ici là) seront comptés d’un coup comme consommation. Une autre valeur reste retenue.`,
    }),
    down: ({ from, to }) => ({
      en: `Accepted: the index goes from ${kwh(from)} down to ${kwh(to)} kWh at the next read; 0 kWh is counted for the drop, the consumption goes on from there. A different value stays held.`,
      fr: `Accepté : l’index passe de ${kwh(from)} à ${kwh(to)} kWh à la prochaine lecture ; 0 kWh est compté pour la baisse, la consommation repart de là. Une autre valeur reste retenue.`,
    }),
  },
  test: {
    /** The outcome of a read, `ago` ms ago (undefined: made by this click), the next in `next` ms. */
    reading: ({ deviceId, power, index }, ago, next) => {
      const p = power === undefined ? '?' : `${Math.round(power)} W`;
      const i = index === undefined ? '?' : `${kwh(index)} kWh`;
      return {
        en: `${when(ago).en}: stromleser ${deviceId}, net power ${p}, consumption index ${i}.${next > 0 ? ` Next read in ${delay(next).en}.` : ''}`,
        fr: `${when(ago).fr} : stromleser ${deviceId}, puissance nette ${p}, index de consommation ${i}.${next > 0 ? ` Prochaine lecture dans ${delay(next).fr}.` : ''}`,
      };
    },
    failed: (address, err, ago, next) => ({
      en: `${when(ago).en}: the reader at ${address} could not be read (${reason(err).en}). Next read in ${delay(next).en}.`,
      fr: `${when(ago).fr} : le lecteur à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}). Prochaine lecture dans ${delay(next).fr}.`,
    }),
    notYet: (next) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one every 10 s).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une toutes les 10 s).`,
    }),
    slow: {
      en: 'The reader is slow to answer: look at the integration status in a minute.',
      fr: 'Le lecteur tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
