/**
 * Gives the server (and tests) every Hindi line up front. Imported by src/server/lang.ts and src/server/context.ts,
 * which every server page that translates already imports; browsers load the lines through loadHindi() instead.
 */
import { HI } from "./hi";
import { setHindi } from "./tr";

setHindi(HI);
