/** The round group photo with a button to pick and crop a new one (or remove it). */
import { useRef, useState } from 'react';
import { squareImage, type ImageCrop } from '../../core/profile/profile';
import { GROUP_LIMITS } from '../../core/groups/groups';
import { Avatar } from '../Avatar';
import { ImageCropDialog } from '../ImageCropDialog';
import { CameraPlusIcon } from '../icons';

/** A square photo small enough to travel with the group's state. */
async function groupPhoto(file: File, crop: ImageCrop): Promise<string> {
  for (const [size, q] of [
    [256, 0.8],
    [192, 0.7],
    [128, 0.6],
  ] as const) {
    const url = await squareImage(file, size, q, crop);
    if (url.length <= GROUP_LIMITS.photo) return url;
  }
  throw new Error('That photo could not be made small enough.');
}

export function GroupPhotoPicker(p: {
  photo: string;
  name: string;
  seed: string;
  disabled?: boolean;
  onChange: (photo: string) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  return (
    <div className="grp-photo">
      {cropping && (
        <ImageCropDialog
          file={cropping}
          aspect={1}
          round
          title="Group photo"
          onApply={(crop) => {
            const file = cropping;
            setCropping(null);
            groupPhoto(file, crop).then(p.onChange, (e) => p.onError(e instanceof Error ? e.message : String(e)));
          }}
          onCancel={() => setCropping(null)}
        />
      )}
      <Avatar name={p.name || 'Group'} seed={p.seed} src={p.photo || undefined} className="avatar-80 grp-photo-img" />
      {!p.disabled && (
        <div className="grp-photo-actions">
          <button type="button" className="ghost-pill" onClick={() => input.current?.click()}>
            <CameraPlusIcon /> {p.photo ? 'Change photo' : 'Add photo'}
          </button>
          {p.photo && (
            <button type="button" className="link-btn" onClick={() => p.onChange('')}>
              Remove
            </button>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setCropping(f);
        }}
      />
    </div>
  );
}
