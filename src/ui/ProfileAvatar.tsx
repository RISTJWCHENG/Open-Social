/** Avatar of a public profile: its public photo when it has one, else its gradient letter. */
import { useEffect, useState } from 'react';
import type { ProfilesClient, PublicProfile } from '../modules/profiles/profilesClient';
import { bytesToDataUrl } from '../core/profile/profile';
import { Avatar } from './Avatar';

export function ProfileAvatar({
  profiles,
  profile,
  className = 'avatar-40',
}: {
  profiles: Pick<ProfilesClient, 'getPublicAvatar'>;
  profile: PublicProfile;
  className?: string;
}) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    setSrc('');
    if (profile.avatarHash) {
      void profiles
        .getPublicAvatar(profile.account)
        .then((b) => alive && b && setSrc(bytesToDataUrl(b)))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [profiles, profile.account, profile.avatarHash]);
  return (
    <Avatar
      name={profile.displayName || profile.username}
      className={className}
      src={src || undefined}
      seed={profile.account}
    />
  );
}
