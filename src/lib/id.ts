import { z } from "zod";

/**
 * A pharmacy record's id. The app makes UUIDs, but imported or demo data may use other ids (e.g. "demo-med-16"),
 * so any short, URL-safe id is accepted. This is only a format check: every query still scopes the record to the
 * signed-in pharmacy, so an id from elsewhere finds nothing.
 */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const zId = (message = "Invalid id.") => z.string().regex(ID_RE, message);
