/**
 * The user's own profile: edited in Profile settings, kept on the device in
 * the encrypted secure store, published to open-social-profiles (sealed for
 * friends; optionally public).
 */
import {
  isBirthDate,
  isSafeLink,
  MAX_LINKS,
  MAX_LOCATION,
  normalizeProfile,
  type ProfileContent,
} from "./sealedProfile";
import { secureGet, secureSet } from "../storage/secureStore";
import { normalizeUsername, usernameProblem } from "./username";

export type Profile = ProfileContent;
export type ProfileVisibility = "friends" | "public";

export interface MyProfile {
  profile: Profile;
  visibility: ProfileVisibility;
}

export const LIMITS = {
  displayName: 40,
  username: 20,
  bio: 160,
  location: MAX_LOCATION,
  linkLabel: 30,
  links: MAX_LINKS,
};

export const emptyProfile = (): Profile => ({
  displayName: "",
  username: "",
  bio: "",
  location: "",
  birthDate: "",
  avatar: "",
  cover: "",
  links: [],
  status: "available",
  updatedAt: 0,
});

export type ProfileErrors = Partial<
  Record<"displayName" | "username" | "bio" | "location" | "birthDate" | "links", string>
> & {
  /** Per link row. */
  link?: Record<number, string>;
};

export function validateProfile(p: Profile): ProfileErrors {
  const e: ProfileErrors = {};
  if (p.displayName.trim().length > LIMITS.displayName)
    e.displayName = `Use at most ${LIMITS.displayName} characters.`;
  const problem = p.username
    ? usernameProblem(normalizeUsername(p.username))
    : null;
  if (problem) e.username = problem;
  if (p.bio.length > LIMITS.bio)
    e.bio = `Use at most ${LIMITS.bio} characters.`;
  if (p.location.trim().length > LIMITS.location)
    e.location = `Use at most ${LIMITS.location} characters.`;
  if (p.birthDate && !isBirthDate(p.birthDate))
    e.birthDate = "Choose a date between 1900 and today.";
  if (p.links.length > LIMITS.links) e.links = `At most ${LIMITS.links} links.`;
  p.links.forEach((l, i) => {
    let msg = "";
    if (!l.label.trim()) msg = "Add a name for this link.";
    else if (l.label.trim().length > LIMITS.linkLabel)
      msg = `Name: at most ${LIMITS.linkLabel} characters.`;
    else if (!isSafeLink(l.url.trim())) msg = "Use a full https:// address.";
    if (msg) (e.link ??= {})[i] = msg;
  });
  return e;
}

const myKey = (principal: string) => `my-profile:${principal}`;

export async function loadMyProfile(
  principal: string,
): Promise<MyProfile | null> {
  const stored = await secureGet<{ profile?: unknown; visibility?: unknown }>(
    myKey(principal),
  );
  if (!stored) return null;
  return {
    profile: normalizeProfile(stored.profile),
    visibility: stored.visibility === "public" ? "public" : "friends",
  };
}

export async function saveMyProfile(
  principal: string,
  value: MyProfile,
): Promise<void> {
  await secureSet(myKey(principal), value);
}

/* ------------------------------------------------------------- images --- */

async function decode(src: string | Blob): Promise<HTMLImageElement> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

/** A part of an image, in its own pixels. */
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A square of the image (`crop`, else the centred largest one) as a data URL
 * of `size` pixels (WebP, JPEG where WebP isn't supported).
 */
export async function squareImage(
  src: string | Blob,
  size: number,
  quality: number,
  crop?: ImageCrop,
): Promise<string> {
  if (!src) return "";
  const img = await decode(src);
  const side = crop?.width ?? Math.min(img.naturalWidth, img.naturalHeight);
  const x = crop?.x ?? (img.naturalWidth - side) / 2;
  const y = crop?.y ?? (img.naturalHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Images are not supported in this browser.");
  ctx.drawImage(img, x, y, side, side, 0, 0, size, size);
  const out = canvas.toDataURL("image/webp", quality);
  return out.startsWith("data:image/webp")
    ? out
    : canvas.toDataURL("image/jpeg", quality);
}

/** Cover shape: the profile panel's cover area (340 × 180 px). */
export const COVER_ASPECT = 340 / 180;

/**
 * Cover image: the chosen part (`crop`, else the centred largest one) in the
 * panel's cover shape at twice its size
 * (680 × 360, sharp on high-density screens), compressed until it is at most
 * about 60 KB.
 */
export async function coverImage(src: Blob, crop?: ImageCrop): Promise<string> {
  const img = await decode(src);
  const w = 680;
  const h = Math.round(w / COVER_ASPECT);
  let sw = crop?.width ?? img.naturalWidth;
  let sh = crop?.height ?? sw / COVER_ASPECT;
  if (!crop && sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * COVER_ASPECT;
  }
  const sx = crop?.x ?? (img.naturalWidth - sw) / 2;
  const sy = crop?.y ?? (img.naturalHeight - sh) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Images are not supported in this browser.");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  let out = "";
  for (const q of [0.8, 0.7, 0.6, 0.5]) {
    out = canvas.toDataURL("image/webp", q);
    if (!out.startsWith("data:image/webp"))
      out = canvas.toDataURL("image/jpeg", q);
    if (out.length * 0.75 <= 60_000) break;
  }
  return out;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToDataUrl(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const type =
    bytes[0] === 0xff
      ? "image/jpeg"
      : bytes[0] === 0x89
        ? "image/png"
        : "image/webp";
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return `data:${type};base64,${btoa(s)}`;
}
