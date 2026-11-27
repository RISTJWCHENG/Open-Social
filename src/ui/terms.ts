/**
 * OpenSocial Terms and Conditions, shown on the sign-up page. Bump TERMS_VERSION
 * whenever the text changes in substance.
 *
 * Items in square brackets are details the operator must fill in before launch.
 */
export const TERMS_VERSION = '2026-11-14';

export interface TermsSection {
  title: string;
  clauses: string[];
}

export const TERMS_INTRO = [
  'Please read these terms carefully before you create an OpenSocial account or use OpenSocial. By creating an account or using OpenSocial you agree to these terms. If you do not agree, do not use OpenSocial.',
  'OpenSocial is under active development. Features may change, be limited or be unavailable, and you should keep your own copies of anything important to you.',
];

export const TERMS: TermsSection[] = [
  {
    title: 'About these terms',
    clauses: [
      'OpenSocial is operated by [operator legal name], [registered address] (“OpenSocial”, “we”, “us”). These terms govern your use of the OpenSocial app at chat.opensocial.cc, ydmpv-niaaa-aaaak-qzlua-cai.icp0.io, any other address where we publish it, and the services it provides (the “Service”).',
      '“You” means the person who creates or uses an OpenSocial account. If you use OpenSocial on behalf of an organisation, you confirm that you may accept these terms for it.',
      'We may update these terms. If a change is significant we will tell you in the app before it takes effect. If you keep using OpenSocial after that, the updated terms apply; if you do not agree, you can delete your account at any time.',
    ],
  },
  {
    title: 'Who can use OpenSocial',
    clauses: [
      'You must be at least 16 years old, or older if the law where you live requires it, to create an account.',
      'You may not use OpenSocial if you are barred from doing so by applicable law, or if we have previously closed your account for breaking these terms.',
    ],
  },
  {
    title: 'Your account',
    clauses: [
      'You sign in with Internet Identity, a passkey or an email code. OpenSocial never sees or stores a password. You are responsible for keeping your devices, passkeys, Internet Identity and email account secure, and for everything done with your account.',
      'Your username and display name are public so that other people can find you. You can make your profile visible to friends only in Settings; your public profile and username are then removed, and the username may be taken by someone else.',
      'If you add a recovery email, we keep only a salted hash of the address and a masked version for display, and use it solely to let you sign in to the same account again.',
      'Message keys are created and kept on your device. If you sign out, clear your browser data or lose your device without a backup, your messages on that device cannot be recovered by us or anyone else.',
      'You must not choose a username that impersonates another person or organisation, infringes someone else’s rights or is offensive. We may reclaim or change usernames that break this rule.',
    ],
  },
  {
    title: 'How OpenSocial works and what we can see',
    clauses: [
      'Messages, voice messages, calls and files are end-to-end encrypted on your device using the MLS protocol (RFC 9420). We cannot read their content.',
      'When the person you write to is online, content is sent directly between devices where possible. When they are offline, the encrypted content is held in a mailbox on the Internet Computer until their device collects it, and is deleted after delivery or after 30 days at the latest.',
      'To deliver messages, the Service necessarily processes some information that is not end-to-end encrypted, such as account identifiers, the public keys of your devices, which account sends a mailbox entry to which device, timing and size. Your public profile is visible to anyone; your friends-only profile is encrypted for your friends.',
      'OpenSocial runs on the Internet Computer, a decentralised network that we do not control. Its availability, performance and security depend partly on that network and on Internet Identity, which are operated by third parties.',
    ],
  },
  {
    title: 'Optional Sia storage',
    clauses: [
      'You can connect your own Sia storage to back up your chats and share large files. That storage is your own account with a third-party network; your use of it is governed by its own terms, and you are responsible for its cost, keys and availability.',
      'Backups and files are encrypted on your device before they are stored on Sia. If you lose the keys, we cannot recover them.',
    ],
  },
  {
    title: 'Acceptable use',
    clauses: [
      'You must not use OpenSocial to create, send, store or share material that sexually exploits or endangers children; that is unlawful, threatening, harassing, hateful or defamatory; that promotes violence or terrorism; or that infringes anyone’s intellectual property, privacy or other rights.',
      'You must not send spam or unsolicited bulk messages, scam or defraud people, impersonate others, or collect information about other users without their consent.',
      'You must not interfere with the Service: no malware, no attempts to break or bypass its security or encryption, to overload its canisters, to get around rate limits, or to access accounts or data that are not yours. Responsible reports of security issues are welcome at [contact email].',
      'You must not use automated means to create accounts, or create accounts to evade a block or a closure of another account.',
      'You can block people and report public profiles in the app. Because content is end-to-end encrypted, we generally cannot see it; we act on reports, on the information available to us and as required by law.',
    ],
  },
  {
    title: 'Your content',
    clauses: [
      'You keep all rights to the content you send or share. You are responsible for it and confirm that you have the right to share it.',
      'You give us only the permissions needed to store, transmit and display your content so that the Service works, for as long as that is needed.',
      'Content you have sent stays on your recipients’ devices. Deleting a message “for everyone” asks their apps to remove it, but we cannot guarantee that every copy, backup or screenshot is removed.',
    ],
  },
  {
    title: 'Our rights',
    clauses: [
      'The OpenSocial name, logo, app and code are owned by us or our licensors. Third-party components are used under their own licences, listed in the app. These terms do not give you any right to use our name or logo.',
      'We may suspend or close an account, or remove a public profile or username, if we reasonably believe it breaks these terms or the law, or to protect other users or the Service. Where the law allows and it is safe to do so, we will tell you why.',
    ],
  },
  {
    title: 'Ending your use of OpenSocial',
    clauses: [
      'You can delete your account at any time in Settings › Account. This deletes your account, sign-in methods, devices, waiting messages and profile from OpenSocial, and the chats on that device. Copies held by your contacts remain on their devices.',
      'We may stop offering OpenSocial, or any part of it, with reasonable notice where possible.',
    ],
  },
  {
    title: 'Disclaimers and liability',
    clauses: [
      'OpenSocial is provided “as is” and “as available”. To the extent the law allows, we do not promise that it will be uninterrupted, error-free or suitable for any particular purpose, or that messages will always be delivered.',
      'OpenSocial is not an emergency service. Do not rely on it to contact emergency services.',
      'To the extent the law allows, we are not liable for indirect or consequential loss, loss of data, or loss caused by third-party networks or services, or by your failure to keep your devices and keys secure. Nothing in these terms limits liability that cannot be limited by law, including your statutory rights as a consumer.',
    ],
  },
  {
    title: 'General',
    clauses: [
      'These terms are governed by the laws of [country]. Disputes go to the courts of [city], unless the law of the country where you live as a consumer gives you the right to use your local courts.',
      'If any part of these terms is found to be unenforceable, the rest remains in effect. If we do not enforce a right straight away, we do not give it up.',
      'Questions about these terms: [contact email].',
    ],
  },
];
