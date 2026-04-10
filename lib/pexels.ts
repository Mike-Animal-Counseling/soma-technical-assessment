interface PexelsPhotoSource {
  medium?: string;
  large?: string;
  landscape?: string;
  small?: string;
}

interface PexelsPhoto {
  id?: number;
  src?: PexelsPhotoSource;
  alt?: string;
}

interface PexelsSearchResponse {
  photos?: PexelsPhoto[];
}

interface TaskPreviewImageOptions {
  existingImageUrls?: string[];
  userContext?: string | null;
  preferenceHint?: string | null;
}

const PEXELS_SEARCH_ENDPOINT = 'https://api.pexels.com/v1/search';
const PEXELS_TIMEOUT_MS = 3500;
const PEXELS_RESULTS_PER_PAGE = 8;

function normalizeQueryFragment(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildSearchQuery(taskTitle: string, options?: TaskPreviewImageOptions) {
  const title = normalizeQueryFragment(taskTitle);
  const userContext = normalizeQueryFragment(options?.userContext);
  const preferenceHint = normalizeQueryFragment(options?.preferenceHint);
  const pieces = [title, userContext, preferenceHint].filter(Boolean);

  return pieces.join(' ').trim();
}

function selectBestImageUrl(photo: PexelsPhoto) {
  return photo.src?.medium ?? photo.src?.landscape ?? photo.src?.small ?? photo.src?.large ?? null;
}

function createStableHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function toFingerprint(url: string) {
  return url
    .trim()
    .toLowerCase()
    .replace(/\?.*$/, '');
}

function scorePhoto(
  photo: PexelsPhoto,
  query: string,
  usedFingerprints: Set<string>,
  queryHash: number,
) {
  const imageUrl = selectBestImageUrl(photo);

  if (!imageUrl) {
    return Number.NEGATIVE_INFINITY;
  }

  const fingerprint = toFingerprint(imageUrl);
  const alt = normalizeQueryFragment(photo.alt);
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matchedTerms = queryTerms.filter((term) => alt.toLowerCase().includes(term)).length;
  const uniquenessPenalty = usedFingerprints.has(fingerprint) ? 1000 : 0;
  const stableVariantOffset = Math.abs(((photo.id ?? queryHash) + queryHash) % 17);

  return matchedTerms * 10 - uniquenessPenalty - stableVariantOffset;
}

export async function getTaskPreviewImage(taskTitle: string, options?: TaskPreviewImageOptions) {
  const query = buildSearchQuery(taskTitle, options);
  const apiKey = process.env.PEXELS_API_KEY;

  if (!query || !apiKey) {
    return null;
  }

  const usedFingerprints = new Set((options?.existingImageUrls ?? []).map(toFingerprint));
  const queryHash = createStableHash(query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PEXELS_TIMEOUT_MS);

  try {
    const searchUrl = new URL(PEXELS_SEARCH_ENDPOINT);
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('per_page', String(PEXELS_RESULTS_PER_PAGE));
    searchUrl.searchParams.set('orientation', 'landscape');
    searchUrl.searchParams.set('size', 'medium');

    const response = await fetch(searchUrl, {
      headers: {
        Authorization: apiKey,
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as PexelsSearchResponse;
    const photos = data.photos ?? [];

    if (photos.length === 0) {
      return null;
    }

    const rankedPhotos = [...photos].sort(
      (leftPhoto, rightPhoto) =>
        scorePhoto(rightPhoto, query, usedFingerprints, queryHash) -
        scorePhoto(leftPhoto, query, usedFingerprints, queryHash),
    );

    return selectBestImageUrl(rankedPhotos[0]);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
