/** Company and grievance-officer details come from the environment, so each deployment shows its own (/legal, /about-medoro). */
export function company() {
  const e = process.env;
  return {
    name: e.MEDORO_COMPANY_NAME?.trim() || "Medoro Technologies",
    address: e.MEDORO_COMPANY_ADDRESS?.trim() || "Bokaro, Jharkhand, India",
    officer: e.MEDORO_GRIEVANCE_NAME?.trim() || "The Grievance Officer",
    email: e.MEDORO_GRIEVANCE_EMAIL?.trim() || "grievance@medoro.in",
    phone: e.MEDORO_GRIEVANCE_PHONE?.trim() || "",
    configured: !!(e.MEDORO_COMPANY_NAME && e.MEDORO_COMPANY_ADDRESS && e.MEDORO_GRIEVANCE_NAME),
  };
}
