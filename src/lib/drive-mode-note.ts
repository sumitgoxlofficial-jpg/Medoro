/**
 * What to tell a user whose pharmacy keeps its records on its own counters and in its Google Drive (hosted "Drive mode") when they
 * open a server-side analysis screen: the server holds none of those bills, stock or purchases, so the screen has nothing to
 * analyse. Saying so beats a page of confident-looking zeros. Null when the pharmacy's records are on the server.
 */
export const driveModeMessage = (moved: boolean | undefined): string | null =>
  moved
    ? "Your pharmacy’s records live on your counters and in your own Google Drive, not on Medoro’s server, so this screen has no bills, stock or purchases to analyse and will look empty. Use the Insights tab inside Billing (device) for your own data."
    : null;
