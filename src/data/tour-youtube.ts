/**
 * YouTube video IDs for the 26 tour parts, keyed by part slug (see TOUR_VIDEOS in tour-videos.ts).
 * Paste the 11-character ID from each video's link (youtu.be/<ID> or youtube.com/watch?v=<ID>).
 *
 * A guide (the complete tour included) plays from YouTube only when every one of its parts has an ID here;
 * anything without an ID keeps playing the MP4 in public/videos/files, so parts can be filled in gradually.
 */
export const YOUTUBE_IDS: Partial<Record<string, string>> = {
  // "part-01-introduction-to-medoro": "xxxxxxxxxxx",
};

const ID = /^[A-Za-z0-9_-]{11}$/;

/** The YouTube ID for a part, or undefined when it has none (or a malformed one). */
export function youtubeId(slug: string): string | undefined {
  const id = YOUTUBE_IDS[slug];
  return id && ID.test(id) ? id : undefined;
}
