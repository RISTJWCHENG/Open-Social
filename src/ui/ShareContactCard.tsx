/** "Share your contact": a QR code of the invite link, the link, and a button to copy it. */
import { CopyButton } from './CopyButton';
import { QrCode } from './QrCode';
import { inviteLink } from './inviteLink';

export function ShareContactCard({ account }: { account: string }) {
  const link = inviteLink(account);
  return (
    <div className="share-card" aria-label="Share your contact">
      <p className="share-title">Share your contact</p>
      <p className="settings-note">Friends can scan this or open the link to add you.</p>
      <QrCode text={link} size={168} label="QR code to add you on OpenSocial" />
      <code className="share-link">{link}</code>
      <div className="settings-actions">
        <CopyButton text={link} label="Copy invite link" />
      </div>
    </div>
  );
}
