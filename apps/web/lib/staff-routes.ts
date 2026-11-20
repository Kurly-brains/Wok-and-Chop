export const staffSessionPath = "/v1/auth/admin/session";

export const staffWorkspaces = {
  overview: "/staff/overview/",
  staff: "/staff/",
  kitchen: "/kitchen/",
  menu: "/staff/menu/",
  printer: "/staff/printer-guide/",
  reservations: "/staff/reservations/",
  customers: "/staff/customers/",
  reports: "/staff/reports/",
  marketing: "/staff/marketing/",
} as const;

export type StaffWorkspace = keyof typeof staffWorkspaces;

export function staffSignInUrl(workspace: StaffWorkspace) {
  return `/staff/sign-in/?next=${workspace}`;
}
