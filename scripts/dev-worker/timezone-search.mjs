/**
 * The city search of `/timezone` (both lanes): Open-Meteo's geocoder, asked in many languages at once, merged by place.
 * The choices themselves (which zone, whether to ask) come from session-state.mjs timeZoneChoices.
 */

/** Open-Meteo geocoding: free, no key, names in any language, the place's IANA time zone in the answer. */
export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
/** Languages searched at once (Ukrainian first: its names label the buttons; then English and local languages). */
export const GEOCODING_LANGUAGES = [
  'uk',
  'en',
  'pl',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'cs',
  'sk',
  'hu',
  'ro',
  'bg',
  'hr',
  'sr',
  'sl',
  'el',
  'tr',
  'lt',
  'lv',
  'et',
  'fi',
  'sv',
  'da',
  'no',
  'he',
  'ja',
  'zh',
  'ko',
];

/**
 * Places named `query`: Open-Meteo matches names only in the language asked, so the city's own languages are searched
 * too ("Warszawa", "München", "Kraków"); Ukrainian names are used for the labels. Throws when the geocoder fails.
 */
export async function searchPlaces(query, fetchImpl = fetch) {
  const search = async (language) => {
    const params = new URLSearchParams({ name: query, count: '10', language });
    const res = await fetchImpl(`${GEOCODING_URL}?${params}`);
    return res.ok ? ((await res.json()).results ?? []) : [];
  };
  const answers = await Promise.all(GEOCODING_LANGUAGES.map(search));
  const places = new Map();
  for (const [i, answer] of answers.entries()) {
    for (const result of answer) {
      const place = places.get(result.id) ?? { names: new Set() };
      // The first language with this place (Ukrainian first) gives the label
      if (!place.result) place.result = result;
      place.names.add(result.name);
      if (i === 0) place.result = result;
      places.set(result.id, place);
    }
  }
  return [...places.values()].map(({ result, names }) => ({ ...result, names: [...names] }));
}
