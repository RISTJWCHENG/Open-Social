/** A link that opens OpenSocial with "Add contact" filled in with this account's ID. */
export function inviteLink(principal: string, origin = window.location.origin): string {
  return `${origin}/#add=${principal}`;
}
