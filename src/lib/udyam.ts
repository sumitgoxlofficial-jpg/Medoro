/**
 * Medoro's Udyam (MSME) registration, shown in the site footer and on the About section of /legal.
 * Only these public registration details are published: the certificate itself also carries a personal mobile number
 * and email, so the PDF is not put on the website. Anyone can verify the number on the government portal.
 */
export const UDYAM = {
  number: "UDYAM-JH-01-0071761",
  enterprise: "MEDORO",
  type: "Micro enterprise",
  activity: "Services",
  registered: "8 November 2026",
  verifyUrl: "https://udyamregistration.gov.in/Udyam_Verify.aspx",
} as const;
